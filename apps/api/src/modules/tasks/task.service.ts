import { Types, type ClientSession } from 'mongoose';
import { OPEN_TASK_STATUSES, type NotificationType } from '../../constants';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { Activity } from '../activities/activity.model';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { Contact } from '../contacts/contact.model';
import { fullName } from '../contacts/contact.serializer';
import { contactScope } from '../contacts/contact.service';
import { Deal } from '../deals/deal.model';
import { dealScope } from '../deals/deal.service';
import { Lead } from '../leads/lead.model';
import { buildSearchFilter } from '../leads/lead.search';
import type { UserBrief } from '../leads/lead.serializer';
import type { ActivitiesQuery } from '../leads/lead.validation';
import { assertActiveMember, type TenantContext } from '../members/member.service';
import { createNotification,   type RelatedEntityType,
 } from '../notifications/notification.service';
import { Property } from '../properties/property.model';
import { propertyScope } from '../properties/property.service';
import { User } from '../users/user.model';
import { isOpenTask } from './task.lifecycle';
import { Task, type TaskDoc } from './task.model';
import { toTaskDto, type TaskBriefs, type TaskLike } from './task.serializer';
import type {
  CalendarQuery, CompleteTaskInput, CreateTaskInput, ListTasksQuery, SummaryQuery, TaskStatusInput, UpdateTaskInput,
} from './task.validation';

type Id = string | Types.ObjectId;
const MAX_SKIP = 50_000;
const DAY = 86_400_000;
const OPEN = [...OPEN_TASK_STATUSES];
const oid = (v: Id) => new Types.ObjectId(String(v));
const can = (t: TenantContext, p: string) => t.permissions.includes(p);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const AUDIT_KEYS = ['taskType', 'status', 'priority', 'dueAt', 'reminderAt', 'assignedTo', 'relatedEntityType', 'relatedEntityId'];
const pick = (src: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => AUDIT_KEYS.includes(k)).map((k) => [k, src[k] ?? null]));
const stale = () => AppError.conflict('This task was changed by someone else. Refresh and try again.', 'STALE_TASK');
const uniq = (vals: Array<Id | null | undefined>) => [...new Set(vals.filter(Boolean).map(String))];

/* -------------------------------------------------------------------- scope */

/** Agents see tasks assigned to or created by them; tasks:read_all widens that to the organization. */
export function taskScope(tenant: TenantContext, userId: string, view: 'active' | 'archived' = 'active') {
  const filter: Record<string, unknown> = {
    organizationId: oid(tenant.organizationId),
    deletedAt: view === 'archived' ? { $ne: null } : null,
  };
  if (!can(tenant, 'tasks:read_all')) filter.$or = [{ assignedTo: oid(userId) }, { createdBy: oid(userId) }];
  return filter;
}

export async function findTask(tenant: TenantContext, userId: string, id: string, opts: { archived?: boolean } = {}) {
  const task = await Task.findOne({ ...taskScope(tenant, userId, opts.archived ? 'archived' : 'active'), _id: oid(id) } as never);
  if (!task) throw AppError.notFound('Task not found'); // identical for missing, other tenant and not yours
  return task;
}

/* ------------------------------------------------------------------ helpers */

async function find<T>(ids: string[], run: () => Promise<T[]>): Promise<T[]> {
  return ids.length ? run() : [];
}

