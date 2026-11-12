import type { Types } from 'mongoose';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { Activity } from '../activities/activity.model';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { Lead } from '../leads/lead.model';
import { buildSearchFilter } from '../leads/lead.search';
import type { UserBrief } from '../leads/lead.serializer';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { User } from '../users/user.model';
import { Contact } from './contact.model';
import { deriveContactFields } from './contact.search';
import { fullName, toContactDto, type ContactLike } from './contact.serializer';
import type { CreateContactInput, ListContactsQuery, UpdateContactInput } from './contact.validation';
import type { ActivitiesQuery } from '../leads/lead.validation';

type Id = string | Types.ObjectId;

const MAX_SKIP = 50_000;
const FIELD_LABELS: Record<string, string> = {
  firstName: 'first name', lastName: 'last name', email: 'email', phone: 'phone', alternatePhone: 'alternate phone',
  contactType: 'contact type', status: 'status', tags: 'tags', company: 'company', jobTitle: 'job title',
  address: 'address', city: 'city', country: 'country', preferredContactMethod: 'preferred contact method',
  preferredLanguage: 'preferred language', source: 'source', notes: 'notes',
};
// Audit logs hold no PII: changed field names plus these non-PII values only.
const AUDIT_SAFE_KEYS = ['contactType', 'status', 'source', 'preferredContactMethod'];

const can = (t: TenantContext, permission: string) => t.permissions.includes(permission);
const canSeeAll = (t: TenantContext) => can(t, 'contacts:read_all');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
async function measure<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();

  try {
    return await fn();
  } finally {
    console.log(
      `[CONTACT TIMING] ${label}: ${(performance.now() - start).toFixed(0)}ms`,
    );
  }
}
/** Every contact query starts from the verified tenant id. Agents without contacts:read_all only see their own. */
export function contactScope(tenant: TenantContext, userId: string, view: 'active' | 'archived' = 'active') {
  const filter: Record<string, unknown> = {
    organizationId: tenant.organizationId,
    deletedAt: view === 'archived' ? { $ne: null } : null,
  };
  if (!canSeeAll(tenant)) filter.assignedTo = userId;
  return filter;
}

export async function findContact(tenant: TenantContext, userId: string, id: string, opts: { archived?: boolean; any?: boolean } = {}) {
  const filter = contactScope(tenant, userId, opts.archived ? 'archived' : 'active');
  if (opts.any) delete filter.deletedAt;
  const contact = await Contact.findOne({ ...filter, _id: id } as never);
  if (!contact) throw AppError.notFound('Contact not found'); // identical for missing, other tenant and not yours
  return contact;
}

async function loadUsers(ids: Array<Id | null | undefined>): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('name email avatar').lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

export async function serializeContact(contact: ContactLike) {
  const users = await loadUsers([contact.assignedTo]);
  return toContactDto(contact, contact.assignedTo ? (users.get(String(contact.assignedTo)) ?? null) : null);
}

function pickAuditable(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => AUDIT_SAFE_KEYS.includes(k)).map((k) => [k, source[k] ?? null]));
}

const emailInUse = () =>
  new AppError(409, 'A contact with this email already exists.', 'EMAIL_IN_USE', [{ path: 'email', message: 'A contact with this email already exists' }]);

/* ------------------------------------------------------------------ create */


