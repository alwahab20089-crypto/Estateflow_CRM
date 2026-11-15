import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import { activitiesQuerySchema } from '../leads/lead.validation';
import * as tasks from './task.service';
import { calendarQuerySchema, listTasksQuerySchema, summaryQuerySchema } from './task.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });
const paramId = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

export const list = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await tasks.listTasks(tenant, userId, listTasksQuerySchema.parse(req.query)); // ZodError -> 422
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const calendar = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await tasks.calendarTasks(tenant, userId, calendarQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const summary = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await tasks.taskSummary(tenant, userId, summaryQuerySchema.parse(req.query)) });
});
export const create = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { status: 201, message: 'Task created', data: await tasks.createTask(tenant, userId, req.body, meta) });
});
export const get = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await tasks.getTask(tenant, userId, paramId(req)) });
});
export const update = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Task updated', data: await tasks.updateTask(tenant, userId, paramId(req), req.body, meta) });
});
export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Task archived', data: await tasks.archiveTask(tenant, userId, paramId(req), meta) });
});
export const restore = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Task restored', data: await tasks.restoreTask(tenant, userId, paramId(req), meta) });
});
export const status = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Status updated', data: await tasks.changeStatus(tenant, userId, paramId(req), req.body, meta) });
});
export const complete = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Task completed', data: await tasks.completeTask(tenant, userId, paramId(req), req.body, meta) });
});
export const assign = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Assignment updated', data: await tasks.assignTask(tenant, userId, paramId(req), req.body.assignedTo, meta) });
});
export const activities = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await tasks.listActivities(tenant, userId, paramId(req), activitiesQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});