import { Types } from 'mongoose';
import { CLOSED_PROPERTY_STATUS, MAX_PROPERTY_IMAGES } from '../../constants';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { getStorage } from '../../storage/storage';
import { Activity } from '../activities/activity.model';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { Contact } from '../contacts/contact.model';
import { contactScope } from '../contacts/contact.service';
import { fullName } from '../contacts/contact.serializer';
import { Deal } from '../deals/deal.model';
import { OPEN_DEAL_STAGES } from '../deals/deal.lifecycle';
import { Lead } from '../leads/lead.model';
import { buildSearchFilter } from '../leads/lead.search';
import type { UserBrief } from '../leads/lead.serializer';
import type { ActivitiesQuery } from '../leads/lead.validation';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { Organization } from '../organizations/organization.model';
import { User } from '../users/user.model';
import { imageKey, validateImage } from './property.images';
import { Property } from './property.model';
import { toPropertyDto, type PropertyLike } from './property.serializer';
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from './property.validation';

type Id = string | Types.ObjectId;
const MAX_SKIP = 50_000;
const CLOSED_STATUSES = Object.values(CLOSED_PROPERTY_STATUS) as string[];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const can = (t: TenantContext, p: string) => t.permissions.includes(p);
const oid = (v: Id) => new Types.ObjectId(String(v));
const AUDIT_KEYS = ['propertyType', 'listingType', 'propertyStatus', 'priceAmount', 'currency', 'rentPeriod'];
const pick = (src: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => AUDIT_KEYS.includes(k)).map((k) => [k, src[k] ?? null]));

/** Inventory is shared across the organization (any member with properties:read). Editing is restricted below. */
export function propertyScope(tenant: TenantContext, view: 'active' | 'archived' = 'active') {
  return { organizationId: tenant.organizationId, deletedAt: view === 'archived' ? { $ne: null } : null } as Record<string, unknown>;
}

export async function findProperty(tenant: TenantContext, id: string, opts: { archived?: boolean; any?: boolean } = {}) {
  const filter = propertyScope(tenant, opts.archived ? 'archived' : 'active');
  if (opts.any) delete filter.deletedAt;
  const property = await Property.findOne({ ...filter, _id: id } as never);
  if (!property) throw AppError.notFound('Property not found'); // identical for missing and other-tenant
  return property;
}

/** Agents may edit only properties they created or are assigned; managers+ hold properties:manage_all. */
function assertCanModify(tenant: TenantContext, userId: string, p: { assignedTo?: Id | null; createdBy: Id }) {
  if (can(tenant, 'properties:manage_all')) return;
  if (String(p.assignedTo) === userId || String(p.createdBy) === userId) return;
  throw AppError.forbidden('You can only modify properties assigned to you or created by you');
}

async function assertOwnerContact(tenant: TenantContext, userId: string, contactId: string) {
  const ok = await Contact.exists({ ...contactScope(tenant, userId), _id: contactId } as never);
  if (!ok) throw AppError.validation([{ path: 'ownerContactId', message: 'The selected contact does not belong to this organization' }]);
}

