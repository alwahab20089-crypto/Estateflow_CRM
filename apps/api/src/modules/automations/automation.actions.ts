/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { DEAL_STAGES } from '../../constants';
import { emailEnabled } from '../../utils/email-provider';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { Contact } from '../contacts/contact.model';
import { Deal } from '../deals/deal.model';
import { Lead } from '../leads/lead.model';
import { OrganizationMember } from '../members/member.model';
import { createNotification } from '../notifications/notification.service';
import { isEmailPreferred } from '../notifications/notification-preference.service';
import { Property } from '../properties/property.model';
import { syncReminder } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import type { AutomationEntity } from './automation.constants';
import { emitEntityEvent } from './automation.events';
import type { Action, Recipient } from './automation.validation';
import { sendTrackedEmail } from './email-delivery';

export interface ActionContext {
  organizationId: Types.ObjectId;
  workflow: { _id: Types.ObjectId; name: string; createdBy: Types.ObjectId };
  executionId: string;
  index: number;
  payload: Record<string, any>;
}
export interface ActionOutcome { status: 'SUCCESS' | 'SKIPPED'; output?: Record<string, unknown>; reason?: string }

const OPEN_DEAL_STAGES = DEAL_STAGES.filter((s) => s !== 'WON' && s !== 'LOST');
const RELATABLE = ['LEAD', 'CONTACT', 'PROPERTY', 'DEAL'];
const skipped = (reason: string): ActionOutcome => ({ status: 'SKIPPED', reason });
const ok = (output?: Record<string, unknown>): ActionOutcome => ({ status: 'SUCCESS', output });
const key = (c: ActionContext, suffix = '') => `auto:${c.executionId}:${c.index}${suffix}`;
const entityId = (c: ActionContext) => new Types.ObjectId(String(c.payload.entityId));
const entityType = (c: ActionContext) => c.payload.entityType as AutomationEntity;