async function loadBriefs(tenant: TenantContext, tasks: TaskLike[]) {
  const org = { organizationId: tenant.organizationId };
  const idsFor = (type: string) => uniq(tasks.map((t) => (t.relatedEntityType === type ? t.relatedEntityId : null)));
  const userIds = uniq(tasks.flatMap((t) => [t.assignedTo, t.createdBy]));
  const [users, leads, contacts, properties, deals] = await Promise.all([
    find(userIds, () => User.find({ _id: { $in: userIds } }).select('name email avatar').lean()),
    find(idsFor('LEAD'), () => Lead.find({ ...org, _id: { $in: idsFor('LEAD') } } as never).select('firstName lastName').lean()),
    find(idsFor('CONTACT'), () => Contact.find({ ...org, _id: { $in: idsFor('CONTACT') } } as never).select('firstName lastName').lean()),
    find(idsFor('PROPERTY'), () => Property.find({ ...org, _id: { $in: idsFor('PROPERTY') } } as never).select('title').lean()),
    find(idsFor('DEAL'), () => Deal.find({ ...org, _id: { $in: idsFor('DEAL') } } as never).select('title').lean()),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x as unknown as UserBrief]));
  const label = new Map<string, string>();
  leads.forEach((x) => label.set(`LEAD:${x._id}`, fullName(x as never)));
  contacts.forEach((x) => label.set(`CONTACT:${x._id}`, fullName(x as never)));
  properties.forEach((x) => label.set(`PROPERTY:${x._id}`, (x as { title: string }).title));
  deals.forEach((x) => label.set(`DEAL:${x._id}`, (x as { title: string }).title));

  return (t: TaskLike): TaskBriefs => ({
    assignee: t.assignedTo ? (u.get(String(t.assignedTo)) ?? null) : null,
    creator: u.get(String(t.createdBy)) ?? null,
    related:
      t.relatedEntityType && t.relatedEntityId
        ? { type: t.relatedEntityType, _id: String(t.relatedEntityId), label: label.get(`${t.relatedEntityType}:${t.relatedEntityId}`) ?? 'Unavailable record' }
        : null,
  });
}

export async function serializeTasks(tenant: TenantContext, tasks: TaskLike[]) {
  const briefs = await loadBriefs(tenant, tasks);
  return tasks.map((t) => toTaskDto(t, briefs(t)));
}
const serializeTask = async (tenant: TenantContext, task: unknown) => (await serializeTasks(tenant, [task as TaskLike]))[0]!;

const RELATED_READ = { LEAD: 'leads:read', CONTACT: 'contacts:read', PROPERTY: 'properties:read', DEAL: 'deals:read' } as const;

/** The linked record must exist in THIS organization, not be archived, and be visible to this user. */
async function assertRelated(tenant: TenantContext, userId: string, type: keyof typeof RELATED_READ, id: string) {
  let ok = false;
  if (can(tenant, RELATED_READ[type])) {
    switch (type) {
      case 'LEAD': {
        const f: Record<string, unknown> = { organizationId: tenant.organizationId, deletedAt: null, _id: id };
        if (!can(tenant, 'leads:read_all')) f.assignedTo = userId;
        ok = Boolean(await Lead.exists(f as never));
        break;
      }
      case 'CONTACT':
        ok = Boolean(await Contact.exists({ ...contactScope(tenant, userId), _id: id } as never));
        break;
      case 'PROPERTY':
        ok = Boolean(await Property.exists({ ...propertyScope(tenant), _id: id } as never));
        break;
      case 'DEAL':
        ok = Boolean(await Deal.exists({ ...dealScope(tenant, userId), _id: id } as never));
        break;
    }
  }
  if (!ok) throw AppError.validation([{ path: 'relatedEntityId', message: 'The selected record does not belong to this organization' }]);
}

function assertDates(dueAt: Date | null, reminderAt: Date | null, reminderChanged: boolean) {
  if (reminderAt && dueAt && reminderAt.getTime() > dueAt.getTime()) {
    throw AppError.validation([{ path: 'reminderAt', message: 'The reminder must not be after the due date' }]);
  }
  if (reminderAt && reminderChanged && reminderAt.getTime() < Date.now() - 60_000) {
    throw AppError.validation([{ path: 'reminderAt', message: 'The reminder must be in the future' }]);
  }
}

async function saveTask(task: TaskDoc, session: ClientSession | undefined) {
  try {
    await task.save({ session });
  } catch (err) {
    if ((err as { name?: string })?.name === 'VersionError') throw stale(); // optimistic concurrency
    throw err;
  }
}

/* ---------------------------------------------------------- reminder state */

const IN_FLIGHT = ['PENDING', 'PROCESSING', 'FAILED'];

function setReminderState(task: TaskDoc, status: string, bump: boolean) {
  task.set('reminderStatus', status);
  if (bump) task.set('reminderVersion', Number(task.get('reminderVersion') ?? 0) + 1);
  task.set('reminderLockedAt', null);
  task.set('reminderLockedBy', null);
}

/**
 * Single place that decides the reminder state of a task. Call it after ANY change to reminderAt, status or deletedAt.
 * Bumping reminderVersion invalidates anything a worker has already claimed (its delivery re-checks the version),
 * and the version is part of the notification delivery key, so an old reminder can never be delivered after a change.
 */
