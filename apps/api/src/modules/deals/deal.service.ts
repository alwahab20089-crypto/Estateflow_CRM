import { Types } from 'mongoose';
import { CLOSED_PROPERTY_STATUS } from '../../constants';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { Activity } from '../activities/activity.model';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { changeKey, emitEntityEvent } from '../automations/automation.events';
import { Contact } from '../contacts/contact.model';
import { contactScope } from '../contacts/contact.service';
import { fullName } from '../contacts/contact.serializer';
import { Lead } from '../leads/lead.model';
import { buildSearchFilter } from '../leads/lead.search';
import type { UserBrief } from '../leads/lead.serializer';
import type { ActivitiesQuery } from '../leads/lead.validation';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { Organization } from '../organizations/organization.model';
import { Property } from '../properties/property.model';
import { User } from '../users/user.model';
import { Deal } from './deal.model';
import {
  assertStageTransition, CLOSE_WON_FROM, isDealable, OPEN_DEAL_STAGES, REOPEN_STAGE, STAGE_CONFIG, TERMINAL_DEAL_STAGES,
} from './deal.lifecycle';
import { toDealDto, type DealLike } from './deal.serializer';
import type { CloseWonInput, CreateDealInput, DealStageInput, ListDealsQuery, UpdateDealInput } from './deal.validation';

type Id = string | Types.ObjectId;
const MAX_SKIP = 50_000;
const oid = (v: Id) => new Types.ObjectId(String(v));
const can = (t: TenantContext, p: string) => t.permissions.includes(p);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const AUDIT_KEYS = ['dealType', 'stage', 'valueAmount', 'currency', 'probability'];
const pick = (src: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => AUDIT_KEYS.includes(k)).map((k) => [k, src[k] ?? null]));
const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Agents see deals they are assigned or created; deals:read_all widens that to the organization. */
export function dealScope(tenant: TenantContext, userId: string) {
  const filter: Record<string, unknown> = { organizationId: oid(tenant.organizationId), deletedAt: null };
  if (!can(tenant, 'deals:read_all')) filter.$or = [{ assignedTo: oid(userId) }, { createdBy: oid(userId) }];
  return filter;
}

export async function findDeal(tenant: TenantContext, userId: string, id: string) {
  const deal = await Deal.findOne({ ...dealScope(tenant, userId), _id: oid(id) } as never);
  if (!deal) throw AppError.notFound('Deal not found'); // identical for missing, other tenant and not yours
  return deal;
}

/* ------------------------------------------------------------------ helpers */

async function loadBriefs(tenant: TenantContext, deals: DealLike[]) {
  const ids = (pick_: (d: DealLike) => Id | null | undefined) => [...new Set(deals.map(pick_).filter(Boolean).map(String))];
  const org = { organizationId: tenant.organizationId };
  const [users, contacts, leads, properties] = await Promise.all([
    User.find({ _id: { $in: ids((d) => d.assignedTo) } }).select('name email avatar').lean(),
    Contact.find({ ...org, _id: { $in: ids((d) => d.contactId) } }).select('firstName lastName').lean(),
    Lead.find({ ...org, _id: { $in: ids((d) => d.leadId) } } as never).select('firstName lastName').lean(),
    Property.find({ ...org, _id: { $in: ids((d) => d.propertyId) } }).select('title city propertyStatus').lean(),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x as UserBrief]));
  const c = new Map(contacts.map((x) => [String(x._id), { _id: String(x._id), fullName: fullName(x) }]));
  const l = new Map(leads.map((x) => [String(x._id), { _id: String(x._id), name: fullName(x as { firstName: string; lastName?: string | null }) }]));
  const p = new Map(properties.map((x) => [String(x._id), { _id: String(x._id), title: x.title, city: x.city ?? null, propertyStatus: x.propertyStatus }]));
  return (d: DealLike) => ({
    assignee: d.assignedTo ? (u.get(String(d.assignedTo)) ?? null) : null,
    contact: c.get(String(d.contactId)) ?? null,
    lead: d.leadId ? (l.get(String(d.leadId)) ?? null) : null,
    property: p.get(String(d.propertyId)) ?? null,
  });
}

export async function serializeDeal(tenant: TenantContext, deal: DealLike) {
  const briefs = await loadBriefs(tenant, [deal]);
  return toDealDto(deal, briefs(deal));
}

