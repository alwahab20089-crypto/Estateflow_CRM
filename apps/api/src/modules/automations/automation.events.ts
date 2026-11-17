import { Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Contact } from '../contacts/contact.model';
import { Deal } from '../deals/deal.model';
import { Lead } from '../leads/lead.model';
import { Property } from '../properties/property.model';
import { Task } from '../tasks/task.model';
import type { AutomationEntity, TriggerType } from './automation.constants';
import { automationContext } from './automation.context';
import { AutomationEvent } from './automation.model';

type Id = string | Types.ObjectId;
type Obj = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

/** Idempotency discriminator for "changed" events. */
export const changeKey = (from: unknown, to: unknown) => `${str(from) ?? ''}>${str(to) ?? ''}@${Date.now()}`;

/** Point-in-time snapshot of the fields conditions and recipients may use. Tenant-scoped read. */
export async function snapshotEntity(entity: AutomationEntity, organizationId: Id, id: Id): Promise<Obj | null> {
  const q = { _id: id, organizationId };
  const common = (d: Obj) => ({ assignedTo: str(d.assignedTo), createdBy: str(d.createdBy) });
  switch (entity) {
    case 'LEAD': {
      const d = (await Lead.findOne(q).lean()) as Obj | null;
      return d && { entityType: entity, name: [d.firstName, d.lastName].filter(Boolean).join(' '), status: d.status, priority: d.priority, leadType: d.leadType, leadSource: d.leadSource, ...common(d) };
    }
    case 'CONTACT': {
      const d = (await Contact.findOne(q).lean()) as Obj | null;
      return d && { entityType: entity, name: [d.firstName, d.lastName].filter(Boolean).join(' '), status: d.status, contactType: d.contactType, source: d.source, ...common(d) };
    }
    case 'PROPERTY': {
      const d = (await Property.findOne(q).lean()) as Obj | null;
      return d && { entityType: entity, name: d.title, propertyStatus: d.propertyStatus, propertyType: d.propertyType, listingType: d.listingType, priceAmount: d.priceAmount ?? null, ...common(d) };
    }
    case 'DEAL': {
      const d = (await Deal.findOne(q).lean()) as Obj | null;
      return d && { entityType: entity, name: d.title, stage: d.stage, dealType: d.dealType, currency: d.currency, valueAmount: d.valueAmount, probability: d.probability, expectedClosingDate: iso(d.expectedClosingDate), ...common(d) };
    }
    case 'TASK': {
      const d = (await Task.findOne(q).lean()) as Obj | null;
      return d && { entityType: entity, name: d.title, status: d.status, priority: d.priority, taskType: d.taskType, dueAt: iso(d.dueAt), ...common(d) };
    }
  }
}

const ENTITY_OF: Record<string, AutomationEntity> = { LEAD: 'LEAD', CONTACT: 'CONTACT', PROPERTY: 'PROPERTY', DEAL: 'DEAL', TASK: 'TASK' };

export interface EmitInput {
  type: TriggerType;
  entityType: AutomationEntity;
  entityId: Id;
  organizationId: Id;
  actorId?: Id | null;
  from?: unknown;
  to?: unknown;
  /** Discriminator that makes the event unique. Defaults to a one-per-entity key (use changeKey() for repeatable changes). */
  key?: string;
  /** Time-based events target one workflow. */
  workflowId?: Id | null;
}

/**
 * Durably records a business event for the automation engine. NEVER throws: a failed emit is logged and must not
 * break the originating request. The unique (organizationId, idempotencyKey) index makes duplicates harmless.
 *
 * Without multi-document transactions a crash between the business commit and this insert can lose an event. The
 * trade-off is documented; a missed event is preferable to a business write that fails or rolls back because of
 * automation.
 */
export async function emitEntityEvent(input: EmitInput): Promise<void> {
  try {
    if (!ENTITY_OF[input.entityType]) return;
    const ctx = automationContext.getStore();
    const depth = ctx ? ctx.depth + 1 : 0;
    if (depth > env.AUTOMATION_MAX_DEPTH) {
      logger.warn({ type: input.type, depth, executionId: ctx?.executionId }, 'automation depth limit reached; event dropped');
      return;
    }
    const snap = await snapshotEntity(input.entityType, input.organizationId, input.entityId);
    if (!snap) return;
    const payload = { ...snap, entityId: String(input.entityId), from: str(input.from), to: str(input.to) };
    const wf = input.workflowId ? String(input.workflowId) : '';
    const idempotencyKey = `${input.type}:${wf}:${String(input.entityId)}:${input.key ?? 'once'}`.slice(0, 250);

    await AutomationEvent.updateOne(
      { organizationId: input.organizationId, idempotencyKey },
      {
        $setOnInsert: {
          type: input.type, entityType: input.entityType, entityId: input.entityId, workflowId: input.workflowId ?? null,
          actorId: input.actorId ?? null, payload, depth, chain: (ctx?.chain ?? []).map((c) => new Types.ObjectId(c)),
          status: 'PENDING', attempts: 0, nextAttemptAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, type: input.type }, 'failed to record automation event');
  }
}