export function syncReminder(task: TaskDoc, reminderAtChanged: boolean, now = new Date()) {
  const reminderAt = task.get('reminderAt') as Date | null | undefined;
  const status = String(task.get('reminderStatus'));
  const active = isOpenTask(String(task.get('status'))) && !task.get('deletedAt');
  const inFlight = IN_FLIGHT.includes(status);

  if (!reminderAt) {
    if (status !== 'NONE') setReminderState(task, 'NONE', inFlight);
    return;
  }
  if (!active) {
    if (inFlight) setReminderState(task, 'CANCELLED', true);
    return;
  }
  // A cancelled reminder is re-armed on reopen/restore only if it is still in the future; stale reminders never fire late.
  const rearm = reminderAtChanged || (status === 'CANCELLED' && reminderAt.getTime() > now.getTime());
  if (rearm) {
    setReminderState(task, 'PENDING', true);
    task.set('reminderNextAttemptAt', reminderAt);
    task.set('reminderAttempts', 0);
    task.set('reminderLastError', null);
    task.set('reminderDeliveredAt', null);
  }
}

/* ------------------------------------------------------------- side effects */

const notifyTask = (
type: NotificationType,
recipientUserId: Id,
task: {
  _id: Id;
  organizationId: Id;
  relatedEntityType?: RelatedEntityType;
  relatedEntityId?: Id | null;
},
  title: string, message: string, session?: ClientSession,
) =>
  createNotification(
    { organizationId: task.organizationId, recipientUserId, type, title, message, taskId: task._id, relatedEntityType: task.relatedEntityType, relatedEntityId: task.relatedEntityId },
    session,
  );

/** Mirrors task events onto the linked record's timeline (existing FOLLOW_UP activity type). */
async function relatedActivity(tenant: TenantContext, userId: string, task: TaskDoc, description: string, session?: ClientSession) {
  const type = task.relatedEntityType as string | null | undefined;
  if (!type || !task.relatedEntityId) return;
  await recordActivity(
    { organizationId: tenant.organizationId, userId, entityType: type as 'LEAD', entityId: task.relatedEntityId, activityType: 'FOLLOW_UP', description, metadata: { taskId: String(task._id) } },
    session,
  );
}

/* ------------------------------------------------------------------- create */

export async function createTask(tenant: TenantContext, userId: string, input: CreateTaskInput, meta: RequestMeta) {
  const assignedTo = input.assignedTo ?? userId; // default owner is the creator
  if (assignedTo !== userId && !can(tenant, 'tasks:assign')) {
    throw AppError.forbidden('You do not have permission to assign tasks to other members');
  }
  await assertActiveMember(tenant.organizationId, assignedTo);
  if (input.relatedEntityType && input.relatedEntityId) await assertRelated(tenant, userId, input.relatedEntityType, input.relatedEntityId);

  const dueAt = input.dueAt ?? null;
  const reminderAt = input.reminderAt ?? null;
  assertDates(dueAt, reminderAt, Boolean(reminderAt));

  const doc = {
    organizationId: tenant.organizationId, // always from the verified tenant, never the client
    createdBy: userId,
    assignedTo,
    title: input.title,
    description: input.description ?? undefined,
    taskType: input.taskType ?? 'GENERAL',
    status: 'TODO' as const,
    priority: input.priority ?? 'MEDIUM',
    dueAt,
    reminderAt,
    reminderStatus: reminderAt ? ('PENDING' as const) : ('NONE' as const),
    reminderVersion: reminderAt ? 1 : 0,
    reminderNextAttemptAt: reminderAt,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    tags: input.tags ?? [],
  };

  const task = await runUnitOfWork(async (uow) => {
    const [created] = await Task.create([doc], { session: uow.session });
    uow.onRollback(() => Task.deleteOne({ _id: created!._id }));
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: created!._id, activityType: 'CREATED', description: 'Task created' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'task.created', resource: 'task', resourceId: created!._id, after: pick(doc, AUDIT_KEYS), meta }, uow.session);
    await relatedActivity(tenant, userId, created!, `Task created: "${doc.title}"`, uow.session);
    if (assignedTo !== userId) {
      await notifyTask('TASK_ASSIGNED', assignedTo, created!, `New task assigned: ${doc.title}`, 'A task was assigned to you.', uow.session);
    }
    return created!;
  });
  return serializeTask(tenant, task);
}

/* --------------------------------------------------------------------- read */