/** Contact, lead and property must belong to this organization (and be visible to this user). */
async function validateReferences(
  tenant: TenantContext, userId: string,
  refs: { contactId?: string; leadId?: string | null; propertyId?: string; dealType: string; checkAvailability: boolean },
) {
  if (refs.contactId) {
    const ok = await Contact.exists({ ...contactScope(tenant, userId), _id: refs.contactId } as never);
    if (!ok) throw AppError.validation([{ path: 'contactId', message: 'The selected contact does not belong to this organization' }]);
  }
  if (refs.leadId) {
    const f: Record<string, unknown> = { organizationId: tenant.organizationId, deletedAt: null, _id: refs.leadId };
    if (!can(tenant, 'leads:read_all')) f.assignedTo = userId;
    if (!(await Lead.exists(f as never))) throw AppError.validation([{ path: 'leadId', message: 'The selected lead does not belong to this organization' }]);
  }
  if (!refs.propertyId) return null;
  const property = await Property.findOne({ _id: refs.propertyId, organizationId: tenant.organizationId, deletedAt: null });
  if (!property) throw AppError.validation([{ path: 'propertyId', message: 'The selected property does not belong to this organization' }]);
  if (property.listingType !== refs.dealType) {
    throw AppError.validation([{ path: 'dealType', message: `A ${refs.dealType} deal cannot be created for a property listed for ${property.listingType}` }]);
  }
  if (refs.checkAvailability && !isDealable(property.propertyStatus)) {
    throw AppError.validation([{ path: 'propertyId', message: `This property is ${property.propertyStatus} and cannot take a new deal` }]);
  }
  return property;
}

const assertDateNotFuture = (d: Date, path: string) => {
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw AppError.validation([{ path, message: 'The closing date cannot be in the future' }]);
};

/* ------------------------------------------------------------------ create */

export async function createDeal(tenant: TenantContext, userId: string, input: CreateDealInput, meta: RequestMeta) {
  const canAssign = can(tenant, 'deals:assign');
  let assignedTo = input.assignedTo ?? null;
  if (assignedTo && assignedTo !== userId && !canAssign) throw AppError.forbidden('You do not have permission to assign deals to other members');
  if (!assignedTo && !canAssign) assignedTo = userId;
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);

  const property = await validateReferences(tenant, userId, { contactId: input.contactId, leadId: input.leadId, propertyId: input.propertyId, dealType: input.dealType, checkAvailability: true });
  const org = await Organization.findById(tenant.organizationId).select('currency').lean();

  const doc = {
    organizationId: tenant.organizationId,
    createdBy: userId,
    assignedTo,
    title: input.title,
    description: input.description ?? undefined,
    contactId: input.contactId,
    leadId: input.leadId ?? null,
    propertyId: input.propertyId,
    dealType: input.dealType,
    stage: 'NEW' as const, // new deals always start at NEW
    valueAmount: input.valueAmount,
    currency: input.currency ?? property?.currency ?? org?.currency ?? 'USD',
    probability: input.probability ?? STAGE_CONFIG.NEW.probability,
    expectedClosingDate: input.expectedClosingDate ?? null,
    notes: input.notes ?? undefined,
    stageChangedAt: new Date(),
    searchKeywords: [...new Set(input.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 30),
  };

  const deal = await runUnitOfWork(async (uow) => {
    const [created] = await Deal.create([doc], { session: uow.session });
    uow.onRollback(() => Deal.deleteOne({ _id: created!._id }));
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: created!._id, activityType: 'CREATED', description: 'Deal created' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.created', resource: 'deal', resourceId: created!._id, after: { ...pick(doc, AUDIT_KEYS), assignedTo, propertyId: input.propertyId }, meta }, uow.session);
    return created!;
  });

  await emitEntityEvent({
    type: 'DEAL_CREATED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
  });

  return serializeDeal(tenant, deal);
}

/* -------------------------------------------------------------------- read */

const SORT_FIELDS = { createdAt: 'createdAt', value: 'valueAmount', expectedClosingDate: 'expectedClosingDate', title: 'title' } as const;

