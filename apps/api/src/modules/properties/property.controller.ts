// property.controller.ts
import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import { activitiesQuerySchema } from '../leads/lead.validation';
import * as properties from './property.service';
import { listPropertiesQuerySchema } from './property.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });
const paramId = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

export const list = asyncHandler(async (req, res) => {
  const { tenant } = ctx(req);
  const r = await properties.listProperties(tenant, listPropertiesQuerySchema.parse(req.query)); // ZodError -> 422
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const create = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { status: 201, message: 'Property created', data: await properties.createProperty(tenant, userId, req.body, meta) });
});
export const get = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await properties.getProperty(tenant, userId, paramId(req)) });
});
export const update = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Property updated', data: await properties.updateProperty(tenant, userId, paramId(req), req.body, meta) });
});
export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Property archived', data: await properties.archiveProperty(tenant, userId, paramId(req), meta) });
});
export const restore = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Property restored', data: await properties.restoreProperty(tenant, userId, paramId(req), meta) });
});
export const status = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Status updated', data: await properties.updatePropertyStatus(tenant, userId, paramId(req), req.body.propertyStatus, meta) });
});
export const assign = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Assignment updated', data: await properties.assignProperty(tenant, userId, paramId(req), req.body.assignedTo, meta) });
});
export const addImages = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  const files = ((req as unknown as { files?: Array<{ buffer: Buffer; mimetype: string; originalname: string; size: number }> }).files) ?? [];
  sendSuccess(res, { status: 201, message: 'Images uploaded', data: await properties.addImages(tenant, userId, paramId(req), files, meta) });
});
export const removeImage = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Image removed', data: await properties.removeImage(tenant, userId, paramId(req), String(req.params.imageId), meta) });
});
export const activities = asyncHandler(async (req, res) => {
  const { tenant } = ctx(req);
  const r = await properties.listActivities(tenant, paramId(req), activitiesQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});