const SORT_FIELDS = { createdAt: 'createdAt', dueAt: 'dueSortAt', priority: 'priorityRank', status: 'status', title: 'title' } as const;
const resolveAssignee = (v: string, userId: string) => (v === 'me' ? userId : v);

export async function listTasks(tenant: TenantContext, userId: string, q: ListTasksQuery) {
  if (q.view === 'archived' && !can(tenant, 'tasks:restore')) throw AppError.forbidden();
  const base = taskScope(tenant, userId, q.view);
  const and: object[] = [];

  if (q.status) base.status = q.status;
  if (q.priority) base.priority = q.priority;
  if (q.taskType) base.taskType = q.taskType;
  if (q.assignedTo) {
    const a = resolveAssignee(q.assignedTo, userId);
    base.assignedTo = a === 'unassigned' ? null : oid(a);
  }
  if (q.dueFrom || q.dueTo) base.dueAt = { ...(q.dueFrom ? { $gte: q.dueFrom } : {}), ...(q.dueTo ? { $lte: q.dueTo } : {}) };
  if (q.overdue) and.push({ status: { $in: OPEN } }, { dueAt: { $lt: new Date() } });
  if (q.relatedEntityType) base.relatedEntityType = q.relatedEntityType;
  if (q.relatedEntityId) base.relatedEntityId = oid(q.relatedEntityId);
  if (q.createdFrom || q.createdTo) base.createdAt = { ...(q.createdFrom ? { $gte: q.createdFrom } : {}), ...(q.createdTo ? { $lte: q.createdTo } : {}) };
  if (q.search) {
    const sf = buildSearchFilter(q.search);
    if (sf) and.push(...(sf.$and as object[]));
  }
  const filter = and.length ? { ...base, $and: and } : base;

  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const sort = { [SORT_FIELDS[q.sortBy]]: dir, _id: dir } as Record<string, 1 | -1>;
  const skip = (q.page - 1) * q.limit;
  if (skip > MAX_SKIP) throw AppError.validation([{ path: 'page', message: 'Page is too deep. Narrow your filters instead.' }]);

  const [items, total] = await Promise.all([
    Task.find(filter as never).sort(sort).skip(skip).limit(q.limit).lean(),
    Task.countDocuments(filter as never),
  ]);
  return {
    items: await serializeTasks(tenant, items as unknown as TaskLike[]),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function getTask(tenant: TenantContext, userId: string, id: string) {
  return serializeTask(tenant, await findTask(tenant, userId, id));
}

const CALENDAR_LIMIT = 1000;

export async function calendarTasks(tenant: TenantContext, userId: string, q: CalendarQuery) {
  const filter = taskScope(tenant, userId);
  filter.dueAt = { $gte: q.from, $lt: q.to };
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.taskType) filter.taskType = q.taskType;
  if (q.assignedTo) {
    const a = resolveAssignee(q.assignedTo, userId);
    filter.assignedTo = a === 'unassigned' ? null : oid(a);
  }
  const rows = await Task.find(filter as never).sort({ dueAt: 1, _id: 1 }).limit(CALENDAR_LIMIT + 1).lean();
  const truncated = rows.length > CALENDAR_LIMIT;
  const items = await serializeTasks(tenant, rows.slice(0, CALENDAR_LIMIT) as unknown as TaskLike[]);
  return { items, meta: { from: q.from.toISOString(), to: q.to.toISOString(), total: items.length, truncated } };
}

/** One call for every dashboard widget. The client sends its own local-day boundaries (as UTC), so "today" respects its timezone. */
export async function taskSummary(tenant: TenantContext, userId: string, q: SummaryQuery) {
  const now = new Date();
  const dayStart = q.dayStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = q.dayEnd ?? new Date(dayStart.getTime() + DAY);
  const base = taskScope(tenant, userId);
  if (q.scope === 'mine' || !can(tenant, 'tasks:read_all')) {
    delete base.$or;
    base.assignedTo = oid(userId);
  }
  const open = { ...base, status: { $in: OPEN } };
  const LIMIT = 5;
  const list = (f: object, sort: Record<string, 1 | -1>) => Task.find(f as never).sort(sort).limit(LIMIT).lean();

  const filters = {
    myOpen: open,
    dueToday: { ...open, dueAt: { $gte: dayStart, $lt: dayEnd } },
    overdue: { ...open, dueAt: { $lt: now } },
    upcoming: { ...open, taskType: 'FOLLOW_UP', dueAt: { $gte: dayEnd, $lt: new Date(dayEnd.getTime() + 14 * DAY) } },
    completed: { ...base, status: 'COMPLETED', completedAt: { $gte: new Date(now.getTime() - 7 * DAY) } },
  };
  const [cMine, cToday, cOverdue, myOpen, dueToday, overdue, upcoming, completed] = await Promise.all([
    Task.countDocuments(filters.myOpen as never),
    Task.countDocuments(filters.dueToday as never),
    Task.countDocuments(filters.overdue as never),
    list(filters.myOpen, { dueSortAt: 1, _id: 1 }),
    list(filters.dueToday, { dueAt: 1, _id: 1 }),
    list(filters.overdue, { dueAt: 1, _id: 1 }),
    list(filters.upcoming, { dueAt: 1, _id: 1 }),
    list(filters.completed, { completedAt: -1, _id: -1 }),
  ]);

  const all = [...myOpen, ...dueToday, ...overdue, ...upcoming, ...completed] as unknown as TaskLike[];
  const briefs = await loadBriefs(tenant, all);
  const dto = (rows: unknown[]) => (rows as TaskLike[]).map((t) => toTaskDto(t, briefs(t)));
  return {
    scope: q.scope,
    myTasks: { count: cMine, items: dto(myOpen) },
    dueToday: { count: cToday, items: dto(dueToday) },
    overdue: { count: cOverdue, items: dto(overdue) },
    upcomingFollowUps: { items: dto(upcoming) },
    recentlyCompleted: { items: dto(completed) },
  };
}

/* ------------------------------------------------------------------- update */

export async function updateTask(tenant: TenantContext, userId: string, id: string, input: UpdateTaskInput, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id);
  if (!isOpenTask(String(task.status))) throw AppError.conflict('Closed tasks cannot be edited. Reopen the task first.', 'TASK_CLOSED');

  const nextDue = input.dueAt !== undefined ? input.dueAt : ((task.dueAt as Date | null | undefined) ?? null);
  const nextReminder = input.reminderAt !== undefined ? input.reminderAt : ((task.reminderAt as Date | null | undefined) ?? null);
  const reminderChanged = input.reminderAt !== undefined && !same(input.reminderAt, task.reminderAt);
  assertDates(nextDue, nextReminder, reminderChanged);
  if (input.relatedEntityType && input.relatedEntityId && input.relatedEntityId !== String(task.relatedEntityId ?? '')) {
    await assertRelated(tenant, userId, input.relatedEntityType, input.relatedEntityId);
  }

  const keys = Object.keys(input) as Array<keyof UpdateTaskInput>;
  const before = task.toObject() as Record<string, unknown>;
  for (const key of keys) {
    const value = input[key];
    task.set(key, value === null && key === 'description' ? undefined : value);
  }
  if (input.dueAt !== undefined) task.set('overdueNotifiedAt', null); // a new due date earns a new overdue notice
  syncReminder(task, reminderChanged);

  const after = task.toObject() as Record<string, unknown>;
  const changed = keys.filter((k) => !same(before[k], after[k]));
  if (changed.length === 0) return serializeTask(tenant, task);

  await runUnitOfWork(async (uow) => {
    await saveTask(task, uow.session);
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: task._id, activityType: 'UPDATE', description: `Updated ${changed.join(', ')}`, metadata: { changed } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'task.updated', resource: 'task', resourceId: task._id, before: pick(before, changed), after: { ...pick(after, changed), changedFields: changed }, meta }, uow.session);
  });
  return serializeTask(tenant, task);
}