export async function listDeals(tenant: TenantContext, userId: string, q: ListDealsQuery) {
  const base = dealScope(tenant, userId);
  if (q.dealType) base.dealType = q.dealType;
  if (q.assignedTo && can(tenant, 'deals:read_all')) base.assignedTo = q.assignedTo === 'unassigned' ? null : oid(q.assignedTo);
  if (q.contactId) base.contactId = oid(q.contactId);
  if (q.propertyId) base.propertyId = oid(q.propertyId);
  if (q.leadId) base.leadId = oid(q.leadId);
  if (q.expectedClosingFrom || q.expectedClosingTo) {
    base.expectedClosingDate = { ...(q.expectedClosingFrom ? { $gte: q.expectedClosingFrom } : {}), ...(q.expectedClosingTo ? { $lte: q.expectedClosingTo } : {}) };
  }
  if (q.minValue !== undefined || q.maxValue !== undefined) {
    base.valueAmount = { ...(q.minValue !== undefined ? { $gte: q.minValue } : {}), ...(q.maxValue !== undefined ? { $lte: q.maxValue } : {}) };
  }
  if (q.search) Object.assign(base, buildSearchFilter(q.search) ?? {});
  const filter = q.stage ? { ...base, stage: q.stage } : base;

  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const sort = { [SORT_FIELDS[q.sortBy]]: dir, _id: dir } as Record<string, 1 | -1>;
  const skip = (q.page - 1) * q.limit;
  if (skip > MAX_SKIP) throw AppError.validation([{ path: 'page', message: 'Page is too deep. Narrow your filters instead.' }]);

  const [items, total, summary] = await Promise.all([
    Deal.find(filter as never).sort(sort).skip(skip).limit(q.limit).lean(),
    Deal.countDocuments(filter as never),
    // Stage counts and value for the pipeline header: same filters, but not narrowed by stage.
    Deal.aggregate<{ _id: { stage: string; currency: string }; count: number; totalAmount: number }>([
      { $match: base },
      { $group: { _id: { stage: '$stage', currency: '$currency' }, count: { $sum: 1 }, totalAmount: { $sum: '$valueAmount' } } },
    ]),
  ]);
  const briefs = await loadBriefs(tenant, items as DealLike[]);
  return {
    items: items.map((d) => toDealDto(d as DealLike, briefs(d as DealLike))),
    meta: {
      page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)),
      summary: summary.map((s) => ({ stage: s._id.stage, currency: s._id.currency, count: s.count, totalAmount: s.totalAmount })),
    },
  };
}

export async function getDeal(tenant: TenantContext, userId: string, id: string) {
  return serializeDeal(tenant, await findDeal(tenant, userId, id));
}

/* ------------------------------------------------------------------ update */

