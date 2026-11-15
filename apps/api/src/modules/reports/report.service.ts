import { once } from 'node:events';
import type { Request, Response } from 'express';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { logger } from '../../config/logger';
import { buildContext, type AnalyticsContext } from '../analytics/analytics.context';
import type { ReportQuery } from '../analytics/analytics.validation';
import { recordAudit } from '../audit/audit.service';
import type { TenantContext } from '../members/member.service';
import { csvLine, currencyExponent, safeFilename } from './csv';
import { canAccessReport, getReport, REPORTS, type GroupedDef, type ReportDef, type Row, type RowsDef } from './report.definitions';

export const MAX_EXPORT_ROWS = 50_000;
const MAX_SKIP = 50_000;
const EXPORT_BATCH = 500;

export const listReports = (permissions: string[]) =>
  REPORTS.filter((r) => canAccessReport(r, permissions)).map((r) => ({
    id: r.id, title: r.title, description: r.description, usesDateRange: r.usesDateRange, filters: r.filters, statuses: r.statuses ?? null,
    columns: r.columns, sortable: r.sortable, defaultSort: r.defaultSort, canExport: permissions.includes('reports:export'),
  }));

function resolve(tenant: TenantContext, reportId: string, q: ReportQuery): ReportDef {
  const def = getReport(reportId);
  // Same answer for "does not exist" and "not allowed to see": no probing of the catalog.
  if (!def || !canAccessReport(def, tenant.permissions)) throw AppError.notFound('Report not found');

  const given: Record<string, unknown> = { leadSource: q.leadSource, status: q.status, dealType: q.dealType, propertyType: q.propertyType, listingType: q.listingType, assignedTo: q.assignedTo };
  const bad = Object.entries(given).filter(([k, v]) => v !== undefined && !def.filters.includes(k as never)).map(([k]) => k);
  if (bad.length) throw AppError.validation(bad.map((k) => ({ path: k, message: `This filter is not supported by the ${def.title}` })));
  if (q.status && def.statuses && !def.statuses.includes(q.status)) throw AppError.validation([{ path: 'status', message: `Use one of: ${def.statuses.join(', ')}` }]);

  const sortKey = q.sortBy ?? def.defaultSort.key;
  if (!def.sortable.includes(sortKey)) throw AppError.validation([{ path: 'sortBy', message: `Use one of: ${def.sortable.join(', ')}` }]);
  return def;
}

const sortOf = (def: ReportDef, q: ReportQuery) => ({ key: q.sortBy ?? def.defaultSort.key, order: q.sortOrder ?? def.defaultSort.order });

function sortRows(rows: Row[], key: string, order: 'asc' | 'desc') {
  const dir = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key]; const y = b[key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1; // nulls always last
    if (y === null || y === undefined) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

const dateRange = (def: ReportDef, c: AnalyticsContext) => (def.usesDateRange ? { from: c.range.fromYmd, to: c.range.toYmd, timezone: c.timezone } : null);

export async function runReport(tenant: TenantContext, userId: string, reportId: string, q: ReportQuery) {
  const def = resolve(tenant, reportId, q);
  const c = await buildContext(tenant, userId, q);
  const sort = sortOf(def, q);
  const summary = def.summary(c, q);

  let rows: Row[];
  let total: number;
  if (def.kind === 'rows') {
    const src = (def as RowsDef).source(c, q);
    const skip = (q.page - 1) * q.limit;
    if (skip > MAX_SKIP) throw AppError.validation([{ path: 'page', message: 'Page is too deep. Narrow the filters instead.' }]);
    const dir = sort.order === 'asc' ? 1 : -1;
    const [docs, count] = await Promise.all([
      src.model.find(src.match as never).sort({ [src.sortMap[sort.key]!]: dir, _id: dir }).skip(skip).limit(q.limit).select(src.select).lean(),
      src.model.countDocuments(src.match as never),
    ]);
    rows = await src.toRows(docs as never, c);
    total = count;
  } else {
    const all = sortRows(await (def as GroupedDef).rows(c, q), sort.key, sort.order); // grouped reports are bounded (members, sources, currencies)
    total = all.length;
    rows = all.slice((q.page - 1) * q.limit, q.page * q.limit);
  }
  return {
    data: { columns: def.columns, rows, summary: await summary },
    meta: {
      page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)),
      report: { id: def.id, title: def.title, usesDateRange: def.usesDateRange }, dateRange: dateRange(def, c), sort,
      scope: c.teamWide ? 'organization' : 'self', generatedAt: c.now.toISOString(),
    },
  };
}

