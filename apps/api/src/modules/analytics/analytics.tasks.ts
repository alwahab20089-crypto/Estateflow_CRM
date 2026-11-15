import { OPEN_TASK_STATUSES } from '../../constants';
import { Task } from '../tasks/task.model';
import { addDays, startOfDayUtc, ymdInTz } from './tz';
import {
  assigneeLabel, bucketExpr, compare, countSeries, distribution, exec, flag, inRange, pipeline, rate, resolveAssignees, scoped,
  type AnalyticsContext, type Cond, type Range, type Series,
} from './analytics.context';

const OPEN = [...OPEN_TASK_STATUSES] as string[];
const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TYPE_ORDER = ['CALL', 'MEETING', 'PROPERTY_VIEWING', 'FOLLOW_UP', 'EMAIL', 'DOCUMENTATION', 'GENERAL'];
export interface TaskFilters { status?: string }
const conds = (f: TaskFilters): Cond[] => (f.status ? [{ status: f.status }] : []);

/**
 * Period cohort = tasks DUE in the range, plus tasks without a due date CREATED in the range. Archived (soft-deleted) tasks are never counted.
 * Future-due tasks are never "overdue" and never count against the completion rate.
 */
const cohortCond = (r: Range): Cond => ({ $or: [inRange('dueAt', r), { dueAt: null, ...inRange('createdAt', r) }] });
const isOverdue = (now: Date) => ({ $and: [{ $eq: [{ $type: '$dueAt' }, 'date'] }, { $lt: ['$dueAt', now] }] });
const completedOnTime = { $and: [{ $eq: ['$status', 'COMPLETED'] }, { $eq: [{ $type: '$completedAt' }, 'date'] }, { $lte: ['$completedAt', '$dueAt'] }] };

/** Matured = due date already passed (and inside the range). Cancelled tasks are excluded. rate = COMPLETED / (COMPLETED + still open). */
const maturedMatch = (c: AnalyticsContext, r: Range): Cond[] => [
  { dueAt: { $gte: r.from, $lt: new Date(Math.min(r.to.getTime(), c.now.getTime())) } },
  { status: { $ne: 'CANCELLED' } },
];