export async function updateDeal(tenant: TenantContext, userId: string, id: string, input: UpdateDealInput, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  if (STAGE_CONFIG[deal.stage as keyof typeof STAGE_CONFIG].terminal) throw AppError.conflict('Closed deals cannot be edited. Reopen the deal first.', 'DEAL_CLOSED');

  const dealType = input.dealType ?? deal.dealType;
  const propertyChanged = input.propertyId !== undefined && input.propertyId !== String(deal.propertyId);
  if (propertyChanged || input.dealType || input.contactId || input.leadId) {
    await validateReferences(tenant, userId, {
      contactId: input.contactId && input.contactId !== String(deal.contactId) ? input.contactId : undefined,
      leadId: input.leadId && input.leadId !== String(deal.leadId) ? input.leadId : undefined,
      propertyId: input.propertyId ?? String(deal.propertyId),
      dealType,
      checkAvailability: propertyChanged,
    });
  }

  const keys = Object.keys(input) as Array<keyof UpdateDealInput>;
  const before = deal.toObject() as Record<string, unknown>;
  for (const key of keys) {
    const value = input[key];
    deal.set(key, value === null ? undefined : value);
  }
  if (input.title) deal.set('searchKeywords', [...new Set(input.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 30));
  const after = deal.toObject() as Record<string, unknown>;
  const changed = keys.filter((k) => !same(before[k], after[k]));
  if (changed.length === 0) return serializeDeal(tenant, deal);

  await runUnitOfWork(async (uow) => {
    await deal.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'UPDATE', description: `Updated ${changed.join(', ')}`, metadata: { changed } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.updated', resource: 'deal', resourceId: deal._id, before: pick(before, changed), after: { ...pick(after, changed), changedFields: changed }, meta }, uow.session);
  });
  return serializeDeal(tenant, deal);
}

/* ---------------------------------------------------- stage, assign, delete */

export async function changeStage(tenant: TenantContext, userId: string, id: string, input: DealStageInput, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  const from = deal.stage as keyof typeof STAGE_CONFIG;
  assertStageTransition(from, input.stage);
  const probability = input.probability ?? STAGE_CONFIG[input.stage].probability;
  const previousProbability = deal.probability;

  const updated = await runUnitOfWork(async (uow) => {
    // Conditional on the stage we validated against: a concurrent change makes this a clean 409, not a lost update.
    const doc = await Deal.findOneAndUpdate(
      { _id: deal._id, organizationId: tenant.organizationId, stage: from, deletedAt: null },
      { $set: { stage: input.stage, probability, stageChangedAt: new Date() } },
      { returnDocument: 'after', session: uow.session },
    );
    if (!doc) throw AppError.conflict('This deal was changed by someone else. Refresh and try again.', 'STALE_DEAL');
    uow.onRollback(() => Deal.updateOne({ _id: deal._id, stage: input.stage }, { $set: { stage: from, probability: previousProbability } }));
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'STATUS_CHANGE', description: `Stage changed from ${STAGE_CONFIG[from].label} to ${STAGE_CONFIG[input.stage].label}`, metadata: { from, to: input.stage } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.stage_changed', resource: 'deal', resourceId: deal._id, before: { stage: from }, after: { stage: input.stage, probability }, meta }, uow.session);
    return doc;
  });

  await emitEntityEvent({
    type: 'DEAL_STAGE_CHANGED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    from,
    to: input.stage,
    key: changeKey(from, input.stage),
  });

  return serializeDeal(tenant, updated);
}

export async function assignDeal(tenant: TenantContext, userId: string, id: string, assignedTo: string | null, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);
  const previous = deal.assignedTo ? String(deal.assignedTo) : null;
  if (previous === assignedTo) return serializeDeal(tenant, deal);

  const names = new Map((await User.find({ _id: { $in: [previous, assignedTo].filter(Boolean) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const name = (uid: string | null) => (uid ? (names.get(uid) ?? 'a former member') : null);
  const description = !assignedTo ? `Unassigned (was ${name(previous)})` : previous ? `Reassigned from ${name(previous)} to ${name(assignedTo)}` : `Assigned to ${name(assignedTo)}`;

  await runUnitOfWork(async (uow) => {
    deal.assignedTo = (assignedTo ?? null) as never;
    await deal.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'ASSIGNMENT', description, metadata: { from: previous, to: assignedTo, assignedBy: userId } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.assigned', resource: 'deal', resourceId: deal._id, before: { assignedTo: previous }, after: { assignedTo }, meta }, uow.session);
  });

  await emitEntityEvent({
    type: 'DEAL_ASSIGNED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    from: previous,
    to: assignedTo,
    key: changeKey(previous, assignedTo),
  });

  return serializeDeal(tenant, deal);
}

export async function archiveDeal(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  if (deal.stage === 'WON') throw AppError.conflict('Won deals are part of your sales history and cannot be deleted.', 'DEAL_WON');
  await runUnitOfWork(async (uow) => {
    deal.deletedAt = new Date();
    deal.deletedBy = userId as never;
    await deal.save({ session: uow.session });
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'UPDATE', description: 'Deal archived' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.archived', resource: 'deal', resourceId: deal._id, meta }, uow.session);
  });
  return serializeDeal(tenant, deal);
}

/* ------------------------------------------------------- close won / lost */

/**
 * Closing WON claims the property with ONE atomic conditional update (status must still be dealable), then flips the deal
 * with a second conditional update. The property claim is the lock: of two racing closes only one can succeed, with or
 * without transactions. On a replica set both writes also share a transaction. On a standalone mongod there is no
 * multi-document atomicity: a failure after the claim triggers a compensating undo (best effort), which is why
 * production should run a replica set. A partial unique index additionally forbids two WON deals on one property.
 */
export async function closeWon(tenant: TenantContext, userId: string, id: string, input: CloseWonInput, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  if (!(CLOSE_WON_FROM as readonly string[]).includes(deal.stage)) {
    throw AppError.conflict(`Only deals in ${CLOSE_WON_FROM.join(' or ')} can be closed as won.`, 'INVALID_STAGE_TRANSITION');
  }
  const closing = input.actualClosingDate ?? new Date();
  assertDateNotFuture(closing, 'actualClosingDate');
  const value = input.valueAmount ?? deal.valueAmount;
  const closedStatus = CLOSED_PROPERTY_STATUS[deal.dealType as keyof typeof CLOSED_PROPERTY_STATUS];
  const from = deal.stage;
  let previousPropertyStatus: string | undefined;

  try {
    await runUnitOfWork(async (uow) => {
      const previousProperty = await Property.findOneAndUpdate(
        { _id: deal.propertyId, organizationId: tenant.organizationId, deletedAt: null, propertyStatus: { $in: ['AVAILABLE', 'UNDER_OFFER', 'RESERVED'] } },
        { $set: { propertyStatus: closedStatus, closedByDealId: deal._id } },
        { returnDocument: 'before', session: uow.session }, // returns the document as it was, for the undo step
      );
      if (!previousProperty) {
        throw AppError.conflict('This property is no longer available (it may already be sold, rented, leased or archived).', 'PROPERTY_NOT_AVAILABLE');
      }
      previousPropertyStatus = previousProperty.propertyStatus;
      uow.onRollback(() => Property.updateOne({ _id: deal.propertyId, closedByDealId: deal._id }, { $set: { propertyStatus: previousProperty.propertyStatus, closedByDealId: null } }));

      const won = await Deal.findOneAndUpdate(
        { _id: deal._id, organizationId: tenant.organizationId, stage: from, deletedAt: null },
        { $set: { stage: 'WON', probability: 100, valueAmount: value, actualClosingDate: closing, stageChangedAt: new Date(), ...(input.notes ? { notes: input.notes } : {}) } },
        { returnDocument: 'after', session: uow.session },
      );
      if (!won) throw AppError.conflict('This deal was changed by someone else. Refresh and try again.', 'STALE_DEAL');

      await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'STATUS_CHANGE', description: 'Deal closed as won', metadata: { from, to: 'WON', valueAmount: value } }, uow.session);
      await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: deal.propertyId, activityType: 'STATUS_CHANGE', description: `Status changed from ${previousProperty.propertyStatus} to ${closedStatus} (deal "${deal.title}")`, metadata: { from: previousProperty.propertyStatus, to: closedStatus, dealId: String(deal._id) } }, uow.session);
      await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.won', resource: 'deal', resourceId: deal._id, before: { stage: from, valueAmount: deal.valueAmount }, after: { stage: 'WON', valueAmount: value, propertyStatus: closedStatus }, meta }, uow.session);
      await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'property.status_changed', resource: 'property', resourceId: deal.propertyId, before: { propertyStatus: previousProperty.propertyStatus }, after: { propertyStatus: closedStatus, dealId: String(deal._id) }, meta }, uow.session);
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw AppError.conflict('Another deal has already been won for this property.', 'PROPERTY_NOT_AVAILABLE');
    throw err;
  }

  await emitEntityEvent({
    type: 'DEAL_STAGE_CHANGED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    from,
    to: 'WON',
    key: changeKey(from, 'WON'),
  });

  await emitEntityEvent({
    type: 'DEAL_WON',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    key: 'once',
  });

  if (previousPropertyStatus) {
    await emitEntityEvent({
      type: 'PROPERTY_STATUS_CHANGED',
      entityType: 'PROPERTY',
      entityId: deal.propertyId,
      organizationId: tenant.organizationId,
      actorId: userId,
      from: previousPropertyStatus,
      to: closedStatus,
      key: changeKey(previousPropertyStatus, closedStatus),
    });
  }

  return getDeal(tenant, userId, id);
}

export async function closeLost(tenant: TenantContext, userId: string, id: string, lostReason: string, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);
  if (!(OPEN_DEAL_STAGES as readonly string[]).includes(deal.stage)) throw AppError.conflict('This deal is already closed.', 'DEAL_CLOSED');
  const from = deal.stage;

  await runUnitOfWork(async (uow) => {
    const lost = await Deal.findOneAndUpdate(
      { _id: deal._id, organizationId: tenant.organizationId, stage: from, deletedAt: null },
      { $set: { stage: 'LOST', probability: 0, lostReason, actualClosingDate: new Date(), stageChangedAt: new Date() } },
      { returnDocument: 'after', session: uow.session },
    );
    if (!lost) throw AppError.conflict('This deal was changed by someone else. Refresh and try again.', 'STALE_DEAL');
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'STATUS_CHANGE', description: 'Deal closed as lost', metadata: { from, to: 'LOST', lostReason } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.lost', resource: 'deal', resourceId: deal._id, before: { stage: from }, after: { stage: 'LOST', lostReason }, meta }, uow.session);
  });

  await emitEntityEvent({
    type: 'DEAL_STAGE_CHANGED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    from,
    to: 'LOST',
    key: changeKey(from, 'LOST'),
  });

  await emitEntityEvent({
    type: 'DEAL_LOST',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    key: 'once',
  });

  return getDeal(tenant, userId, id);
}