/* ------------------------------------------------- status, complete, assign */

async function applyStatus(tenant: TenantContext, userId: string, task: TaskDoc, status: string, note: string | undefined, meta: RequestMeta) {
  const from = String(task.status);
  const now = new Date();
  task.set('status', status);
  task.set('completedAt', status === 'COMPLETED' ? now : null);
  syncReminder(task, false, now); // closing cancels the pending reminder; reopening re-arms it only if still in the future

  const action = status === 'COMPLETED' ? 'task.completed' : status === 'CANCELLED' ? 'task.cancelled' : 'task.status_changed';
  await runUnitOfWork(async (uow) => {
    await saveTask(task, uow.session);
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: task._id, activityType: 'STATUS_CHANGE', description: `Status changed from ${from} to ${status}${note ? `: ${note}` : ''}`, metadata: { from, to: status } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action, resource: 'task', resourceId: task._id, before: { status: from }, after: { status }, meta }, uow.session);
    if (status === 'COMPLETED') {
      await relatedActivity(tenant, userId, task, `Task completed: "${task.title}"`, uow.session);
      if (String(task.createdBy) !== userId) {
        await notifyTask('TASK_COMPLETED', task.createdBy, task, `Task completed: ${task.title}`, 'A task you created was completed.', uow.session);
      }
    }
  });
}

