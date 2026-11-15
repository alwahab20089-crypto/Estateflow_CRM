import { describe, expect, it } from 'vitest';
import { memberOf, setupOrg } from './helpers';
import { custom, P30, seedAnalytics } from './analytics-fixtures';

async function world() {
  const w = await setupOrg();
  const a = await memberOf(w.org, 'AGENT');
  const b = await memberOf(w.org, 'AGENT');
  const manager = await memberOf(w.org, 'MANAGER');
  await seedAnalytics(w.org, w.owner.user._id, a.user._id, b.user._id);
  return { ...w, a, b, manager };
}
const kpi = (res: { body: { data: { kpis: Array<{ key: string }> } } }, key: string) => res.body.data.kpis.find((k) => k.key === key) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('analytics: overview', () => {
  it('computes every KPI from the real records (archived records excluded)', async () => {
    const { api } = await world();
    const res = await api.get(`/analytics/overview?${P30}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ timezone: 'UTC', scope: 'organization', currency: 'USD' });

    expect(kpi(res, 'totalLeads')).toMatchObject({ value: 6, period: 'snapshot', comparison: null }); // L6 archived
    expect(kpi(res, 'newLeads')).toMatchObject({ value: 4, comparison: { previous: 2, changePct: 100, direction: 'up' } });
    expect(kpi(res, 'qualifiedLeads').value).toBe(2); // L1 + L4(WON); LOST and NEW excluded
    expect(kpi(res, 'leadConversionRate')).toMatchObject({ value: 50, comparison: { previous: 0, direction: 'new', changePoints: 50 } }); // 2 of 4
    expect(kpi(res, 'activeProperties').value).toBe(3);
    expect(kpi(res, 'availableProperties').value).toBe(2);
    expect(kpi(res, 'activeDeals').value).toBe(2); // D6 archived, D5 lost, D3/D4 won
    expect(kpi(res, 'wonDeals')).toMatchObject({ value: 2, comparison: { previous: 1, changePct: 100 } });
    expect(kpi(res, 'pipelineValue')).toMatchObject({ value: 15_000_000, amounts: [{ currency: 'USD', amount: 15_000_000 }] });
    expect(kpi(res, 'wonDealValue')).toMatchObject({ value: 20_000_000, comparison: { previous: 8_000_000, changePct: 150 } });
    expect(kpi(res, 'wonDealValue').amounts).toEqual(expect.arrayContaining([{ currency: 'PKR', amount: 3_000_000_000 }])); // never summed with USD
    expect(kpi(res, 'overdueTasks').value).toBe(1); // T3 only: T4 is future, T7 archived, T1/T2 done
    expect(kpi(res, 'taskCompletionRate')).toMatchObject({ value: 66.7, comparison: { previous: null, direction: 'unknown' } });
    expect(res.body.data.limitations.join(' ')).toMatch(/collected revenue is not available/);
  });

  it('returns safe empty results for an organization with no data', async () => {
    const { api } = await setupOrg();
    const res = await api.get(`/analytics/overview?${P30}`);
    expect(res.status).toBe(200);
    expect(kpi(res, 'newLeads')).toMatchObject({ value: 0, comparison: { direction: 'flat', changePct: null } });
    expect(kpi(res, 'leadConversionRate').value).toBeNull(); // no leads: not 0%
    expect(kpi(res, 'taskCompletionRate').value).toBeNull();
    expect(kpi(res, 'pipelineValue')).toMatchObject({ value: 0, amounts: [] });
  });

  it('filters by date range', async () => {
    const { api } = await world();
    const res = await api.get(`/analytics/overview?${custom(6)}`); // includes the day 6 days ago, excludes 7 days ago
    expect(kpi(res, 'newLeads').value).toBe(2); // L1 (5d) + L2 (6d); L3 is 7d ago, L4 is 8d ago
  });
});

describe('analytics: leads', () => {
  it('breaks leads down once each, with conversion and time to convert', async () => {
    const { api, a } = await world();
    const res = await api.get(`/analytics/leads?${P30}`);
    const d = res.body.data;
    expect(d.summary).toMatchObject({ totalLeads: 6, newLeads: 4, qualified: 2, converted: 2, won: 1, lost: 1, conversionRate: 50, convertedInPeriod: 2, avgDaysToConvert: 5 });
    expect(d.bySource.find((s: { key: string }) => s.key === 'WEBSITE')).toMatchObject({ count: 3, share: 75 });
    expect(d.bySource.find((s: { key: string }) => s.key === 'FACEBOOK').count).toBe(1);
    expect(d.byStatus.find((s: { key: string }) => s.key === 'LOST').count).toBe(1);
    expect(d.byStatus.reduce((n: number, s: { count: number }) => n + s.count, 0)).toBe(4); // no lead counted twice
    const agentA = d.byAgent.find((r: { userId: string }) => r.userId === a.user._id);
    expect(agentA).toMatchObject({ total: 2, converted: 1, conversionRate: 50 });
    expect(d.byAgent.find((r: { userId: null }) => r.userId === null)).toMatchObject({ name: 'Unassigned', total: 1 });
    expect(d.series[0].points.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(4);
    expect(d.series[0].points).toHaveLength(30); // zero-filled daily buckets
  });

  it('applies filters', async () => {
    const { api } = await world();
    const res = await api.get(`/analytics/leads?${P30}&leadSource=FACEBOOK`);
    expect(res.body.data.summary.newLeads).toBe(1);
  });
});

describe('analytics: deals and revenue', () => {
  it('separates pipeline from won value and never mixes currencies', async () => {
    const { api } = await world();
    const res = await api.get(`/analytics/deals?${P30}`);
    const d = res.body.data;
    expect(d.pipeline).toMatchObject({ open: 2, pipeline: [{ currency: 'USD', count: 2, amount: 15_000_000, weighted: 7_500_000 }] }); // lost D5 and archived D6 excluded
    expect(d.summary.won.count).toBe(2);
    expect(d.summary.won.byCurrency).toEqual([
      { currency: 'PKR', count: 1, amount: 3_000_000_000 },
      { currency: 'USD', count: 1, amount: 20_000_000 },
    ]);
    expect(d.summary).toMatchObject({ lost: 1, closed: 3, winRate: 66.7, avgDaysToClose: 7.5, created: 5 });
    expect(d.byStage.find((s: { stage: string }) => s.stage === 'NEGOTIATION').count).toBe(1);
    expect(d.byStage.find((s: { stage: string }) => s.stage === 'WON').count).toBe(2);
    expect(d.byStage.find((s: { stage: string }) => s.stage === 'LOST').count).toBe(1);
    expect(d.wonVsLost).toEqual({ won: 2, lost: 1 });
    expect(d.comparison.won).toMatchObject({ previous: 1, changePct: 100 });
  });

  it('labels revenue honestly: won deal value, not collected revenue', async () => {
    const { api } = await world();
    const res = await api.get(`/analytics/revenue?${P30}`);
    const d = res.body.data;
    expect(d.isCollectedRevenue).toBe(false);
    expect(d.collectedRevenue).toBeNull();
    expect(d.wonDealValue.byCurrency.find((x: { currency: string }) => x.currency === 'USD')).toMatchObject({ amount: 20_000_000, previousAmount: 8_000_000, comparison: { changePct: 150 } });
    expect(d.notes.join(' ')).toMatch(/not cash received/);
    expect(d.pipeline.pipeline[0].amount).toBe(15_000_000);
  });
});

describe('analytics: properties', () => {
  it('counts the real inventory and keeps currencies apart', async () => {
    const { api } = await world();
    const d = (await api.get(`/analytics/properties?${P30}`)).body.data;
    expect(d.totals).toEqual({ total: 5, active: 3, available: 2 }); // P6 archived
    expect(d.byStatus.find((s: { key: string }) => s.key === 'SOLD').count).toBe(1);
    expect(d.byStatus.find((s: { key: string }) => s.key === 'DRAFT').count).toBe(1);
    expect(d.byCity.top[0]).toMatchObject({ key: 'Lahore', count: 2 });
    expect(d.byCity.top.find((c: { key: string }) => c.key === 'Unknown').count).toBe(1);
    // SOLD P4 (99M) is not on the market, so it never reaches an average; PKR and USD are never merged
    expect(d.averageListingPrice).toEqual([
      { currency: 'PKR', listingType: 'SALE', rentPeriod: null, count: 2, average: 15_000_000 },
      { currency: 'USD', listingType: 'SALE', rentPeriod: null, count: 1, average: 5_000_000 },
    ]);
    expect(d.added.count).toBe(4); // P1, P2, P3, P5 added in the period (P4 is 60 days old)
  });
});

describe('analytics: tasks', () => {
  it('computes completion, on-time and overdue with the documented rules', async () => {
    const { api } = await world();
    const d = (await api.get(`/analytics/tasks?${P30}`)).body.data;
    expect(d.summary).toMatchObject({ completedInPeriod: 2, matured: 3, completionRate: 66.7, onTimeRate: 33.3, open: 2, todo: 1, inProgress: 1, overdue: 1 });
    expect(d.byStatus.find((s: { key: string }) => s.key === 'CANCELLED').count).toBe(1);
    expect(d.byStatus.find((s: { key: string }) => s.key === 'COMPLETED').count).toBe(2); // cancelled is never "completed"
    expect(d.byPriority.find((s: { key: string }) => s.key === 'HIGH').count).toBe(1);
    expect(d.series[1].points.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(2); // completed trend
  });
});

describe('analytics: team attribution and visibility', () => {
  it('attributes records to the current assignee and keeps unassigned separate', async () => {
    const { api, a, b } = await world();
    const d = (await api.get(`/analytics/team?${P30}`)).body.data;
    const row = (id: string) => d.members.find((m: { userId: string }) => m.userId === id);
    expect(row(a.user._id)).toMatchObject({
      leads: { assigned: 2, qualified: 1, converted: 1, conversionRate: 50 },
      deals: { open: 1, won: 2, lost: 0, winRate: 100 },
      tasks: { completed: 2, pending: 1, overdue: 1, completionRate: 66.7 },
    });
    expect(row(a.user._id).deals.wonValue).toEqual(expect.arrayContaining([{ currency: 'USD', count: 1, amount: 20_000_000 }, { currency: 'PKR', count: 1, amount: 3_000_000_000 }]));
    expect(row(b.user._id)).toMatchObject({ leads: { assigned: 1, converted: 0 }, deals: { open: 1, won: 0, lost: 1, winRate: 0 }, tasks: { completed: 0, pending: 1, overdue: 0, completionRate: null } });
    expect(d.members.find((m: { kind: string }) => m.kind === 'unassigned')).toMatchObject({ leads: { assigned: 1, converted: 1 } });
    expect(d.attribution).toMatch(/CURRENT assignee/);
  });

  it('agents see only their own numbers and cannot open team analytics', async () => {
    const { a, b } = await world();
    const mine = await a.api.get(`/analytics/overview?${P30}`);
    expect(mine.status).toBe(200);
    expect(mine.body.meta.scope).toBe('self');
    expect(kpi(mine, 'newLeads').value).toBe(2); // only L1 + L2
    expect(kpi(mine, 'activeDeals').value).toBe(1); // only D1
    expect((await a.api.get(`/analytics/team?${P30}`)).status).toBe(403);
    expect((await a.api.get(`/analytics/leads?${P30}&assignedTo=${b.user._id}`)).status).toBe(403);
    expect((await a.api.get(`/analytics/leads?${P30}&assignedTo=me`)).status).toBe(200);
  });

  it('managers get team analytics and can filter by member', async () => {
    const { manager, a } = await world();
    expect((await manager.api.get(`/analytics/team?${P30}`)).status).toBe(200);
    const res = await manager.api.get(`/analytics/leads?${P30}&assignedTo=${a.user._id}`);
    expect(res.body.data.summary.newLeads).toBe(2);
  });
});

describe('analytics: validation, trends and tenancy', () => {
  it('rejects invalid ranges and parameters', async () => {
    const { api } = await setupOrg();
    expect((await api.get('/analytics/overview?period=custom&from=2026-11-10&to=2026-11-01')).status).toBe(422);
    expect((await api.get('/analytics/overview?period=custom&from=2026-01-01&to=2027-06-01')).status).toBe(422); // > 366 days
    expect((await api.get('/analytics/overview?period=custom&from=2026-11-01')).status).toBe(422);
    expect((await api.get('/analytics/overview?period=30d&from=2026-11-01&to=2026-11-10')).status).toBe(422);
    expect((await api.get('/analytics/overview?from=not-a-date&period=custom&to=2026-11-10')).status).toBe(422);
    expect((await api.get('/analytics/overview?timezone=Mars/Base')).status).toBe(422);
    expect((await api.get('/analytics/overview?bogus=1')).status).toBe(422);
    expect((await api.get('/analytics/leads?leadSource=SMOKE')).status).toBe(422);
    expect((await api.get('/analytics/trends?metrics=nope')).status).toBe(422);
  });

  it('returns continuous, zero-filled trend series for the requested grouping', async () => {
    const { api } = await world();
    const week = (await api.get(`/analytics/trends?${P30}&groupBy=week&metrics=leadsCreated,dealsWonValue`)).body.data;
    expect(week.groupBy).toBe('week');
    expect(week.series.map((s: { key: string }) => s.key)).toEqual(['leadsCreated', 'dealsWonValue']);
    expect(week.series[0].points.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(4);
    const won = week.series[1];
    expect(won.unit).toBe('money');
    expect(won.points.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(20_000_000); // org currency (USD) only
    expect(won.points.some((p: { byCurrency?: Record<string, number> }) => p.byCurrency?.PKR === 3_000_000_000)).toBe(true);
    const month = (await api.get(`/analytics/trends?${P30}&groupBy=month`)).body.data;
    expect(month.buckets.length).toBeLessThanOrEqual(2);
  });

  it('never mixes organizations', async () => {
    const mine = await world();
    const other = await setupOrg();
    const res = await other.api.get(`/analytics/overview?${P30}`);
    expect(kpi(res, 'newLeads').value).toBe(0);
    expect(kpi(res, 'activeDeals').value).toBe(0);
    expect((await other.api.get(`/analytics/team?${P30}`)).body.data.members.map((m: { userId: string }) => m.userId)).not.toContain(mine.a.user._id);
    expect((await other.api.get(`/analytics/leads?${P30}&assignedTo=${mine.a.user._id}`)).status).toBe(422); // not a member of THIS organization
  });
});