export async function taskSummary(c: AnalyticsContext, range: Range, f: TaskFilters = {}) {
  const [cohort, mature, completed, created] = await Promise.all([
    exec<{ _id: string; count: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', cohortCond(range), ...conds(f)) }, { $group: { _id: '$status', count: { $sum: 1 } } }]))),
    exec<{ total: number; completed: number; onTime: number }>(
      Task.aggregate(pipeline([
        { $match: scoped(c, 'tasks', ...maturedMatch(c, range), ...conds(f)) },
        { $group: { _id: null, total: { $sum: 1 }, completed: flag({ $eq: ['$status', 'COMPLETED'] }), onTime: flag(completedOnTime) } },
      ])),
    ),
    Task.countDocuments(scoped(c, 'tasks', { status: 'COMPLETED' }, inRange('completedAt', range), ...conds(f)) as never),
    Task.countDocuments(scoped(c, 'tasks', inRange('createdAt', range), ...conds(f)) as never),
  ]);
  const m = mature[0] ?? { total: 0, completed: 0, onTime: 0 };
  return {
    cohort: cohort.reduce((s, r) => s + r.count, 0),
    completedInPeriod: completed,
    createdInPeriod: created,
    matured: m.total,
    completionRate: rate(m.completed, m.total),
    onTimeRate: rate(m.onTime, m.total),
  };
}

/** Right-now counts. Overdue = still open and dueAt < now (an instant, so it is timezone independent). Due today uses the report timezone's calendar day. */
export async function taskSnapshot(c: AnalyticsContext, f: TaskFilters = {}) {
  const today = ymdInTz(c.now, c.timezone);
  const start = startOfDayUtc(today, c.timezone);
  const end = startOfDayUtc(addDays(today, 1), c.timezone);
  const rows = await exec<{ open: number; todo: number; inProgress: number; overdue: number; dueToday: number }>(
    Task.aggregate(pipeline([
      { $match: scoped(c, 'tasks', { status: { $in: OPEN } }, ...conds(f)) },
      {
        $group: {
          _id: null,
          open: { $sum: 1 },
          todo: flag({ $eq: ['$status', 'TODO'] }),
          inProgress: flag({ $eq: ['$status', 'IN_PROGRESS'] }),
          overdue: flag(isOverdue(c.now)),
          dueToday: flag({ $and: [{ $gte: ['$dueAt', start] }, { $lt: ['$dueAt', end] }] }),
        },
      },
    ])),
  );
  return rows[0] ?? { open: 0, todo: 0, inProgress: 0, overdue: 0, dueToday: 0 };
}

export async function taskTrend(c: AnalyticsContext, f: TaskFilters = {}): Promise<Series[]> {
  const [created, completed] = await Promise.all([
    exec<{ _id: string; count: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', inRange('createdAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$createdAt', c), count: { $sum: 1 } } }]))),
    exec<{ _id: string; count: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', { status: 'COMPLETED' }, inRange('completedAt', c.range), ...conds(f)) }, { $group: { _id: bucketExpr('$completedAt', c), count: { $sum: 1 } } }]))),
  ]);
  return [countSeries(c, 'tasksCreated', 'Tasks created', created), countSeries(c, 'tasksCompleted', 'Tasks completed', completed)];
}

export interface TaskAssigneeRow { assignee: unknown; cohort: number; cancelled: number; completed: number; pending: number; overdue: number; mTotal: number; mCompleted: number; mOnTime: number }

/** Attribution = CURRENT assignee. completed = completed in the range; pending/overdue = open right now. */
export async function tasksByAssignee(c: AnalyticsContext, range: Range, f: TaskFilters = {}): Promise<TaskAssigneeRow[]> {
  const [cohort, matured, open, completed] = await Promise.all([
    exec<{ _id: unknown; cohort: number; cancelled: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', cohortCond(range), ...conds(f)) }, { $group: { _id: '$assignedTo', cohort: { $sum: 1 }, cancelled: flag({ $eq: ['$status', 'CANCELLED'] }) } }]))),
    exec<{ _id: unknown; total: number; completed: number; onTime: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', ...maturedMatch(c, range), ...conds(f)) }, { $group: { _id: '$assignedTo', total: { $sum: 1 }, completed: flag({ $eq: ['$status', 'COMPLETED'] }), onTime: flag(completedOnTime) } }]))),
    exec<{ _id: unknown; pending: number; overdue: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', { status: { $in: OPEN } }, ...conds(f)) }, { $group: { _id: '$assignedTo', pending: { $sum: 1 }, overdue: flag(isOverdue(c.now)) } }]))),
    exec<{ _id: unknown; count: number }>(Task.aggregate(pipeline([{ $match: scoped(c, 'tasks', { status: 'COMPLETED' }, inRange('completedAt', range), ...conds(f)) }, { $group: { _id: '$assignedTo', count: { $sum: 1 } } }]))),
  ]);
  const out = new Map<string, TaskAssigneeRow>();
  const row = (id: unknown) => {
    const k = id ? String(id) : 'unassigned';
    if (!out.has(k)) out.set(k, { assignee: id ?? null, cohort: 0, cancelled: 0, completed: 0, pending: 0, overdue: 0, mTotal: 0, mCompleted: 0, mOnTime: 0 });
    return out.get(k)!;
  };
  cohort.forEach((r) => Object.assign(row(r._id), { cohort: r.cohort, cancelled: r.cancelled }));
  matured.forEach((r) => Object.assign(row(r._id), { mTotal: r.total, mCompleted: r.completed, mOnTime: r.onTime }));
  open.forEach((r) => Object.assign(row(r._id), { pending: r.pending, overdue: r.overdue }));
  completed.forEach((r) => (row(r._id).completed = r.count));
  return [...out.values()];
}

export async function taskAnalytics(c: AnalyticsContext, f: TaskFilters = {}) {
  const facets = Task.aggregate(pipeline([
    { $match: scoped(c, 'tasks', cohortCond(c.range), ...conds(f)) },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
        byType: [{ $group: { _id: '$taskType', count: { $sum: 1 } } }],
      },
    },
  ]));
  const [summary, previous, snapshot, fx, byAssignee, series] = await Promise.all([
    taskSummary(c, c.range, f),
    taskSummary(c, c.previous, f),
    taskSnapshot(c, f),
    exec<Record<string, Array<{ _id: string; count: number }>>>(facets),
    tasksByAssignee(c, c.range, f),
    taskTrend(c, f),
  ]);
  const names = await resolveAssignees(c, byAssignee.map((r) => r.assignee));
  const f0 = fx[0] ?? {};
  return {
    summary: { ...summary, ...snapshot },
    previous,
    comparison: {
      completedInPeriod: compare(summary.completedInPeriod, previous.completedInPeriod),
      completionRate: compare(summary.completionRate, previous.completionRate, 'points'),
    },
    byStatus: distribution(f0.byStatus ?? [], summary.cohort, STATUS_ORDER),
    byPriority: distribution(f0.byPriority ?? [], summary.cohort, PRIORITY_ORDER),
    byType: distribution(f0.byType ?? [], summary.cohort, TYPE_ORDER),
    byAgent: byAssignee
      .map((r) => ({
        userId: r.assignee ? String(r.assignee) : null, name: assigneeLabel(names, r.assignee), cohort: r.cohort, completed: r.completed, pending: r.pending, overdue: r.overdue,
        completionRate: rate(r.mCompleted, r.mTotal), onTimeRate: rate(r.mOnTime, r.mTotal), sample: r.mTotal,
      }))
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name)),
    series,
    definitions: {
      cohort: 'Tasks due in the period, plus undated tasks created in the period. Archived tasks are excluded.',
      completionRate: 'COMPLETED / (COMPLETED + still open) among tasks whose due date has already passed inside the period. Cancelled tasks are excluded; future-due tasks are excluded.',
      overdue: 'Open (TODO or IN_PROGRESS) with dueAt earlier than now.',
    },
  };
}