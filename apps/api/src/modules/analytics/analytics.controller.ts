import type { Request, Response } from 'express';
import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { buildContext, rangeMeta } from './analytics.context';
import { dealAnalytics } from './analytics.deals';
import { leadAnalytics } from './analytics.leads';
import { overview } from './analytics.overview';
import { propertyAnalytics } from './analytics.properties';
import { revenueAnalytics } from './analytics.revenue';
import { taskAnalytics } from './analytics.tasks';
import { teamAnalytics } from './analytics.team';
import { trendAnalytics } from './analytics.trends';
import { dealsQuery, leadsQuery, overviewQuery, propertiesQuery, revenueQuery, tasksQuery, teamQuery, trendsQuery } from './analytics.validation';

const who = (req: Request) => ({ tenant: getTenant(req), userId: getAuth(req).userId });
const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store'); // analytics are per user: never cached by a shared cache

export const getOverview = asyncHandler(async (req, res) => {
  const q = overviewQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await overview(c), meta: rangeMeta(c) });
});

export const getLeads = asyncHandler(async (req, res) => {
  const q = leadsQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await leadAnalytics(c, { leadSource: q.leadSource, status: q.status }), meta: rangeMeta(c) });
});

export const getDeals = asyncHandler(async (req, res) => {
  const q = dealsQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await dealAnalytics(c, { dealType: q.dealType, status: q.status }), meta: rangeMeta(c) });
});

export const getProperties = asyncHandler(async (req, res) => {
  const q = propertiesQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await propertyAnalytics(c, { propertyType: q.propertyType, status: q.status }), meta: rangeMeta(c) });
});

export const getTeam = asyncHandler(async (req, res) => {
  const q = teamQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await teamAnalytics(c), meta: rangeMeta(c) });
});

export const getTasks = asyncHandler(async (req, res) => {
  const q = tasksQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await taskAnalytics(c, { status: q.status }), meta: rangeMeta(c) });
});

export const getRevenue = asyncHandler(async (req, res) => {
  const q = revenueQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await revenueAnalytics(c, { dealType: q.dealType }), meta: rangeMeta(c) });
});

export const getTrends = asyncHandler(async (req, res) => {
  const q = trendsQuery.parse(req.query);
  const c = await buildContext(who(req).tenant, who(req).userId, q);
  noStore(res);
  sendSuccess(res, { data: await trendAnalytics(c, q.metrics), meta: rangeMeta(c) });
});