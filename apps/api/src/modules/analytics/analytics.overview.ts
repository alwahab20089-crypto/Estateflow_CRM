import { amountIn, can, compare, type AnalyticsContext, type Comparison } from './analytics.context';
import { dealSnapshot, dealSummary } from './analytics.deals';
import { leadSummary, leadTotal } from './analytics.leads';
import { propertyAdded, propertySnapshot } from './analytics.properties';
import { taskSnapshot, taskSummary } from './analytics.tasks';

export interface Kpi {
  key: string;
  label: string;
  /** What the number means and exactly how it is computed. */
  description: string;
  section: 'leads' | 'deals' | 'properties' | 'tasks';
  kind: 'count' | 'rate' | 'money';
  /** count: number. rate: percent or null (no data). money: amount in minor units of the organization's currency. */
  value: number | null;
  /** money only: every currency (never summed together). */
  amounts?: Array<{ currency: string; amount: number }>;
  /** null for snapshots: there is no history to compare against. */
  comparison: Comparison | null;
  period: 'range' | 'snapshot';
}
type KpiInit = Omit<Kpi, 'value' | 'comparison'> & { value?: number | null; comparison?: Comparison | null };
const kpi = (k: KpiInit): Kpi => ({ value: null, comparison: null, ...k });

export const LIMITATIONS = [
  'Snapshot KPIs (Total Leads, Active/Available Properties, Active Deals, Pipeline Value, Overdue Tasks) are measured right now. EstateFlow keeps no history of these, so they have no previous-period comparison.',
  'Won Deal Value is the agreed value of won deals. EstateFlow has no payment records, so collected revenue is not available.',
  'Qualified leads counts leads that reached QUALIFIED or later and are not LOST; there is no status history, so leads that were later lost are not counted as qualified.',
  'Records are attributed to their current assignee; assignment history is not kept.',
];

export async function overview(c: AnalyticsContext) {
  const L = can(c, 'leads:read');
  const D = can(c, 'deals:read');
  const P = can(c, 'properties:read');
  const T = can(c, 'tasks:read');

  const [lCur, lPrev, lTotal, dCur, dPrev, dSnap, pSnap, tCur, tPrev, tSnap] = await Promise.all([
    L ? leadSummary(c, c.range) : null,
    L ? leadSummary(c, c.previous) : null,
    L ? leadTotal(c) : null,
    D ? dealSummary(c, c.range) : null,
    D ? dealSummary(c, c.previous) : null,
    D ? dealSnapshot(c) : null,
    P ? propertySnapshot(c) : null,
    T ? taskSummary(c, c.range) : null,
    T ? taskSummary(c, c.previous) : null,
    T ? taskSnapshot(c) : null,
  ]);
  void propertyAdded;

  const kpis: Kpi[] = [];
  const cur = c.orgCurrency;

  if (lCur && lPrev) {
    kpis.push(
      kpi({ key: 'totalLeads', label: 'Total Leads', section: 'leads', kind: 'count', period: 'snapshot', value: lTotal, description: 'All active (not archived) leads you can see, regardless of the date range.' }),
      kpi({ key: 'newLeads', label: 'New Leads', section: 'leads', kind: 'count', period: 'range', value: lCur.newLeads, comparison: compare(lCur.newLeads, lPrev.newLeads), description: 'Leads created in the selected period.' }),
      kpi({ key: 'qualifiedLeads', label: 'Qualified Leads', section: 'leads', kind: 'count', period: 'range', value: lCur.qualified, comparison: compare(lCur.qualified, lPrev.qualified), description: 'Leads created in the period that are now QUALIFIED, MEETING_SCHEDULED, NEGOTIATION or WON (not LOST).' }),
      kpi({ key: 'leadConversionRate', label: 'Lead Conversion Rate', section: 'leads', kind: 'rate', period: 'range', value: lCur.conversionRate, comparison: compare(lCur.conversionRate, lPrev.conversionRate, 'points'), description: 'Leads created in the period that were converted to a contact, divided by all leads created in the period. Empty when no leads were created.' }),
    );
  }
  if (pSnap) {
    kpis.push(
      kpi({ key: 'activeProperties', label: 'Active Properties', section: 'properties', kind: 'count', period: 'snapshot', value: pSnap.totals.active, description: 'Properties on the market now: AVAILABLE, UNDER_OFFER or RESERVED (archived, draft, inactive and closed properties excluded).' }),
      kpi({ key: 'availableProperties', label: 'Available Properties', section: 'properties', kind: 'count', period: 'snapshot', value: pSnap.totals.available, description: 'Properties with status AVAILABLE now.' }),
    );
  }
  if (dCur && dPrev && dSnap) {
    kpis.push(
      kpi({ key: 'activeDeals', label: 'Active Deals', section: 'deals', kind: 'count', period: 'snapshot', value: dSnap.open, description: 'Deals in an open stage now (not WON, LOST or archived).' }),
      kpi({ key: 'wonDeals', label: 'Won Deals', section: 'deals', kind: 'count', period: 'range', value: dCur.won.count, comparison: compare(dCur.won.count, dPrev.won.count), description: 'Deals closed as WON in the period. A reopened and re-won deal is counted once.' }),
      kpi({ key: 'pipelineValue', label: 'Pipeline Value', section: 'deals', kind: 'money', period: 'snapshot', value: amountIn(dSnap.pipeline, cur), amounts: dSnap.pipeline.map((x) => ({ currency: x.currency, amount: x.amount })), description: 'Sum of the value of open deals now, per currency. Expected value, not revenue.' }),
      kpi({ key: 'wonDealValue', label: 'Won Deal Value', section: 'deals', kind: 'money', period: 'range', value: amountIn(dCur.won.byCurrency, cur), amounts: dCur.won.byCurrency.map((x) => ({ currency: x.currency, amount: x.amount })), comparison: compare(amountIn(dCur.won.byCurrency, cur), amountIn(dPrev.won.byCurrency, cur)), description: `Agreed value of deals won in the period, per currency (comparison uses ${cur}). Not cash collected.` }),
    );
  }
  if (tCur && tPrev && tSnap) {
    kpis.push(
      kpi({ key: 'overdueTasks', label: 'Overdue Tasks', section: 'tasks', kind: 'count', period: 'snapshot', value: tSnap.overdue, description: 'Open tasks whose due date has already passed.' }),
      kpi({ key: 'taskCompletionRate', label: 'Task Completion Rate', section: 'tasks', kind: 'rate', period: 'range', value: tCur.completionRate, comparison: compare(tCur.completionRate, tPrev.completionRate, 'points'), description: 'Completed / (completed + still open) among tasks whose due date passed inside the period. Cancelled and future-due tasks are excluded.' }),
    );
  }

  return {
    kpis,
    unavailable: [!L && 'leads', !D && 'deals', !P && 'properties', !T && 'tasks'].filter(Boolean) as string[],
    limitations: LIMITATIONS,
  };
}