export async function createContact(
  tenant: TenantContext,
  userId: string,
  input: CreateContactInput,
  meta: RequestMeta,
) {
  const canAssign = can(tenant, 'contacts:assign');
  let assignedTo = input.assignedTo ?? null;

  if (assignedTo && assignedTo !== userId && !canAssign) {
    throw AppError.forbidden(
      'You do not have permission to assign contacts to other members',
    );
  }

  if (!assignedTo && !canAssign) {
    assignedTo = userId;
  }

  if (assignedTo) {
    await measure('assert active member', () =>
      assertActiveMember(tenant.organizationId, assignedTo!),
    );
  }

  // Check duplicate email.
  if (input.email) {
    const existingEmail = await measure('email duplicate query', () =>
      Contact.exists({
        organizationId: tenant.organizationId,
        email: input.email,
        deletedAt: null,
      }),
    );

    if (existingEmail) {
      throw emailInUse();
    }
  }

  // Check duplicate phone numbers.
  const phones = [input.phone, input.alternatePhone].filter(
    (p): p is string => Boolean(p),
  );

  const duplicates = await measure('duplicate phone query', async () =>
    phones.length
      ? Contact.find({
          ...contactScope(tenant, userId),
          $or: [
            { phone: { $in: phones } },
            { alternatePhone: { $in: phones } },
          ],
        } as never)
          .select('firstName lastName')
          .limit(3)
          .lean()
      : [],
  );

  const doc = {
    organizationId: tenant.organizationId,
    createdBy: userId,
    assignedTo,
    firstName: input.firstName,
    lastName: input.lastName ?? '',
    email: input.email ?? undefined,
    phone: input.phone ?? undefined,
    alternatePhone: input.alternatePhone ?? undefined,
    contactType: input.contactType ?? 'OTHER',
    status: input.status ?? 'ACTIVE',
    tags: input.tags ?? [],
    company: input.company ?? undefined,
    jobTitle: input.jobTitle ?? undefined,
    address: input.address ?? undefined,
    city: input.city ?? undefined,
    country: input.country ?? undefined,
    preferredContactMethod: input.preferredContactMethod ?? undefined,
    preferredLanguage: input.preferredLanguage ?? undefined,
    source: input.source ?? undefined,
    notes: input.notes ?? undefined,
  };

  // Save contact, activity and audit.
  const contact = await measure('unit of work total', () =>
    runUnitOfWork(async (uow) => {
      const [created] = await measure('Contact.create', () =>
        Contact.create(
          [{ ...doc, ...deriveContactFields(doc) }],
          { session: uow.session },
        ),
      );

      if (!created) {
        throw new Error('Failed to create contact');
      }

      uow.onRollback(() =>
        Contact.deleteOne({ _id: created._id }),
      );

      await measure('recordActivity', () =>
        recordActivity(
          {
            organizationId: tenant.organizationId,
            userId,
            entityType: 'CONTACT',
            entityId: created._id,
            activityType: 'CREATED',
            description: 'Contact created',
          },
          uow.session,
        ),
      );

      await measure('recordAudit', () =>
        recordAudit(
          {
            organizationId: tenant.organizationId,
            actorId: userId,
            action: 'contact.created',
            resource: 'contact',
            resourceId: created._id,
            after: {
              contactType: doc.contactType,
              status: doc.status,
              assignedTo,
            },
            meta,
          },
          uow.session,
        ),
      );

      return created;
    }),
  );

  // Serialize response.
  const serialized = await measure('serialize contact', () =>
    serializeContact(contact),
  );

  return {
    contact: serialized,
    duplicates: duplicates.map((d) => ({
      _id: String(d._id),
      name: fullName(d),
    })),
  };
}


/* -------------------------------------------------------------------- read */

const SORT_FIELDS = { createdAt: 'createdAt', name: 'nameSort', contactType: 'contactType', status: 'status' } as const;