function deriveKeywords(p: { title: string; city?: string | null; address?: string | null; postalCode?: string | null }) {
  const set = new Set<string>();
  for (const src of [p.title, p.city, p.address, p.postalCode]) {
    for (const t of String(src ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (t) set.add(t);
  }
  return [...set].slice(0, 40);
}

async function loadUsers(ids: Array<Id | null | undefined>): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('name email avatar').lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

async function loadOwners(tenant: TenantContext, ids: Array<Id | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map<string, { _id: string; fullName: string }>();
  const contacts = await Contact.find({ _id: { $in: unique }, organizationId: tenant.organizationId }).select('firstName lastName').lean();
  return new Map(contacts.map((c) => [String(c._id), { _id: String(c._id), fullName: fullName(c) }]));
}

export async function serializeProperty(tenant: TenantContext, p: PropertyLike) {
  const [users, owners] = await Promise.all([loadUsers([p.assignedTo]), loadOwners(tenant, [p.ownerContactId])]);
  return toPropertyDto(p, p.assignedTo ? (users.get(String(p.assignedTo)) ?? null) : null, p.ownerContactId ? (owners.get(String(p.ownerContactId)) ?? null) : null);
}

/* ------------------------------------------------------------------ create */

export async function createProperty(tenant: TenantContext, userId: string, input: CreatePropertyInput, meta: RequestMeta) {
  const canAssign = can(tenant, 'properties:assign');
  let assignedTo = input.assignedTo ?? null;
  if (assignedTo && assignedTo !== userId && !canAssign) throw AppError.forbidden('You do not have permission to assign properties to other members');
  if (!assignedTo && !canAssign) assignedTo = userId; // agents own what they create
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);
  if (input.ownerContactId) await assertOwnerContact(tenant, userId, input.ownerContactId);

  const org = await Organization.findById(tenant.organizationId).select('currency').lean();
  const doc = {
    organizationId: tenant.organizationId, // verified server context only
    createdBy: userId,
    assignedTo,
    title: input.title,
    description: input.description ?? undefined,
    propertyType: input.propertyType,
    listingType: input.listingType,
    propertyStatus: 'AVAILABLE' as const,
    bedrooms: input.bedrooms ?? undefined,
    bathrooms: input.bathrooms ?? undefined,
    area: input.area ?? undefined,
    areaUnit: input.area ? (input.areaUnit ?? 'SQFT') : undefined,
    floors: input.floors ?? undefined,
    furnishingStatus: input.furnishingStatus ?? 'NOT_APPLICABLE',
    parkingSpaces: input.parkingSpaces ?? undefined,
    yearBuilt: input.yearBuilt ?? undefined,
    amenities: input.amenities ?? [],
    address: input.address ?? undefined,
    city: input.city ?? undefined,
    state: input.state ?? undefined,
    country: input.country ?? undefined,
    postalCode: input.postalCode ?? undefined,
    latitude: input.latitude ?? undefined,
    longitude: input.longitude ?? undefined,
    locationDescription: input.locationDescription ?? undefined,
    priceAmount: input.priceAmount,
    currency: input.currency ?? org?.currency ?? 'USD',
    rentPeriod: input.listingType === 'RENT' ? (input.rentPeriod ?? undefined) : undefined,
    securityDepositAmount: input.securityDepositAmount ?? undefined,
    maintenanceChargesAmount: input.maintenanceChargesAmount ?? undefined,
    ownerContactId: input.ownerContactId ?? null,
  };

  const property = await runUnitOfWork(async (uow) => {
    const [created] = await Property.create([{ ...doc, searchKeywords: deriveKeywords(doc) }], { session: uow.session });
    uow.onRollback(() => Property.deleteOne({ _id: created!._id }));
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: created!._id, activityType: 'CREATED', description: 'Property created' }, uow.session);
    await recordAudit(
      { organizationId: tenant.organizationId, actorId: userId, action: 'property.created', resource: 'property', resourceId: created!._id, after: { ...pick(doc, AUDIT_KEYS), assignedTo }, meta },
      uow.session,
    );
    return created!;
  });
  return serializeProperty(tenant, property);
}

/* -------------------------------------------------------------------- read */

const SORT_FIELDS = { createdAt: 'createdAt', price: 'priceAmount', title: 'title', area: 'area' } as const;
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listProperties(tenant: TenantContext, q: ListPropertiesQuery) {
  if (q.view === 'archived' && !can(tenant, 'properties:delete')) throw AppError.forbidden();
  const filter = propertyScope(tenant, q.view);
  if (q.propertyType) filter.propertyType = q.propertyType;
  if (q.listingType) filter.listingType = q.listingType;
  if (q.propertyStatus) filter.propertyStatus = q.propertyStatus;
  else if (!q.includeClosed) filter.propertyStatus = { $nin: CLOSED_STATUSES }; // BR-20: closed ones leave the default listing
  if (q.assignedTo) filter.assignedTo = q.assignedTo === 'unassigned' ? null : q.assignedTo;
  if (q.ownerContactId) filter.ownerContactId = q.ownerContactId;
  if (q.city) filter.city = { $regex: `^${escapeRegex(q.city)}$`, $options: 'i' };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.priceAmount = { ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}) };
  }
  if (q.minArea !== undefined || q.maxArea !== undefined) {
    filter.area = { ...(q.minArea !== undefined ? { $gte: q.minArea } : {}), ...(q.maxArea !== undefined ? { $lte: q.maxArea } : {}) };
  }
  if (q.createdFrom || q.createdTo) filter.createdAt = { ...(q.createdFrom ? { $gte: q.createdFrom } : {}), ...(q.createdTo ? { $lte: q.createdTo } : {}) };
  if (q.search) Object.assign(filter, buildSearchFilter(q.search) ?? {});

  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const sort = { [SORT_FIELDS[q.sortBy]]: dir, _id: dir } as Record<string, 1 | -1>;
  const skip = (q.page - 1) * q.limit;
  if (skip > MAX_SKIP) throw AppError.validation([{ path: 'page', message: 'Page is too deep. Narrow your filters instead.' }]);

  const [items, total, counts] = await Promise.all([
    Property.find(filter as never).sort(sort).skip(skip).limit(q.limit).lean(),
    Property.countDocuments(filter as never),
    // summary cards: whole active inventory, independent of the current filters
    Property.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: oid(tenant.organizationId), deletedAt: null } },
      { $group: { _id: '$propertyStatus', count: { $sum: 1 } } },
    ]),
  ]);
  const [users, owners] = await Promise.all([loadUsers(items.map((p) => p.assignedTo)), loadOwners(tenant, items.map((p) => p.ownerContactId))]);
  return {
    items: items.map((p) => toPropertyDto(p as PropertyLike, p.assignedTo ? (users.get(String(p.assignedTo)) ?? null) : null, p.ownerContactId ? (owners.get(String(p.ownerContactId)) ?? null) : null)),
    meta: {
      page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)),
      statusCounts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    },
  };
}