export async function changeStatus(tenant: TenantContext, userId: string, id: string, input: TaskStatusInput, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id);
  if (task.status === input.status) return serializeTask(tenant, task);
  await applyStatus(tenant, userId, task, input.status, input.note, meta);
  return serializeTask(tenant, task);
}

export async function completeTask(tenant: TenantContext, userId: string, id: string, input: CompleteTaskInput, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id);
  if (task.status === 'COMPLETED') return serializeTask(tenant, task); // idempotent
  if (task.status === 'CANCELLED') throw AppError.conflict('Cancelled tasks cannot be completed. Reopen the task first.', 'TASK_CANCELLED');
  await applyStatus(tenant, userId, task, 'COMPLETED', input.note, meta);
  return serializeTask(tenant, task);
}

export async function assignTask(tenant: TenantContext, userId: string, id: string, assignedTo: string | null, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id);
  if (assignedTo) await assertActiveMember(tenant.organizationId, assignedTo);
  const previous = task.assignedTo ? String(task.assignedTo) : null;
  if (previous === assignedTo) return serializeTask(tenant, task);

  const names = new Map((await User.find({ _id: { $in: [previous, assignedTo].filter(Boolean) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const name = (uid: string | null) => (uid ? (names.get(uid) ?? 'a former member') : null);
  const description = !assignedTo ? `Unassigned (was ${name(previous)})` : previous ? `Reassigned from ${name(previous)} to ${name(assignedTo)}` : `Assigned to ${name(assignedTo)}`;

  // Reminder ownership rule: a PENDING reminder follows the current assignee (recipient is resolved at delivery time).
  // One that was already delivered is not re-sent to the new assignee.
  task.set('assignedTo', assignedTo);
  await runUnitOfWork(async (uow) => {
    await saveTask(task, uow.session);
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: task._id, activityType: 'ASSIGNMENT', description, metadata: { from: previous, to: assignedTo, assignedBy: userId } }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: previous ? 'task.reassigned' : 'task.assigned', resource: 'task', resourceId: task._id, before: { assignedTo: previous }, after: { assignedTo }, meta }, uow.session);
    if (assignedTo && assignedTo !== userId) {
      await notifyTask('TASK_ASSIGNED', assignedTo, task, `New task assigned: ${task.title}`, 'A task was assigned to you.', uow.session);
    }
  });
  return serializeTask(tenant, task);
}

/* ---------------------------------------------------------- archive/restore */

export async function archiveTask(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id);
  task.set('deletedAt', new Date());
  task.set('deletedBy', userId);
  syncReminder(task, false); // archived tasks never remind
  await runUnitOfWork(async (uow) => {
    await saveTask(task, uow.session);
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: task._id, activityType: 'UPDATE', description: 'Task archived' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'task.archived', resource: 'task', resourceId: task._id, meta }, uow.session);
  });
  return serializeTask(tenant, task);
}

export async function restoreTask(tenant: TenantContext, userId: string, id: string, meta: RequestMeta) {
  const task = await findTask(tenant, userId, id, { archived: true });
  task.set('deletedAt', null);
  task.set('deletedBy', undefined);
  syncReminder(task, false);
  await runUnitOfWork(async (uow) => {
    await saveTask(task, uow.session);
    await recordActivity({ organizationId: tenant.organizationId, userId, entityType: 'TASK', entityId: task._id, activityType: 'UPDATE', description: 'Task restored' }, uow.session);
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'task.restored', resource: 'task', resourceId: task._id, meta }, uow.session);
  });
  return serializeTask(tenant, task);
}

/* --------------------------------------------------------------- activities */

export async function listActivities(tenant: TenantContext, userId: string, id: string, q: ActivitiesQuery) {
  const task = await findTask(tenant, userId, id);
  const filter = { organizationId: tenant.organizationId, entityType: 'TASK' as const, entityId: task._id, ...(q.type ? { activityType: q.type } : {}) };
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