const waitDrain = (res: Response) => Promise.race([once(res, 'drain'), once(res, 'close')]);

/**
 * Streams the FULL filtered dataset (not just one page) as CSV, in bounded batches. Refuses (422) instead of silently truncating when the
 * result is larger than MAX_EXPORT_ROWS. Same scope, permissions and validation as runReport.
 */
export async function exportReport(tenant: TenantContext, userId: string, reportId: string, q: ReportQuery, req: Request, res: Response, meta: RequestMeta) {
  const def = resolve(tenant, reportId, q);
  const c = await buildContext(tenant, userId, q);
  const sort = sortOf(def, q);

  let batches: AsyncGenerator<Row[]>;
  let cleanup: () => Promise<void> = async () => undefined;
  if (def.kind === 'rows') {
    const src = (def as RowsDef).source(c, q);
    const total = await src.model.countDocuments(src.match as never);
    if (total > MAX_EXPORT_ROWS) throw new AppError(422, `This report has ${total} rows. Narrow the filters to export at most ${MAX_EXPORT_ROWS}.`, 'EXPORT_TOO_LARGE');
    const dir = sort.order === 'asc' ? 1 : -1;
    const cursor = src.model.find(src.match as never).sort({ [src.sortMap[sort.key]!]: dir, _id: dir }).select(src.select).limit(MAX_EXPORT_ROWS).lean().cursor({ batchSize: EXPORT_BATCH });
    cleanup = () => cursor.close();
    batches = (async function* () {
      let buf: unknown[] = [];
      for await (const doc of cursor) {
        buf.push(doc);
        if (buf.length >= EXPORT_BATCH) { yield await src.toRows(buf as never, c); buf = []; }
      }
      if (buf.length) yield await src.toRows(buf as never, c);
    })();
  } else {
    const all = sortRows(await (def as GroupedDef).rows(c, q), sort.key, sort.order);
    batches = (async function* () { yield all; })();
  }

  const stamp = def.usesDateRange ? `${c.range.fromYmd}_to_${c.range.toYmd}` : c.range.toYmd;
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(def.id, stamp)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  let aborted = false;
  req.on('close', () => { if (!res.writableEnded) aborted = true; });
  let written = 0;
  try {
    res.write(`\uFEFF${csvLine(def.columns.map((x) => x.label))}`); // BOM so Excel reads UTF-8
    for await (const batch of batches) {
      for (const row of batch) {
        if (aborted) return;
        const cells = def.columns.map((col) => {
          const v = row[col.key] ?? null;
          return col.type === 'money' && typeof v === 'number' ? v.toFixed(currencyExponent(String(row.currency ?? 'USD'))) : v;
        });
        if (!res.write(csvLine(cells))) await waitDrain(res);
        written += 1;
      }
    }
    res.end();
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'report.exported', resource: 'report', after: { report: def.id, rows: written, from: c.range.fromYmd, to: c.range.toYmd }, meta }).catch(() => undefined);
  } catch (err) {
    logger.error({ err, report: def.id }, 'report export failed');
    res.destroy(err as Error); // the status line is already sent: abort the connection so the client sees a FAILED download, not a truncated "complete" file
  } finally {
    await cleanup().catch(() => undefined);
  }
}