export async function getProperty(tenant: TenantContext, userId: string, id: string) {
  const property = await findProperty(tenant, id, { any: can(tenant, 'properties:delete') });

  // Related records are limited to what this user may already see.
  const dealFilter: Record<string, unknown> = { organizationId: oid(tenant.organizationId), propertyId: property._id, deletedAt: null };
  if (!can(tenant, 'deals:read_all')) dealFilter.$or = [{ assignedTo: oid(userId) }, { createdBy: oid(userId) }];
  const deals = can(tenant, 'deals:read')
    ? await Deal.find(dealFilter as never).select('title stage dealType valueAmount currency contactId leadId').sort({ createdAt: -1 }).limit(20).lean()
    : [];

  const contactIds = [...new Set([...deals.map((d) => String(d.contactId)), ...(property.ownerContactId ? [String(property.ownerContactId)] : [])])];
  const contacts = can(tenant, 'contacts:read') && contactIds.length
    ? await Contact.find({ ...contactScope(tenant, userId), _id: { $in: contactIds } } as never).select('firstName lastName').limit(20).lean()
    : [];

  const leadIds = [...new Set(deals.filter((d) => d.leadId).map((d) => String(d.leadId)))];
  const leadFilter: Record<string, unknown> = { organizationId: tenant.organizationId, deletedAt: null, _id: { $in: leadIds } };
  if (!can(tenant, 'leads:read_all')) leadFilter.assignedTo = userId;
  const leads = can(tenant, 'leads:read') && leadIds.length ? await Lead.find(leadFilter as never).select('firstName lastName status').limit(20).lean() : [];

  return {
    ...(await serializeProperty(tenant, property)),
    relatedDeals: deals.map((d) => ({ _id: String(d._id), title: d.title, stage: d.stage, dealType: d.dealType, valueAmount: d.valueAmount, currency: d.currency })),
    relatedContacts: contacts.map((c) => ({ _id: String(c._id), fullName: fullName(c) })),
    relatedLeads: leads.map((l) => ({ _id: String(l._id), name: fullName(l), status: l.status })),
  };
}

/* ------------------------------------------------------------------ update */

