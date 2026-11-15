import { OrganizationMember } from '../members/member.model';
import { User } from '../users/user.model';
import { can, rate, type AnalyticsContext } from './analytics.context';
import { dealsByAssignee } from './analytics.deals';
import { leadsByAssignee } from './analytics.leads';
import { tasksByAssignee } from './analytics.tasks';

interface Acc {
  leads: { assigned: number; qualified: number; converted: number; won: number; lost: number };
  deals: { open: number; won: number; lost: number; wonValue: Map<string, { count: number; amount: number }> };
  tasks: { completed: number; pending: number; overdue: number; cohort: number; mTotal: number; mCompleted: number; mOnTime: number };
}
const newAcc = (): Acc => ({
  leads: { assigned: 0, qualified: 0, converted: 0, won: 0, lost: 0 },
  deals: { open: 0, won: 0, lost: 0, wonValue: new Map() },
  tasks: { completed: 0, pending: 0, overdue: 0, cohort: 0, mTotal: 0, mCompleted: 0, mOnTime: 0 },
});

export const ATTRIBUTION =
  'Records are attributed to their CURRENT assignee (no assignment history is kept). Leads: created in the period. Deals: open = right now, won/lost = closed in the period. ' +
  'Tasks: completed = completed in the period, pending/overdue = open right now. Records of removed members are grouped as "Former members"; unassigned records are separate. No ranking is computed.';

/** Per-member performance. Route requires analytics:team. A section is omitted if the caller may not read that module. */
export async function teamAnalytics(c: AnalyticsContext) {
  const members = await OrganizationMember.find({ organizationId: c.tenant.organizationId, status: 'ACTIVE', invitationStatus: 'ACCEPTED' }).select('userId role').lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('name').lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.name as string]));
  const showLeads = can(c, 'leads:read');
  const showDeals = can(c, 'deals:read');
  const showTasks = can(c, 'tasks:read');

  const [leadRows, dealRows, taskRows] = await Promise.all([
    showLeads ? leadsByAssignee(c, c.range) : [],
    showDeals ? dealsByAssignee(c, c.range) : [],
    showTasks ? tasksByAssignee(c, c.range) : [],
  ]);

  const memberIds = new Set(members.map((m) => String(m.userId)));
  const keyOf = (a: unknown) => (a == null ? 'unassigned' : memberIds.has(String(a)) ? String(a) : 'former');
  const accs = new Map<string, Acc>();
  const acc = (k: string) => (accs.has(k) ? accs.get(k)! : (accs.set(k, newAcc()), accs.get(k)!));

  for (const r of leadRows) {
    const a = acc(keyOf(r._id)).leads;
    a.assigned += r.total; a.qualified += r.qualified; a.converted += r.converted; a.won += r.won; a.lost += r.lost;
  }
  for (const r of dealRows) {
    const a = acc(keyOf(r.assignee)).deals;
    a.open += r.open; a.won += r.won; a.lost += r.lost;
    for (const w of r.wonValue) {
      const cur = a.wonValue.get(w.currency) ?? { count: 0, amount: 0 };
      cur.count += w.count; cur.amount += w.amount;
      a.wonValue.set(w.currency, cur);
    }
  }
  for (const r of taskRows) {
    const a = acc(keyOf(r.assignee)).tasks;
    a.completed += r.completed; a.pending += r.pending; a.overdue += r.overdue; a.cohort += r.cohort;
    a.mTotal += r.mTotal; a.mCompleted += r.mCompleted; a.mOnTime += r.mOnTime;
  }

  const finalize = (a: Acc) => ({
    leads: showLeads ? { assigned: a.leads.assigned, qualified: a.leads.qualified, converted: a.leads.converted, won: a.leads.won, lost: a.leads.lost, conversionRate: rate(a.leads.converted, a.leads.assigned) } : null,
    deals: showDeals
      ? {
          open: a.deals.open, won: a.deals.won, lost: a.deals.lost,
          wonValue: [...a.deals.wonValue].map(([currency, v]) => ({ currency, ...v })).sort((x, y) => y.amount - x.amount),
          winRate: rate(a.deals.won, a.deals.won + a.deals.lost),
        }
      : null,
    tasks: showTasks
      ? { completed: a.tasks.completed, pending: a.tasks.pending, overdue: a.tasks.overdue, cohort: a.tasks.cohort, completionRate: rate(a.tasks.mCompleted, a.tasks.mTotal), onTimeRate: rate(a.tasks.mOnTime, a.tasks.mTotal), sample: a.tasks.mTotal }
      : null,
  });

  const visible = (id: string) => c.member === null || (c.member !== 'unassigned' && String(c.member) === id);
  const rows = members
    .filter((m) => visible(String(m.userId)))
    .map((m) => ({ kind: 'member' as const, userId: String(m.userId), name: nameOf.get(String(m.userId)) ?? 'Member', role: m.role as string, ...finalize(acc(String(m.userId))) }));

  const extra = (key: 'unassigned' | 'former', name: string) => {
    const a = accs.get(key);
    const shown = c.member === null || (key === 'unassigned' && c.member === 'unassigned');
    const empty = !a || (a.leads.assigned + a.deals.open + a.deals.won + a.deals.lost + a.tasks.cohort + a.tasks.pending + a.tasks.completed === 0);
    return shown && !empty ? [{ kind: key, userId: null, name, role: null, ...finalize(a!) }] : [];
  };

  return {
    members: [...rows.sort((x, y) => x.name.localeCompare(y.name)), ...extra('unassigned', 'Unassigned'), ...extra('former', 'Former members')],
    attribution: ATTRIBUTION,
  };
}