export async function reopenDeal(tenant: TenantContext, userId: string, id: string, reason: string, meta: RequestMeta) {
  const deal = await findDeal(tenant, userId, id);

  if (!can(tenant, 'deals:reopen')) {
    throw AppError.forbidden();
  }
  if (!(TERMINAL_DEAL_STAGES as readonly string[]).includes(deal.stage)) throw AppError.conflict('Only closed deals can be reopened.', 'DEAL_NOT_CLOSED');
  const old = deal.toObject();

  await runUnitOfWork(async (uow) => {
    const reopened = await Deal.findOneAndUpdate(
      { _id: deal._id, organizationId: tenant.organizationId, stage: old.stage, deletedAt: null },
      { $set: { stage: REOPEN_STAGE, probability: STAGE_CONFIG[REOPEN_STAGE].probability, stageChangedAt: new Date() }, $unset: { actualClosingDate: 1, lostReason: 1 } },
      { returnDocument: 'after', session: uow.session },
    );
    if (!reopened) throw AppError.conflict('This deal was changed by someone else. Refresh and try again.', 'STALE_DEAL');
    uow.onRollback(() => Deal.updateOne({ _id: deal._id }, { $set: { stage: old.stage, probability: old.probability, actualClosingDate: old.actualClosingDate, lostReason: old.lostReason } }));

    let released = false;
    if (old.stage === 'WON') {
      // Release the property only if THIS deal is the one that closed it.
      const prop = await Property.findOneAndUpdate(
        { _id: old.propertyId, organizationId: tenant.organizationId, closedByDealId: deal._id },
        { $set: { propertyStatus: 'AVAILABLE', closedByDealId: null } },
        { returnDocument: 'before', session: uow.session },
      );
      if (prop) {
        released = true;
        uow.onRollback(() => Property.updateOne({ _id: old.propertyId }, { $set: { propertyStatus: prop.propertyStatus, closedByDealId: deal._id } }));
        await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'PROPERTY', entityId: old.propertyId, activityType: 'STATUS_CHANGE', description: `Status changed from ${prop.propertyStatus} to AVAILABLE (deal "${deal.title}" reopened)`, metadata: { from: prop.propertyStatus, to: 'AVAILABLE', dealId: String(deal._id) } }, uow.session);
      }
    }
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'DEAL', entityId: deal._id, activityType: 'STATUS_CHANGE', description: `Deal reopened: ${reason}`, metadata: { from: old.stage, to: REOPEN_STAGE, reason, propertyReleased: released } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'deal.reopened', resource: 'deal', resourceId: deal._id, before: { stage: old.stage }, after: { stage: REOPEN_STAGE, reason, propertyReleased: released }, meta }, uow.session);
  });

  await emitEntityEvent({
    type: 'DEAL_STAGE_CHANGED',
    entityType: 'DEAL',
    entityId: deal._id,
    organizationId: tenant.organizationId,
    actorId: userId,
    from: old.stage,
    to: REOPEN_STAGE,
    key: changeKey(String(old.stage), REOPEN_STAGE),
  });

  return getDeal(tenant, userId, id);
}

/* -------------------------------------------------------------- activities */

export async function listActivities(tenant: TenantContext, userId: string, id: string, q: ActivitiesQuery) {
  const deal = await findDeal(tenant, userId, id);
  const filter = { organizationId: tenant.organizationId, entityType: 'DEAL' as const, entityId: deal._id, ...(q.type ? { activityType: q.type } : {}) };
  const [items, total] = await Promise.all([
    Activity.find(filter as never).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Activity.countDocuments(filter as never),
  ]);
  const users = new Map((await User.find({ _id: { $in: items.map((a) => a.userId) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  return {
    items: items.map((a) => ({
      _id: String(a._id), activityType: a.activityType, description: a.description,
      user: users.has(String(a.userId)) ? { _id: String(a.userId), name: users.get(String(a.userId))! } : null,
      createdAt: new Date(a.createdAt).toISOString(),
    })),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}