export async function updateProperty(tenant: TenantContext, userId: string, id: string, input: UpdatePropertyInput, meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  assertCanModify(tenant, userId, property);
  const keys = Object.keys(input) as Array<keyof UpdatePropertyInput>;
  const before = property.toObject() as Record<string, unknown>;

  if (input.ownerContactId && String(property.ownerContactId) !== input.ownerContactId) await assertOwnerContact(tenant, userId, input.ownerContactId);
  if (input.listingType && input.listingType !== property.listingType) {
    const open = await Deal.exists({ organizationId: tenant.organizationId, propertyId: property._id, stage: { $in: OPEN_DEAL_STAGES }, deletedAt: null });
    if (open) throw AppError.conflict('This property has open deals. Close them before changing the listing type.', 'PROPERTY_HAS_OPEN_DEALS');
  }

  for (const key of keys) {
    const value = input[key];
    property.set(key, value === null ? undefined : value);
  }
  if (property.listingType === 'RENT' && !property.rentPeriod) throw AppError.validation([{ path: 'rentPeriod', message: 'Rent period is required for rentals' }]);
  if (property.area && !property.areaUnit) property.areaUnit = 'SQFT';
  if ((property.latitude == null) !== (property.longitude == null)) throw AppError.validation([{ path: 'latitude', message: 'Provide both latitude and longitude' }]);
  property.set('searchKeywords', deriveKeywords(property));

  const after = property.toObject() as Record<string, unknown>;
  const changed = keys.filter((k) => !same(before[k], after[k]));
  if (changed.length === 0) return serializeProperty(tenant, property);

  await runUnitOfWork(async (uow) => {
    await property.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'UPDATE', description: `Updated ${changed.join(', ')}`, metadata: { changed } }, uow.session);
    await recordAudit(
      { organizationId: tenant.organizationId, actorId: userId, action: 'property.updated', resource: 'property', resourceId: property._id, before: pick(before, changed), after: { ...pick(after, changed), changedFields: changed }, meta },
      uow.session,
    );
  });
  return serializeProperty(tenant, property);
}

/* ------------------------------------------- status, assign, archive, restore */

export async function updatePropertyStatus(tenant: TenantContext, userId: string, id: string, status: string, meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  assertCanModify(tenant, userId, property);
  const previous = property.propertyStatus;
  if (previous === status) return serializeProperty(tenant, property);

  // A manual closed status must match the listing type (SALE->SOLD, RENT->RENTED, LEASE->LEASED).
  if (CLOSED_STATUSES.includes(status) && CLOSED_PROPERTY_STATUS[property.listingType as keyof typeof CLOSED_PROPERTY_STATUS] !== status) {
    throw AppError.validation([{ path: 'propertyStatus', message: `A ${property.listingType} listing cannot be marked ${status}` }]);
  }

  await runUnitOfWork(async (uow) => {
    property.propertyStatus = status as never;
    property.closedByDealId = null; // a manual change breaks the link to the deal that closed it
    await property.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'STATUS_CHANGE', description: `Status changed from ${previous} to ${status}`, metadata: { from: previous, to: status } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.status_changed', resource: 'property', resourceId: property._id, before: { propertyStatus: previous }, after: { propertyStatus: status }, meta }, uow.session);
  });
  return serializeProperty(tenant, property);
}

export async function assignProperty(tenant: TenantContext, userId: string, id: string, assignedTo: string | null, meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);
  const previous = property.assignedTo ? String(property.assignedTo) : null;
  if (previous === assignedTo) return serializeProperty(tenant, property);

  const users = await loadUsers([previous, assignedTo]);
  const name = (uid: string | null) => (uid ? (users.get(uid)?.name ?? 'a former member') : null);
  const description = !assignedTo ? `Unassigned (was ${name(previous)})` : previous ? `Reassigned from ${name(previous)} to ${name(assignedTo)}` : `Assigned to ${name(assignedTo)}`;

  await runUnitOfWork(async (uow) => {
    property.assignedTo = (assignedTo ?? null) as never;
    await property.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'ASSIGNMENT', description, metadata: { from: previous, to: assignedTo, assignedBy: userId } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.assigned', resource: 'property', resourceId: property._id, before: { assignedTo: previous }, after: { assignedTo }, meta }, uow.session);
  });
  return serializeProperty(tenant, property);
}

export async function archiveProperty(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  assertCanModify(tenant, userId, property);
  const open = await Deal.exists({ organizationId: tenant.organizationId, propertyId: property._id, stage: { $in: OPEN_DEAL_STAGES }, deletedAt: null });
  if (open) throw AppError.conflict('This property has open deals. Close or archive them first.', 'PROPERTY_HAS_OPEN_DEALS');

  await runUnitOfWork(async (uow) => {
    property.deletedAt = new Date();
    property.deletedBy = userId as never;
    await property.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'UPDATE', description: 'Property archived' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.archived', resource: 'property', resourceId: property._id, meta }, uow.session);
  });
  return serializeProperty(tenant, property);
}

export async function restoreProperty(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const property = await findProperty(tenant, id, { archived: true });
  await runUnitOfWork(async (uow) => {
    property.deletedAt = null;
    property.set('deletedBy', undefined);
    await property.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'UPDATE', description: 'Property restored' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.restored', resource: 'property', resourceId: property._id, meta }, uow.session);
  });
  return serializeProperty(tenant, property);
}

