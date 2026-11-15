import type { Request } from 'express';
import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import { reportQuery } from '../analytics/analytics.validation';
import { exportReport, listReports, runReport } from './report.service';

const who = (req: Request) => ({ tenant: getTenant(req), userId: getAuth(req).userId });

export const catalog = asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  sendSuccess(res, { data: listReports(who(req).tenant.permissions) });
});

export const run = asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const r = await runReport(who(req).tenant, who(req).userId, String(req.params.reportId), q);
  res.setHeader('Cache-Control', 'private, no-store');
  sendSuccess(res, { data: r.data, meta: r.meta });
});

export const exportCsv = asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query); // page / limit are accepted but ignored: exports always cover the whole filtered dataset
  await exportReport(who(req).tenant, who(req).userId, String(req.params.reportId), q, req, res, getRequestMeta(req));
});