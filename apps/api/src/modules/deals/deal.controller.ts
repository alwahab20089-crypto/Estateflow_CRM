// deal.controller.ts
import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import { activitiesQuerySchema } from '../leads/lead.validation';
import * as deals from './deal.service';
import { listDealsQuerySchema } from './deal.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });
const paramId = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

export const list = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await deals.listDeals(tenant, userId, listDealsQuerySchema.parse(req.query)); // ZodError -> 422
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const create = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { status: 201, message: 'Deal created', data: await deals.createDeal(tenant, userId, req.body, meta) });
});
export const get = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await deals.getDeal(tenant, userId, paramId(req)) });
});
export const update = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Deal updated', data: await deals.updateDeal(tenant, userId, paramId(req), req.body, meta) });
});
export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Deal archived', data: await deals.archiveDeal(tenant, userId, paramId(req), meta) });
});
export const stage = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Stage updated', data: await deals.changeStage(tenant, userId, paramId(req), req.body, meta) });
});
export const assign = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Assignment updated', data: await deals.assignDeal(tenant, userId, paramId(req), req.body.assignedTo, meta) });
});
export const closeWon = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Deal closed as won', data: await deals.closeWon(tenant, userId, paramId(req), req.body, meta) });
});
export const closeLost = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Deal closed as lost', data: await deals.closeLost(tenant, userId, paramId(req), req.body.lostReason, meta) });
});
export const reopen = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Deal reopened', data: await deals.reopenDeal(tenant, userId, paramId(req), req.body.reason, meta) });
});
export const activities = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await deals.listActivities(tenant, userId, paramId(req), activitiesQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});