/* ------------------------------------------------------------------ images */

type UploadedFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

export async function addImages(tenant: TenantContext, userId: string, id: string, files: UploadedFile[], meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  assertCanModify(tenant, userId, property);
  if (files.length === 0) throw AppError.validation([{ path: 'images', message: 'Attach at least one image using the "images" field' }]);
  if (property.images.length + files.length > MAX_PROPERTY_IMAGES) {
    throw AppError.validation([{ path: 'images', message: `A property can have at most ${MAX_PROPERTY_IMAGES} images` }]);
  }
  const validated = files.map((f, i) => validateImage(f, i)); // validate everything before storing anything

  const storage = getStorage();
  const stored: Array<{ _id: Types.ObjectId; key: string; url: string; mimeType: string; size: number; originalName: string; uploadedBy: string; uploadedAt: Date }> = [];
  try {
    for (const img of validated) {
      const key = imageKey(tenant.organizationId, String(property._id), img.extension);
      const { url } = await storage.put(key, img.buffer, img.mimeType);
      stored.push({ _id: new Types.ObjectId(), key, url, mimeType: img.mimeType, size: img.size, originalName: img.originalName, uploadedBy: userId, uploadedAt: new Date() });
    }
    // The positional guard makes the 20-image cap race-safe: index (MAX - n) must not exist yet.
    const res = await Property.updateOne(
      { _id: property._id, organizationId: tenant.organizationId, deletedAt: null, [`images.${MAX_PROPERTY_IMAGES - stored.length}`]: { $exists: false } },
      { $push: { images: { $each: stored } } },
    );
    if (res.matchedCount === 0) throw AppError.conflict('Image limit reached or the property changed. Refresh and try again.', 'IMAGE_LIMIT');
    await Property.updateOne({ _id: property._id, primaryImage: null }, { $set: { primaryImage: stored[0]!._id } });
  } catch (err) {
    await Promise.allSettled(stored.map((s) => storage.delete(s.key))); // no orphaned files
    throw err;
  }

  await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'UPDATE', description: `Added ${stored.length} image${stored.length === 1 ? '' : 's'}` });
  await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.images_added', resource: 'property', resourceId: property._id, after: { count: stored.length }, meta });
  return serializeProperty(tenant, await findProperty(tenant, id));
}

export async function removeImage(tenant: TenantContext, userId: string, id: string, imageId: string, meta: RequestMeta) {
  const property = await findProperty(tenant, id);
  assertCanModify(tenant, userId, property);
  const image = property.images.find((i) => String(i._id) === imageId);
  if (!image) throw AppError.notFound('Image not found');

  const remaining = property.images.filter((i) => String(i._id) !== imageId);
  const wasPrimary = String(property.primaryImage) === imageId;
  await Property.updateOne(
    { _id: property._id, organizationId: tenant.organizationId },
    { $pull: { images: { _id: image._id } }, ...(wasPrimary ? { $set: { primaryImage: remaining[0]?._id ?? null } } : {}) },
  );
  await getStorage().delete(image.key).catch(() => undefined); // DB is the source of truth; a leftover file is harmless

  await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: property._id, activityType: 'UPDATE', description: 'Removed an image' });
  await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.image_removed', resource: 'property', resourceId: property._id, meta });
  return serializeProperty(tenant, await findProperty(tenant, id));
}

/* -------------------------------------------------------------- activities */

export async function listActivities(tenant: TenantContext, id: string, q: ActivitiesQuery) {
  const property = await findProperty(tenant, id, { any: can(tenant, 'properties:delete') });
  const filter = { organizationId: tenant.organizationId, entityType: 'PROPERTY' as const, entityId: property._id, ...(q.type ? { activityType: q.type } : {}) };
  const [items, total] = await Promise.all([
    Activity.find(filter as never).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Activity.countDocuments(filter as never),
  ]);
  const users = await loadUsers(items.map((a) => a.userId));
  return {
    items: items.map((a) => ({
      _id: String(a._id), activityType: a.activityType, description: a.description,
      user: users.get(String(a.userId)) ? { _id: String(a.userId), name: users.get(String(a.userId))!.name } : null,
      createdAt: new Date(a.createdAt).toISOString(),
    })),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}