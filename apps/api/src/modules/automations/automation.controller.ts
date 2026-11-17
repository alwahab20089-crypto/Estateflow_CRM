import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import * as svc from './automation.service';
import { listExecutionsQuerySchema, listWorkflowsQuerySchema } from './automation.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });
const p = (req: { params: Record<string, string | string[] | undefined> }, k: string) => String(req.params[k]);

export const create = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { status: 201, message: 'Automation created', data: await svc.createWorkflow(tenant, userId, req.body, meta) });
});
export const list = asyncHandler(async (req, res) => {
  const { tenant } = ctx(req);
  const r = await svc.listWorkflows(tenant, listWorkflowsQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const get = asyncHandler(async (req, res) => sendSuccess(res, { data: await svc.getWorkflow(ctx(req).tenant, p(req, 'workflowId')) }));
export const update = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Automation updated', data: await svc.updateWorkflow(tenant, userId, p(req, 'workflowId'), req.body, meta) });
});
export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  await svc.removeWorkflow(tenant, userId, p(req, 'workflowId'), meta);
  sendSuccess(res, { message: 'Automation deleted' });
});
export const activate = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Automation activated', data: await svc.activateWorkflow(tenant, userId, p(req, 'workflowId'), meta) });
});
export const pause = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Automation paused', data: await svc.pauseWorkflow(tenant, userId, p(req, 'workflowId'), meta) });
});
export const test = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await svc.testWorkflow(ctx(req).tenant, p(req, 'workflowId'), req.body) }));
export const executions = asyncHandler(async (req, res) => {
  const r = await svc.listExecutions(ctx(req).tenant, p(req, 'workflowId'), listExecutionsQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const execution = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await svc.getExecution(ctx(req).tenant, p(req, 'workflowId'), p(req, 'executionId')) }));
export const retry = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Execution queued for retry', data: await svc.retryExecution(tenant, userId, p(req, 'workflowId'), p(req, 'executionId'), meta) });
});