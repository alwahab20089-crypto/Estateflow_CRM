import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { getRequestMeta } from '../../utils/request-meta';
import { activitiesQuerySchema } from '../leads/lead.validation';
import { convertLeadToContact } from './contact-conversion.service';
import * as contacts from './contact.service';
import { listContactsQuerySchema } from './contact.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId, meta: getRequestMeta(req) });
const paramId = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

export const list = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const result = await contacts.listContacts(tenant, userId, listContactsQuerySchema.parse(req.query)); // ZodError -> 422
  sendSuccess(res, { data: result.items, meta: result.meta });
});

export const tags = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await contacts.listTags(tenant, userId) });
});

export const create = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  const result = await contacts.createContact(tenant, userId, req.body, meta);
  sendSuccess(res, { status: 201, message: 'Contact created', data: result.contact, meta: { duplicates: result.duplicates } });
});

export const get = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: await contacts.getContact(tenant, userId, paramId(req)) });
});

export const update = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Contact updated', data: await contacts.updateContact(tenant, userId, paramId(req), req.body, meta) });
});

export const assign = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Assignment updated', data: await contacts.assignContact(tenant, userId, paramId(req), req.body.assignedTo, meta) });
});

export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Contact archived', data: await contacts.archiveContact(tenant, userId, paramId(req), meta) });
});

export const restore = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  sendSuccess(res, { message: 'Contact restored', data: await contacts.restoreContact(tenant, userId, paramId(req), meta) });
});

export const addNote = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { status: 201, message: 'Note added', data: await contacts.addNote(tenant, userId, paramId(req), req.body.body) });
});

export const activities = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const result = await contacts.listActivities(tenant, userId, paramId(req), activitiesQuerySchema.parse(req.query));
  sendSuccess(res, { data: result.items, meta: result.meta });
});

/** POST /leads/:id/convert-to-contact */
export const convertLead = asyncHandler(async (req, res) => {
  const { tenant, userId, meta } = ctx(req);
  const result = await convertLeadToContact(tenant, userId, paramId(req), req.body, meta);
  sendSuccess(res, {
    status: result.linkedExisting ? 200 : 201,
    message: result.linkedExisting ? 'Lead linked to the existing contact' : 'Lead converted to a contact',
    data: result,
  });
});