export async function listContacts(tenant: TenantContext, userId: string, q: ListContactsQuery) {
  if (q.view === 'archived' && !can(tenant, 'contacts:delete')) throw AppError.forbidden();

  const filter = contactScope(tenant, userId, q.view);
  if (q.contactType) filter.contactType = q.contactType;
  if (q.status) filter.status = q.status;
  if (q.tag) filter.tags = q.tag;
  if (q.assignedTo && canSeeAll(tenant)) filter.assignedTo = q.assignedTo === 'unassigned' ? null : q.assignedTo;
  if (q.createdFrom || q.createdTo) {
    filter.createdAt = { ...(q.createdFrom ? { $gte: q.createdFrom } : {}), ...(q.createdTo ? { $lte: q.createdTo } : {}) };
  }
  if (q.search) Object.assign(filter, buildSearchFilter(q.search) ?? {});

  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const sort = { [SORT_FIELDS[q.sortBy]]: dir, _id: dir } as Record<string, 1 | -1>; // _id: stable pagination
  const skip = (q.page - 1) * q.limit;
  if (skip > MAX_SKIP) throw AppError.validation([{ path: 'page', message: 'Page is too deep. Narrow your filters instead.' }]);

  const [items, total] = await Promise.all([
    Contact.find(filter as never).sort(sort).skip(skip).limit(q.limit).lean(),
    Contact.countDocuments(filter as never),
  ]);
  const users = await loadUsers(items.map((c) => c.assignedTo));
  return {
    items: items.map((c) => toContactDto(c, c.assignedTo ? (users.get(String(c.assignedTo)) ?? null) : null)),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function getContact(tenant: TenantContext, userId: string, id: string) {
  // Users who may archive contacts can also open archived ones (to restore them).
  const contact = await findContact(tenant, userId, id, { any: can(tenant, 'contacts:delete') });

  // Leads converted into / linked to this contact, limited to what this user may see.
  const leadFilter: Record<string, unknown> = { organizationId: tenant.organizationId, deletedAt: null, convertedContactId: contact._id };
  if (!can(tenant, 'leads:read_all')) leadFilter.assignedTo = userId;
  const leads = can(tenant, 'leads:read')
    ? await Lead.find(leadFilter as never).select('firstName lastName status leadType convertedAt').sort({ convertedAt: -1 }).limit(10).lean()
    : [];

  return {
    ...(await serializeContact(contact)),
    linkedLeads: leads.map((l) => ({
      _id: String(l._id),
      name: fullName(l),
      status: l.status,
      leadType: l.leadType,
      convertedAt: l.convertedAt ? new Date(l.convertedAt).toISOString() : null,
    })),
  };
}

export async function listTags(tenant: TenantContext, userId: string) {
  const tags = await Contact.distinct('tags', contactScope(tenant, userId) as never);
  return (tags as string[]).sort().slice(0, 200);
}

/* ------------------------------------------------------------------ update */

export async function updateContact(tenant: TenantContext, userId: string, id: string, input: UpdateContactInput, meta: RequestMeta) {
  const contact = await findContact(tenant, userId, id);
  const keys = Object.keys(input) as Array<keyof UpdateContactInput>;
  const before = contact.toObject() as Record<string, unknown>;

  if (input.email && input.email !== contact.email) {
    const taken = await Contact.exists({ organizationId: tenant.organizationId, email: input.email, deletedAt: null, _id: { $ne: contact._id } });
    if (taken) throw emailInUse();
  }

  for (const key of keys) {
    const value = input[key];
    contact.set(key, value === null ? undefined : value); // null clears the field
  }
  if (!contact.email && !contact.phone) {
    throw AppError.validation([{ path: 'phone', message: 'A contact needs a phone number or an email' }]);
  }
  contact.set(deriveContactFields(contact));
  const after = contact.toObject() as Record<string, unknown>;

  const changed = keys.filter((k) => !same(before[k], after[k]));
  if (changed.length === 0) return serializeContact(contact);

  await runUnitOfWork(async (uow) => {
    await contact.save({ session: uow.session }); // schema validators run here
    await recordActivity(
      {
        organizationId: tenant.organizationId, userId, entityType: 'CONTACT', entityId: contact._id, activityType: 'UPDATE',
        description: `Updated ${changed.map((k) => FIELD_LABELS[k] ?? k).join(', ')}`, metadata: { changed },
      },
      uow.session,
    );
    await recordAudit(
      {
        organizationId: tenant.organizationId, actorId: userId, action: 'contact.updated', resource: 'contact', resourceId: contact._id,
        before: pickAuditable(before, changed), after: { ...pickAuditable(after, changed), changedFields: changed }, meta,
      },
      uow.session,
    );
  });
  return serializeContact(contact);
}

/* --------------------------------------------------- assign, archive, restore */

export async function assignContact(tenant: TenantContext, userId: string, id: string, assignedTo: string | null, meta: RequestMeta) {
  const contact = await findContact(tenant, userId, id);
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);

  const previous = contact.assignedTo ? String(contact.assignedTo) : null;
  if (previous === assignedTo) return serializeContact(contact);

  const users = await loadUsers([previous, assignedTo]);
  const name = (uid: string | null) => (uid ? (users.get(uid)?.name ?? 'a former member') : null);
  const description = !assignedTo
    ? `Unassigned (was ${name(previous)})`
    : previous
      ? `Reassigned from ${name(previous)} to ${name(assignedTo)}`
      : `Assigned to ${name(assignedTo)}`;

  await runUnitOfWork(async (uow) => {
    contact.assignedTo = (assignedTo ?? null) as never;
    await contact.save({ session: uow.session });
    await recordActivity(
      { organizationId: tenant.organizationId, userId, entityType: 'CONTACT', entityId: contact._id, activityType: 'ASSIGNMENT', description, metadata: { from: previous, to: assignedTo, assignedBy: userId } },
      uow.session,
    );
    await recordAudit(
      { organizationId: tenant.organizationId, actorId: userId, action: 'contact.assigned', resource: 'contact', resourceId: contact._id, before: { assignedTo: previous }, after: { assignedTo }, meta },
      uow.session,
    );
  });
  return serializeContact(contact);
}

export async function archiveContact(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const contact = await findContact(tenant, userId, id);
  await runUnitOfWork(async (uow) => {
    contact.deletedAt = new Date();
    contact.deletedBy = userId as never;
    await contact.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'CONTACT', entityId: contact._id, activityType: 'UPDATE', description: 'Contact archived' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'contact.archived', resource: 'contact', resourceId: contact._id, meta }, uow.session);
  });
  return serializeContact(contact); // nothing is hard-deleted; history is preserved
}

