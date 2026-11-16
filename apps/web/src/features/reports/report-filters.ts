import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { humanize, leadSourceLabels } from '@/lib/labels';
import type { ReportDefinition, ReportFilterKey, ReportMeta, ReportParams } from '@/types/analytics';
import { oneOf, readAssignee, readDateRange, type DateRangeValue } from '../analytics/analytics-params';
import { ymdInTz } from '@/lib/datetime';

const opts = (values: string[]) => values.map((v) => ({ value: v, label: humanize(v) }));
export const FILTER_OPTIONS = {
  leadSource: Object.entries(leadSourceLabels).map(([value, label]) => ({ value, label })),
  dealType: opts(['SALE', 'RENT', 'LEASE']),
  listingType: opts(['SALE', 'RENT', 'LEASE']),
  propertyType: opts(['HOUSE', 'APARTMENT', 'PLOT', 'COMMERCIAL', 'OFFICE', 'FARMHOUSE', 'OTHER']),
};
export const FILTER_LABELS: Record<Exclude<ReportFilterKey, 'status' | 'assignedTo'>, [string, string]> = {
  leadSource: ['Lead source', 'All sources'],
  dealType: ['Deal type', 'All deal types'],
  listingType: ['Listing type', 'All listing types'],
  propertyType: ['Property type', 'All property types'],
};
export const PAGE_SIZES = [10, 20, 50, 100];

export interface ReportFilters extends DateRangeValue {
  leadSource?: string;
  status?: string;
  dealType?: string;
  propertyType?: string;
  listingType?: string;
  assignedTo?: string;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useReportFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<ReportFilters>(() => {
    const limit = Number(params.get('limit'));
    const status = params.get('status');
    return {
      ...readDateRange(params),
      leadSource: oneOf(params.get('leadSource'), FILTER_OPTIONS.leadSource.map((o) => o.value)),
      dealType: oneOf(params.get('dealType'), ['SALE', 'RENT', 'LEASE'] as const),
      listingType: oneOf(params.get('listingType'), ['SALE', 'RENT', 'LEASE'] as const),
      propertyType: oneOf(params.get('propertyType'), FILTER_OPTIONS.propertyType.map((o) => o.value)),
      status: status && /^[A-Z_]{2,30}$/.test(status) ? status : undefined,
      assignedTo: readAssignee(params.get('assignedTo')),
      page: Math.max(1, Number(params.get('page')) || 1),
      limit: PAGE_SIZES.includes(limit) ? limit : 20,
      sortBy: params.get('sortBy') ?? undefined,
      sortOrder: params.get('sortOrder') === 'asc' ? 'asc' : params.get('sortOrder') === 'desc' ? 'desc' : undefined,
    };
  }, [params]);

  /** Any change returns to page 1 unless the patch sets the page itself. */
  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          if (patch.period && patch.period !== 'custom') {
            next.delete('from');
            next.delete('to');
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { filters, update };
}

/**
 * The API rejects filters a report does not support, so only supported ones are sent.
 * Exports omit page/limit: they always cover the whole filtered dataset.
 */
export function toReportParams(def: ReportDefinition, f: ReportFilters, opts: { forExport?: boolean } = {}): ReportParams {
  const has = (k: ReportFilterKey) => def.filters.includes(k);
  const sortBy = f.sortBy && def.sortable.includes(f.sortBy) ? f.sortBy : undefined;
  const status = f.status && (!def.statuses || def.statuses.includes(f.status)) ? f.status : undefined;
  return {
    ...(def.usesDateRange ? { period: f.period, ...(f.period === 'custom' ? { from: f.from, to: f.to } : {}) } : {}),
    ...(has('leadSource') && f.leadSource ? { leadSource: f.leadSource } : {}),
    ...(has('status') && status ? { status } : {}),
    ...(has('dealType') && f.dealType ? { dealType: f.dealType } : {}),
    ...(has('propertyType') && f.propertyType ? { propertyType: f.propertyType } : {}),
    ...(has('listingType') && f.listingType ? { listingType: f.listingType } : {}),
    ...(has('assignedTo') && f.assignedTo ? { assignedTo: f.assignedTo } : {}),
    ...(sortBy ? { sortBy, sortOrder: f.sortOrder ?? 'asc' } : {}),
    ...(opts.forExport ? {} : { page: f.page, limit: f.limit }),
  };
}

export function exportFilename(def: ReportDefinition, meta: ReportMeta | undefined, tz: string) {
  const stamp = def.usesDateRange && meta?.dateRange ? `${meta.dateRange.from}_to_${meta.dateRange.to}` : ymdInTz(new Date(), tz);
  return `${def.id}_${stamp}.csv`.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}