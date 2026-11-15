import type { Model } from 'mongoose';
import { DEAL_STAGES } from '../../constants';
import { Deal } from '../deals/deal.model';
import { OPEN_DEAL_STAGES } from '../deals/deal.lifecycle';
import { Lead } from '../leads/lead.model';
import { Property } from '../properties/property.model';
import {
  assigneeLabel, can, exec, inRange, pipeline, rate, resolveAssignees, scoped, type AnalyticsContext,
} from '../analytics/analytics.context';
import { closedAtExpr, closedIn, dealSnapshot, dealSummary, dealsByAssigneeRaw } from '../analytics/analytics.deals';
import { QUALIFIED_STATUSES, leadSummary, leadTotalsGroup } from '../analytics/analytics.leads';
import { propertySnapshot } from '../analytics/analytics.properties';
import { taskSummary, tasksByAssignee } from '../analytics/analytics.tasks';
import { teamAnalytics } from '../analytics/analytics.team';
import { ymdInTz } from '../analytics/tz';
import type { ReportQuery } from '../analytics/analytics.validation';
import { minorToMajor } from './csv';

export interface Column { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' | 'percent' }
export type Row = Record<string, string | number | null>;
type Filter = 'leadSource' | 'status' | 'dealType' | 'propertyType' | 'listingType' | 'assignedTo';

interface Base {
  id: string;
  title: string;
  description: string;
  /** All of these permissions are required (plus reports:read). */
  requires: string[];
  /** Needs analytics:team (it compares members). */
  teamOnly?: boolean;
  /** false = a snapshot of "right now"; the date range is not applied. */
  usesDateRange: boolean;
  columns: Column[];
  filters: Filter[];
  statuses?: readonly string[];
  sortable: string[];
  defaultSort: { key: string; order: 'asc' | 'desc' };
  summary(c: AnalyticsContext, q: ReportQuery): Promise<Record<string, unknown>>;
}
export interface RowsSource {
  model: Model<Record<string, unknown>>;
  match: Record<string, unknown>;
  sortMap: Record<string, string>;
  select: string;
  toRows(docs: Array<Record<string, any>>, c: AnalyticsContext): Promise<Row[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface RowsDef extends Base { kind: 'rows'; source(c: AnalyticsContext, q: ReportQuery): RowsSource }
export interface GroupedDef extends Base { kind: 'grouped'; rows(c: AnalyticsContext, q: ReportQuery): Promise<Row[]> }
export type ReportDef = RowsDef | GroupedDef;

const day = (d: unknown, c: AnalyticsContext) => (d ? ymdInTz(new Date(d as Date), c.timezone) : null);
const asModel = (m: unknown) => m as Model<Record<string, unknown>>;
const DAY = 86_400_000;
const col = (key: string, label: string, type: Column['type'] = 'text'): Column => ({ key, label, type });

/* ------------------------------------------------------------------ rows */

const leadPerformance: RowsDef = {
  kind: 'rows', id: 'lead-performance', title: 'Lead Performance Report', usesDateRange: true,
  description: 'Every lead created in the period with its source, status, owner and conversion date.',
  requires: ['leads:read'], filters: ['leadSource', 'status', 'assignedTo'], statuses: ['NEW', 'CONTACTED', 'QUALIFIED', 'MEETING_SCHEDULED', 'NEGOTIATION', 'WON', 'LOST'],
  columns: [col('name', 'Lead'), col('source', 'Source'), col('type', 'Type'), col('status', 'Status'), col('priority', 'Priority'), col('assignedTo', 'Assigned to'), col('createdAt', 'Created', 'date'), col('convertedAt', 'Converted', 'date')],
  sortable: ['createdAt', 'name', 'status', 'priority', 'convertedAt'], defaultSort: { key: 'createdAt', order: 'desc' },
  summary: (c) => leadSummary(c, c.range),
  source: (c, q) => ({
    model: asModel(Lead),
    match: scoped(c, 'leads', inRange('createdAt', c.range), ...(q.leadSource ? [{ leadSource: q.leadSource }] : []), ...(q.status ? [{ status: q.status }] : [])),
    sortMap: { createdAt: 'createdAt', name: 'nameSort', status: 'statusRank', priority: 'priorityRank', convertedAt: 'convertedAt' },
    select: 'firstName lastName leadSource leadType status priority assignedTo createdAt convertedAt', // no phone / email in reports
    async toRows(docs, ctx) {
      const names = await resolveAssignees(ctx, docs.map((d) => d.assignedTo));
      return docs.map((d) => ({ name: `${d.firstName} ${d.lastName ?? ''}`.trim(), source: d.leadSource, type: d.leadType, status: d.status, priority: d.priority, assignedTo: assigneeLabel(names, d.assignedTo), createdAt: day(d.createdAt, ctx), convertedAt: day(d.convertedAt, ctx) }));
    },
  }),
};

const dealPipeline: RowsDef = {
  kind: 'rows', id: 'deal-pipeline', title: 'Deal Pipeline Report', usesDateRange: false,
  description: 'All open deals right now with stage, value, probability and expected closing date. A snapshot: the date range is not applied.',
  requires: ['deals:read'], filters: ['dealType', 'status', 'assignedTo'], statuses: OPEN_DEAL_STAGES,
  columns: [col('title', 'Deal'), col('dealType', 'Type'), col('stage', 'Stage'), col('value', 'Deal value', 'money'), col('currency', 'Currency'), col('probability', 'Probability %', 'number'), col('expectedClosingDate', 'Expected closing', 'date'), col('assignedTo', 'Assigned to'), col('createdAt', 'Created', 'date')],
  sortable: ['createdAt', 'expectedClosingDate', 'value', 'probability', 'title'], defaultSort: { key: 'createdAt', order: 'desc' },
  summary: async (c, q) => {
    const s = await dealSnapshot(c, { dealType: q.dealType, status: q.status });
    return { openDeals: s.open, pipelineValue: s.pipeline, note: 'Pipeline value is the sum of open deal values per currency. It is expected value, not revenue.' };
  },
  source: (c, q) => ({
    model: asModel(Deal),
    match: scoped(c, 'deals', { stage: { $in: [...OPEN_DEAL_STAGES] } }, ...(q.dealType ? [{ dealType: q.dealType }] : []), ...(q.status ? [{ stage: q.status }] : [])),
    sortMap: { createdAt: 'createdAt', expectedClosingDate: 'expectedClosingDate', value: 'valueAmount', probability: 'probability', title: 'title' },
    select: 'title dealType stage valueAmount currency probability expectedClosingDate assignedTo createdAt',
    async toRows(docs, ctx) {
      const names = await resolveAssignees(ctx, docs.map((d) => d.assignedTo));
      return docs.map((d) => ({ title: d.title, dealType: d.dealType, stage: d.stage, value: minorToMajor(d.valueAmount, d.currency), currency: d.currency, probability: d.probability, expectedClosingDate: day(d.expectedClosingDate, ctx), assignedTo: assigneeLabel(names, d.assignedTo), createdAt: day(d.createdAt, ctx) }));
    },
  }),
};

const wonLost: RowsDef = {
  kind: 'rows', id: 'won-lost-deals', title: 'Won and Lost Deals Report', usesDateRange: true,
  description: 'Deals closed as won or lost in the period. Value is the agreed deal value, not cash collected.',
  requires: ['deals:read'], filters: ['dealType', 'status', 'assignedTo'], statuses: ['WON', 'LOST'],
  columns: [col('title', 'Deal'), col('dealType', 'Type'), col('outcome', 'Outcome'), col('value', 'Deal value', 'money'), col('currency', 'Currency'), col('closedAt', 'Closed', 'date'), col('daysToClose', 'Days to close', 'number'), col('assignedTo', 'Assigned to'), col('lostReason', 'Lost reason')],
  sortable: ['closedAt', 'value', 'createdAt', 'title'], defaultSort: { key: 'closedAt', order: 'desc' },
  summary: async (c) => {
    const s = await dealSummary(c, c.range);
    return { won: s.won.count, wonValue: s.won.byCurrency, lost: s.lost, winRate: s.winRate, avgDaysToClose: s.avgDaysToClose, winRateDefinition: 'won / (won + lost) among deals closed in the period', note: 'Won value is agreed deal value, not collected revenue.' };
  },
  source: (c, q) => ({
    model: asModel(Deal),
    match: scoped(c, 'deals', { stage: q.status ? q.status : { $in: ['WON', 'LOST'] } }, closedIn(c.range), ...(q.dealType ? [{ dealType: q.dealType }] : [])),
    sortMap: { closedAt: 'actualClosingDate', value: 'valueAmount', createdAt: 'createdAt', title: 'title' },
    select: 'title dealType stage valueAmount currency assignedTo createdAt actualClosingDate stageChangedAt lostReason',
    async toRows(docs, ctx) {
      const names = await resolveAssignees(ctx, docs.map((d) => d.assignedTo));
      return docs.map((d) => {
        const closed = d.actualClosingDate ?? d.stageChangedAt;
        return {
          title: d.title, dealType: d.dealType, outcome: d.stage, value: minorToMajor(d.valueAmount, d.currency), currency: d.currency, closedAt: day(closed, ctx),
          daysToClose: closed ? Math.round(((new Date(closed).getTime() - new Date(d.createdAt).getTime()) / DAY) * 10) / 10 : null,
          assignedTo: assigneeLabel(names, d.assignedTo), lostReason: d.stage === 'LOST' ? (d.lostReason ?? null) : null,
        };
      });
    },
  }),
};

const inventory: RowsDef = {
  kind: 'rows', id: 'property-inventory', title: 'Property Inventory Report', usesDateRange: false,
  description: 'Current (non-archived) properties with status, location and asking price. A snapshot: the date range is not applied. Asking prices are not revenue.',
  requires: ['properties:read'], filters: ['propertyType', 'listingType', 'status', 'assignedTo'],
  statuses: ['DRAFT', 'AVAILABLE', 'UNDER_OFFER', 'RESERVED', 'SOLD', 'RENTED', 'LEASED', 'INACTIVE'],
  columns: [col('title', 'Property'), col('propertyType', 'Type'), col('listingType', 'Listing'), col('propertyStatus', 'Status'), col('city', 'City'), col('price', 'Asking price', 'money'), col('currency', 'Currency'), col('rentPeriod', 'Rent period'), col('assignedTo', 'Assigned to'), col('createdAt', 'Added', 'date')],
  sortable: ['createdAt', 'title', 'city', 'price', 'propertyStatus'], defaultSort: { key: 'createdAt', order: 'desc' },
  summary: async (c, q) => {
    const s = await propertySnapshot(c, { propertyType: q.propertyType, listingType: q.listingType, status: q.status });
    return { totals: s.totals, byStatus: s.byStatus.filter((x) => x.count > 0), averageListingPrice: s.averageListingPrice };
  },
  source: (c, q) => ({
    model: asModel(Property),
    match: scoped(c, 'properties', ...(q.propertyType ? [{ propertyType: q.propertyType }] : []), ...(q.listingType ? [{ listingType: q.listingType }] : []), ...(q.status ? [{ propertyStatus: q.status }] : [])),
    sortMap: { createdAt: 'createdAt', title: 'title', city: 'city', price: 'priceAmount', propertyStatus: 'propertyStatus' },
    select: 'title propertyType listingType propertyStatus city priceAmount currency rentPeriod assignedTo createdAt',
    async toRows(docs, ctx) {
      const names = await resolveAssignees(ctx, docs.map((d) => d.assignedTo));
      return docs.map((d) => ({ title: d.title, propertyType: d.propertyType, listingType: d.listingType, propertyStatus: d.propertyStatus, city: d.city ?? null, price: minorToMajor(d.priceAmount, d.currency), currency: d.currency, rentPeriod: d.rentPeriod ?? null, assignedTo: assigneeLabel(names, d.assignedTo), createdAt: day(d.createdAt, ctx) }));
    },
  }),
};

/* --------------------------------------------------------------- grouped */

const leadSource: GroupedDef = {
  kind: 'grouped', id: 'lead-source', title: 'Lead Source Report', usesDateRange: true,
  description: 'Leads created in the period grouped by source, with qualification and conversion rates.',
  requires: ['leads:read'], filters: ['assignedTo'],
  columns: [col('source', 'Source'), col('leads', 'Leads', 'number'), col('qualified', 'Qualified', 'number'), col('won', 'Won', 'number'), col('converted', 'Converted', 'number'), col('conversionRate', 'Conversion rate', 'percent')],
  sortable: ['source', 'leads', 'qualified', 'won', 'converted', 'conversionRate'], defaultSort: { key: 'leads', order: 'desc' },
  summary: (c) => leadSummary(c, c.range),
  async rows(c) {
    const rows = await exec<{ _id: string; total: number; qualified: number; converted: number; won: number }>(
      Lead.aggregate(pipeline([{ $match: scoped(c, 'leads', inRange('createdAt', c.range)) }, { $group: { _id: '$leadSource', ...leadTotalsGroup } }])),
    );
    return rows.map((r) => ({ source: r._id, leads: r.total, qualified: r.qualified, won: r.won, converted: r.converted, conversionRate: rate(r.converted, r.total) }));
  },
};

const agentPerformance: GroupedDef = {
  kind: 'grouped', id: 'agent-performance', title: 'Agent Performance Report', usesDateRange: true, teamOnly: true,
  description: 'Per-member leads, deals and tasks. Records are attributed to their current assignee. Not a ranking.',
  requires: [], filters: ['assignedTo'],
  columns: [col('agent', 'Member'), col('role', 'Role'), col('leadsAssigned', 'Leads', 'number'), col('leadsQualified', 'Qualified', 'number'), col('leadsConverted', 'Converted', 'number'), col('dealsOpen', 'Open deals', 'number'), col('dealsWon', 'Won deals', 'number'), col('dealsLost', 'Lost deals', 'number'), col('tasksCompleted', 'Tasks completed', 'number'), col('tasksPending', 'Tasks pending', 'number'), col('tasksOverdue', 'Tasks overdue', 'number'), col('taskCompletionRate', 'Task completion', 'percent')],
  sortable: ['agent', 'leadsAssigned', 'leadsConverted', 'dealsWon', 'tasksCompleted', 'tasksOverdue', 'taskCompletionRate'], defaultSort: { key: 'agent', order: 'asc' },
  summary: async () => ({ attribution: 'Current assignee. Leads: created in the period. Deals: open now, won/lost closed in the period. Tasks: completed in the period, pending/overdue now.' }),
  async rows(c) {
    const t = await teamAnalytics(c);
    return t.members.map((m) => ({
      agent: m.name, role: m.role, leadsAssigned: m.leads?.assigned ?? null, leadsQualified: m.leads?.qualified ?? null, leadsConverted: m.leads?.converted ?? null,
      dealsOpen: m.deals?.open ?? null, dealsWon: m.deals?.won ?? null, dealsLost: m.deals?.lost ?? null,
      tasksCompleted: m.tasks?.completed ?? null, tasksPending: m.tasks?.pending ?? null, tasksOverdue: m.tasks?.overdue ?? null, taskCompletionRate: m.tasks?.completionRate ?? null,
    }));
  },
};

const taskProductivity: GroupedDef = {
  kind: 'grouped', id: 'task-productivity', title: 'Task Productivity Report', usesDateRange: true,
  description: 'Tasks per assignee: completion, on-time rate and overdue work. Cancelled and future-due tasks never lower the completion rate.',
  requires: ['tasks:read'], filters: ['assignedTo'],
  columns: [col('assignee', 'Assignee'), col('tasks', 'Tasks in period', 'number'), col('completed', 'Completed in period', 'number'), col('pending', 'Pending now', 'number'), col('overdue', 'Overdue now', 'number'), col('cancelled', 'Cancelled', 'number'), col('completionRate', 'Completion rate', 'percent'), col('onTimeRate', 'On-time rate', 'percent'), col('sample', 'Rate sample size', 'number')],
  sortable: ['assignee', 'tasks', 'completed', 'pending', 'overdue', 'completionRate', 'onTimeRate'], defaultSort: { key: 'completed', order: 'desc' },
  summary: (c) => taskSummary(c, c.range),
  async rows(c) {
    const rows = await tasksByAssignee(c, c.range);
    const names = await resolveAssignees(c, rows.map((r) => r.assignee));
    return rows.map((r) => ({ assignee: assigneeLabel(names, r.assignee), tasks: r.cohort, completed: r.completed, pending: r.pending, overdue: r.overdue, cancelled: r.cancelled, completionRate: rate(r.mCompleted, r.mTotal), onTimeRate: rate(r.mOnTime, r.mTotal), sample: r.mTotal }));
  },
};

const salesPerformance: GroupedDef = {
  kind: 'grouped', id: 'sales-performance', title: 'Sales Performance Report', usesDateRange: true,
  description: 'Won and lost deals per member and currency for the period. Deal value is the agreed value, not cash collected; currencies are never combined.',
  requires: ['deals:read'], filters: ['dealType', 'assignedTo'],
  columns: [col('agent', 'Member'), col('currency', 'Currency'), col('wonDeals', 'Won deals', 'number'), col('wonValue', 'Won deal value', 'money'), col('avgWonValue', 'Average won value', 'money'), col('lostDeals', 'Lost deals', 'number'), col('winRate', 'Win rate', 'percent')],
  sortable: ['agent', 'currency', 'wonDeals', 'wonValue', 'lostDeals', 'winRate'], defaultSort: { key: 'wonValue', order: 'desc' },
  summary: async (c) => {
    const s = await dealSummary(c, c.range);
    return { won: s.won.count, wonValue: s.won.byCurrency, lost: s.lost, winRate: s.winRate, note: 'Won value is agreed deal value, not collected revenue.' };
  },
  async rows(c) {
    const raw = await dealsByAssigneeRaw(c, c.range);
    const names = await resolveAssignees(c, raw.map((r) => r._id.a));
    const m = new Map<string, { a: unknown; cur: string; won: number; amount: number; lost: number }>();
    for (const r of raw) {
      if (r._id.s === 'OPEN') continue;
      const k = `${r._id.a ?? 'unassigned'}|${r._id.c}`;
      const e = m.get(k) ?? { a: r._id.a ?? null, cur: r._id.c, won: 0, amount: 0, lost: 0 };
      if (r._id.s === 'WON') { e.won += r.count; e.amount += Math.round(r.amount); } else e.lost += r.count;
      m.set(k, e);
    }
    return [...m.values()].map((e) => ({
      agent: assigneeLabel(names, e.a), currency: e.cur, wonDeals: e.won, wonValue: minorToMajor(e.amount, e.cur),
      avgWonValue: e.won ? minorToMajor(Math.round(e.amount / e.won), e.cur) : null, lostDeals: e.lost, winRate: rate(e.won, e.won + e.lost),
    }));
  },
};

export const REPORTS: ReportDef[] = [leadPerformance, leadSource, dealPipeline, wonLost, inventory, agentPerformance, taskProductivity, salesPerformance];
export const getReport = (id: string) => REPORTS.find((r) => r.id === id);
export const canAccessReport = (def: ReportDef, permissions: string[]) =>
  permissions.includes('reports:read') && def.requires.every((p) => permissions.includes(p)) && (!def.teamOnly || permissions.includes('analytics:team'));

void DEAL_STAGES; void QUALIFIED_STATUSES; void closedAtExpr; void can;