export async function restoreContact(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const contact = await findContact(tenant, userId, id, { archived: true });
  if (contact.email && (await Contact.exists({ organizationId: tenant.organizationId, email: contact.email, deletedAt: null, _id: { $ne: contact._id } }))) {
    throw AppError.conflict('Another active contact already uses this email. Change one of them before restoring.', 'EMAIL_IN_USE');
  }
  await runUnitOfWork(async (uow) => {
    contact.deletedAt = null;
    contact.set('deletedBy', undefined);
    await contact.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'CONTACT', entityId: contact._id, activityType: 'UPDATE', description: 'Contact restored' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'contact.restored', resource: 'contact', resourceId: contact._id, meta }, uow.session);
  });
  return serializeContact(contact);
}

/* ------------------------------------------------------ notes & activities */

function toActivityDto(
  a: { _id: Id; userId: Id; activityType: string; description: string; createdAt: Date },
  users: Map<string, UserBrief>,
) {
  const user = users.get(String(a.userId));
  return {
    _id: String(a._id),
    activityType: a.activityType,
    description: a.description,
    user: user ? { _id: String(user._id), name: user.name } : null,
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

export async function addNote(tenant: TenantContext, userId: string, id: string, body: string) {
  const contact = await findContact(tenant, userId, id);
  const note = await recordActivity({
    organizationId: tenant.organizationId, userId, entityType: 'CONTACT', entityId: contact._id, activityType: 'NOTE', description: body,
  });
  return toActivityDto(note.toObject(), await loadUsers([userId]));
}

export async function listActivities(tenant: TenantContext, userId: string, id: string, q: ActivitiesQuery) {
  const contact = await findContact(tenant, userId, id, { any: can(tenant, 'contacts:delete') });
const filter = {
  organizationId: tenant.organizationId,
  entityType: 'CONTACT' as const,
  entityId: contact._id,
  ...(q.type ? { activityType: q.type } : {}),
};
  const [items, total] = await Promise.all([
   Activity.find(filter as never)
  .sort({ createdAt: -1, _id: -1 })
  .skip((q.page - 1) * q.limit)
  .limit(q.limit),

Activity.countDocuments(filter as never),
  ]);
  const users = await loadUsers(items.map((a) => a.userId));
  return {
    items: items.map((a) => toActivityDto(a, users)),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}