/** Only these tokens are interpolated; anything else is left as plain text. Output is always plain text. */
function render(template: string, p: Record<string, any>) {
  const vars: Record<string, string> = { name: String(p.name ?? ''), entityType: String(p.entityType ?? '').toLowerCase(), from: String(p.from ?? ''), to: String(p.to ?? '') };
  return template.replace(/\{\{\s*(name|entityType|from|to)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
}

async function freshRefs(c: ActionContext): Promise<{ assignedTo: string | null; createdBy: string | null }> {
  const q = { _id: entityId(c), organizationId: c.organizationId };
  const d: any =
    entityType(c) === 'LEAD' ? await Lead.findOne(q).select('assignedTo createdBy').lean()
    : entityType(c) === 'CONTACT' ? await Contact.findOne(q).select('assignedTo createdBy').lean()
    : entityType(c) === 'PROPERTY' ? await Property.findOne(q).select('assignedTo createdBy').lean()
    : entityType(c) === 'DEAL' ? await Deal.findOne(q).select('assignedTo createdBy').lean()
    : await Task.findOne(q).select('assignedTo createdBy').lean();
  return { assignedTo: d?.assignedTo ? String(d.assignedTo) : (c.payload.assignedTo ?? null), createdBy: d?.createdBy ? String(d.createdBy) : (c.payload.createdBy ?? null) };
}

const isActive = (org: Types.ObjectId, userId: string) =>
  OrganizationMember.exists({ organizationId: org, userId, status: 'ACTIVE', invitationStatus: 'ACCEPTED' });

/** Resolves who an action is for AT EXECUTION TIME. Returns null when nobody (or nobody active) qualifies. */
async function resolve(c: ActionContext, r: Recipient | { mode: string; userId?: string }): Promise<string | null> {
  let id: string | null;
  if (r.mode === 'USER') id = (r as { userId: string }).userId;
  else if (r.mode === 'WORKFLOW_OWNER') id = String(c.workflow.createdBy);
  else {
    const refs = await freshRefs(c);
    id = r.mode === 'CREATOR' ? refs.createdBy : refs.assignedTo;
  }
  return id && (await isActive(c.organizationId, id)) ? id : null;
}

const relatedFor = (c: ActionContext) => (RELATABLE.includes(entityType(c)) ? { type: entityType(c) as 'LEAD', id: entityId(c) } : null);

async function audit(c: ActionContext, action: string, resource: string, resourceId: Types.ObjectId, after: Record<string, unknown>) {
  await recordAudit({ organizationId: c.organizationId, actorId: c.workflow.createdBy, action, resource, resourceId, after: { ...after, automationId: String(c.workflow._id), executionId: c.executionId }, meta: { requestId: c.executionId } } as any);
}
const timeline = (c: ActionContext, type: AutomationEntity, id: Types.ObjectId, activityType: 'ASSIGNMENT' | 'STATUS_CHANGE' | 'CREATED', description: string) =>
  recordActivity({ organizationId: c.organizationId, userId: c.workflow.createdBy, entityType: type, entityId: id, activityType, description, metadata: { automationId: String(c.workflow._id), executionId: c.executionId } } as any);

/* ------------------------------------------------------------------ executors */

async function createTask(c: ActionContext, a: Extract<Action, { type: 'CREATE_TASK' }>): Promise<ActionOutcome> {
  const assignee = await resolve(c, a.assignTo);
  if (!assignee) return skipped('NO_ACTIVE_ASSIGNEE');
  const automationKey = key(c);
  const find = () => Task.findOne({ organizationId: c.organizationId, automationKey }).select('_id').lean();

  let existing = await find();
  if (!existing) {
    const rel = relatedFor(c);
    const dueAt = a.dueInHours !== undefined ? new Date(Date.now() + a.dueInHours * 3_600_000) : null;
    try {
      const [created] = await Task.create([{
        organizationId: c.organizationId, createdBy: c.workflow.createdBy, assignedTo: assignee,
        title: render(a.title, c.payload).slice(0, 200), description: a.description ? render(a.description, c.payload) : undefined,
        taskType: a.taskType ?? 'GENERAL', status: 'TODO', priority: a.priority ?? 'MEDIUM', dueAt,
        reminderAt: null, reminderStatus: 'NONE', reminderVersion: 0,
        relatedEntityType: rel?.type ?? null, relatedEntityId: rel?.id ?? null, tags: ['automation'], automationKey,
      }]);
      existing = { _id: created!._id } as any;
      await timeline(c, 'TASK', created!._id, 'CREATED', `Task created by automation "${c.workflow.name}"`);
      if (rel) await timeline(c, rel.type as AutomationEntity, rel.id, 'CREATED', `Follow-up task created by automation "${c.workflow.name}"`);
      await audit(c, 'automation.task_created', 'task', created!._id, { assignedTo: assignee });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      existing = await find(); // another worker created it first: same key, same task
    }
  }
  const taskId = existing!._id as Types.ObjectId;
  if (assignee !== String(c.workflow.createdBy)) {
    await createNotification({ organizationId: c.organizationId, recipientUserId: assignee, type: 'TASK_ASSIGNED', title: `New task assigned: ${render(a.title, c.payload)}`, message: `Created by automation "${c.workflow.name}".`, taskId, deliveryKey: key(c, ':notify') });
  }
  await emitEntityEvent({ type: 'TASK_CREATED', entityType: 'TASK', entityId: taskId, organizationId: c.organizationId, actorId: c.workflow.createdBy, key: key(c, ':created') });
  return ok({ taskId: String(taskId) });
}

async function assignTask(c: ActionContext, a: Extract<Action, { type: 'ASSIGN_TASK' }>): Promise<ActionOutcome> {
  const target = await resolve(c, a.assignTo);
  if (!target) return skipped('NO_ACTIVE_ASSIGNEE');
  const prev: any = await Task.findOneAndUpdate(
    { _id: entityId(c), organizationId: c.organizationId, deletedAt: null, assignedTo: { $ne: target } },
    { $set: { assignedTo: target } },
  ).lean();
  if (!prev) return skipped('NOT_FOUND_OR_ALREADY_ASSIGNED');
  await timeline(c, 'TASK', prev._id, 'ASSIGNMENT', `Assigned by automation "${c.workflow.name}"`);
  await audit(c, 'automation.task_assigned', 'task', prev._id, { from: prev.assignedTo ? String(prev.assignedTo) : null, to: target });
  await emitEntityEvent({ type: 'TASK_ASSIGNED', entityType: 'TASK', entityId: prev._id, organizationId: c.organizationId, actorId: c.workflow.createdBy, from: prev.assignedTo, to: target, key: key(c) });
  return ok({ taskId: String(prev._id), assignedTo: target });
}

async function updateTaskStatus(c: ActionContext, a: Extract<Action, { type: 'UPDATE_TASK_STATUS' }>): Promise<ActionOutcome> {
  const task: any = await Task.findOne({ _id: entityId(c), organizationId: c.organizationId, deletedAt: null });
  if (!task) return skipped('NOT_FOUND');
  if (task.status === a.status) return skipped('ALREADY_IN_STATUS');
  const from = String(task.status);
  task.set('status', a.status);
  task.set('completedAt', a.status === 'COMPLETED' ? new Date() : null);
  syncReminder(task, false); // same reminder rules as a user-driven status change
  await task.save(); // optimistic concurrency: a VersionError is thrown and the execution retries
  await timeline(c, 'TASK', task._id, 'STATUS_CHANGE', `Status changed from ${from} to ${a.status} by automation "${c.workflow.name}"`);
  await audit(c, 'automation.task_status_changed', 'task', task._id, { from, to: a.status });
  if (a.status === 'COMPLETED') await emitEntityEvent({ type: 'TASK_COMPLETED', entityType: 'TASK', entityId: task._id, organizationId: c.organizationId, actorId: c.workflow.createdBy, key: key(c) });
  return ok({ taskId: String(task._id), status: a.status });
}

async function notifyInApp(c: ActionContext, a: Extract<Action, { type: 'CREATE_IN_APP_NOTIFICATION' }>): Promise<ActionOutcome> {
  const to = await resolve(c, a.recipient);
  if (!to) return skipped('NO_ACTIVE_RECIPIENT');
  const rel = relatedFor(c);
  const created = await createNotification({
    organizationId: c.organizationId, recipientUserId: to, type: 'AUTOMATION',
    title: render(a.title, c.payload), message: render(a.message, c.payload),
    relatedEntityType: rel?.type ?? null, relatedEntityId: rel?.id ?? null, deliveryKey: key(c),
  });
  return ok({ created }); // false = already delivered earlier, or the user turned this type off
}

async function sendEmail(c: ActionContext, a: Extract<Action, { type: 'SEND_EMAIL_NOTIFICATION' }>): Promise<ActionOutcome> {
  if (!emailEnabled()) throw new Error('Email provider is not configured');
  const to = await resolve(c, a.recipient);
  if (!to) return skipped('NO_ACTIVE_RECIPIENT');
  if (!(await isEmailPreferred(c.organizationId, to))) return skipped('RECIPIENT_OPTED_OUT');
  const user: any = await User.findById(to).select('email').lean();
  if (!user?.email) return skipped('NO_EMAIL_ADDRESS');
  const r = await sendTrackedEmail({ organizationId: c.organizationId, userId: to, to: user.email, subject: render(a.subject, c.payload), text: render(a.body, c.payload), deliveryKey: key(c) });
  return ok({ duplicate: r.duplicate });
}

async function assignLead(c: ActionContext, a: Extract<Action, { type: 'ASSIGN_LEAD' }>): Promise<ActionOutcome> {
  const target = await resolve(c, a.assignTo);
  if (!target) return skipped('NO_ACTIVE_ASSIGNEE');
  const prev: any = await Lead.findOneAndUpdate(
    { _id: entityId(c), organizationId: c.organizationId, deletedAt: null, assignedTo: { $ne: target } },
    { $set: { assignedTo: target } },
  ).lean();
  if (!prev) return skipped('NOT_FOUND_OR_ALREADY_ASSIGNED');
  await timeline(c, 'LEAD', prev._id, 'ASSIGNMENT', `Assigned by automation "${c.workflow.name}"`);
  await audit(c, 'automation.lead_assigned', 'lead', prev._id, { from: prev.assignedTo ? String(prev.assignedTo) : null, to: target });
  await emitEntityEvent({ type: 'LEAD_ASSIGNED', entityType: 'LEAD', entityId: prev._id, organizationId: c.organizationId, actorId: c.workflow.createdBy, from: prev.assignedTo, to: target, key: key(c) });
  return ok({ leadId: String(prev._id), assignedTo: target });
}

async function assignDeal(c: ActionContext, a: Extract<Action, { type: 'ASSIGN_DEAL' }>): Promise<ActionOutcome> {
  const target = await resolve(c, a.assignTo);
  if (!target) return skipped('NO_ACTIVE_ASSIGNEE');
  const prev: any = await Deal.findOneAndUpdate(
    { _id: entityId(c), organizationId: c.organizationId, deletedAt: null, stage: { $in: OPEN_DEAL_STAGES }, assignedTo: { $ne: target } },
    { $set: { assignedTo: target } },
  ).lean();
  if (!prev) return skipped('NOT_FOUND_CLOSED_OR_ALREADY_ASSIGNED');
  await timeline(c, 'DEAL', prev._id, 'ASSIGNMENT', `Assigned by automation "${c.workflow.name}"`);
  await audit(c, 'automation.deal_assigned', 'deal', prev._id, { from: prev.assignedTo ? String(prev.assignedTo) : null, to: target });
  await emitEntityEvent({ type: 'DEAL_ASSIGNED', entityType: 'DEAL', entityId: prev._id, organizationId: c.organizationId, actorId: c.workflow.createdBy, from: prev.assignedTo, to: target, key: key(c) });
  return ok({ dealId: String(prev._id), assignedTo: target });
}

/** Every executor is idempotent per (execution, action index), so a crash-and-retry never doubles an effect. */
export function runAction(c: ActionContext, a: Action): Promise<ActionOutcome> {
  switch (a.type) {
    case 'CREATE_TASK': return createTask(c, a);
    case 'ASSIGN_TASK': return assignTask(c, a);
    case 'UPDATE_TASK_STATUS': return updateTaskStatus(c, a);
    case 'CREATE_IN_APP_NOTIFICATION': return notifyInApp(c, a);
    case 'SEND_EMAIL_NOTIFICATION': return sendEmail(c, a);
    case 'ASSIGN_LEAD': return assignLead(c, a);
    case 'ASSIGN_DEAL': return assignDeal(c, a);
  }
}