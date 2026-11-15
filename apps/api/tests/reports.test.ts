import { describe, expect, it } from 'vitest';
import { Lead } from '../src/modules/leads/lead.model';
import { Types } from 'mongoose';
import { memberOf, setupOrg } from './helpers';
import { daysAgo, P30, seedAnalytics } from './analytics-fixtures';

async function world() {
  const w = await setupOrg();
  const a = await memberOf(w.org, 'AGENT');
  const b = await memberOf(w.org, 'AGENT');
  const manager = await memberOf(w.org, 'MANAGER');
  await seedAnalytics(w.org, w.owner.user._id, a.user._id, b.user._id);
  return { ...w, a, b, manager };
}
const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);

describe('reports: catalog and access', () => {
  it('lists only the reports the caller may use', async () => {
    const { api, a } = await world();
    const owner = (await api.get('/reports')).body.data.map((r: { id: string }) => r.id);
    expect(owner).toHaveLength(8);
    const agent = (await a.api.get('/reports')).body.data.map((r: { id: string }) => r.id);
    expect(agent).not.toContain('agent-performance'); // team-only
    expect(agent).toContain('lead-performance');
    expect((await a.api.get(`/reports/agent-performance?${P30}`)).status).toBe(404);
    expect((await api.get(`/reports/nope?${P30}`)).status).toBe(404);
  });
});

describe('reports: rows, filters, sorting, pagination', () => {
  it('pages the lead report and sorts it', async () => {
    const { api } = await world();
    const p1 = await api.get(`/reports/lead-performance?${P30}&limit=2&page=1&sortBy=createdAt&sortOrder=asc`);
    expect(p1.body.meta).toMatchObject({ total: 4, totalPages: 2, page: 1, limit: 2, dateRange: { timezone: 'UTC' } });
    expect(p1.body.data.rows.map((r: { name: string }) => r.name)).toEqual(['L4 Test', 'L3 Test']);
    const p2 = await api.get(`/reports/lead-performance?${P30}&limit=2&page=2&sortBy=createdAt&sortOrder=asc`);
    expect(p2.body.data.rows.map((r: { name: string }) => r.name)).toEqual(['L2 Test', 'L1 Test']);
    expect(p1.body.data.summary).toMatchObject({ newLeads: 4, converted: 2, conversionRate: 50 });
    expect(JSON.stringify(p1.body)).not.toMatch(/phone|email|15550100100/); // no contact details in reports
  });

  it('filters, and rejects filters or sorts a report does not support', async () => {
    const { api } = await world();
    expect((await api.get(`/reports/lead-performance?${P30}&leadSource=FACEBOOK`)).body.meta.total).toBe(1);
    expect((await api.get(`/reports/lead-performance?${P30}&dealType=SALE`)).status).toBe(422);
    expect((await api.get(`/reports/lead-performance?${P30}&sortBy=phone`)).status).toBe(422);
    expect((await api.get(`/reports/won-lost-deals?${P30}&status=NEW`)).status).toBe(422);
  });

  it('reports won and lost deals with agreed (not collected) value', async () => {
    const { api } = await world();
    const all = await api.get(`/reports/won-lost-deals?${P30}`);
    expect(all.body.meta.total).toBe(3);
    expect(all.body.data.summary).toMatchObject({ won: 2, lost: 1, winRate: 66.7 });
    expect(all.body.data.summary.note).toMatch(/not collected revenue/);
    const won = await api.get(`/reports/won-lost-deals?${P30}&status=WON&sortBy=value&sortOrder=desc`);
    expect(won.body.data.rows.map((r: { title: string }) => r.title)).toEqual(expect.arrayContaining(['D3', 'D4']));
    expect(won.body.data.rows.find((r: { title: string }) => r.title === 'D3')).toMatchObject({ value: 200_000, currency: 'USD', daysToClose: 10 });
    const lost = await api.get(`/reports/won-lost-deals?${P30}&status=LOST`);
    expect(lost.body.data.rows[0]).toMatchObject({ title: 'D5', lostReason: 'Bought elsewhere' });
  });

  it('pipeline and inventory reports are snapshots that ignore the range', async () => {
    const { api } = await world();
    const pipe = await api.get('/reports/deal-pipeline?period=7d&timezone=UTC');
    expect(pipe.body.meta.dateRange).toBeNull();
    expect(pipe.body.meta.total).toBe(2);
    expect(pipe.body.data.summary.pipelineValue).toEqual([{ currency: 'USD', count: 2, amount: 15_000_000, weighted: 7_500_000 }]);
    const inv = await api.get('/reports/property-inventory?period=7d&timezone=UTC&status=AVAILABLE');
    expect(inv.body.meta.total).toBe(2);
    expect(inv.body.data.rows.find((r: { title: string }) => r.title === 'P3')).toMatchObject({ price: 50_000, currency: 'USD' });
  });

  it('builds grouped reports per source, member and currency', async () => {
    const { api, a } = await world();
    const src = await api.get(`/reports/lead-source?${P30}`);
    expect(src.body.data.rows.find((r: { source: string }) => r.source === 'WEBSITE')).toMatchObject({ leads: 3, qualified: 2, converted: 2, conversionRate: 66.7 });
    const sales = await api.get(`/reports/sales-performance?${P30}`);
    const rowA = sales.body.data.rows.filter((r: { agent: string }) => r.agent !== 'Unassigned');
    expect(rowA.find((r: { currency: string; wonDeals: number }) => r.currency === 'PKR' && r.wonDeals === 1)).toMatchObject({ wonValue: 30_000_000 });
    const prod = await api.get(`/reports/task-productivity?${P30}`);
    expect(prod.body.data.rows.length).toBeGreaterThanOrEqual(2);
    const perf = await api.get(`/reports/agent-performance?${P30}`);
    expect(perf.body.data.rows.find((r: { agent: string }) => r.agent !== 'Unassigned')).toBeDefined();
    void a;
  });
});

describe('reports: export', () => {
  it('exports the whole filtered dataset (not one page) as CSV with a safe filename', async () => {
    const { api } = await world();
    const res = await api.get(`/reports/lead-performance/export?${P30}&limit=1&page=2`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="lead-performance_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    const rows = lines(res.text);
    expect(rows[0]).toBe('Lead,Source,Type,Status,Priority,Assigned to,Created,Converted');
    expect(rows).toHaveLength(1 + 4); // header + every lead in the period, regardless of page/limit
  });

  it('formats money in major units and respects filters', async () => {
    const { api } = await world();
    const res = await api.get('/reports/deal-pipeline/export?timezone=UTC&dealType=SALE');
    const rows = lines(res.text);
    expect(rows[0]).toContain('Deal value');
    expect(rows.some((r) => r.startsWith('D1,SALE,NEGOTIATION,100000.00,USD,70,'))).toBe(true);
  });

  it('neutralizes formula injection in exported text', async () => {
    const { api, org, owner } = await world();
    await Lead.collection.insertOne({
      organizationId: new Types.ObjectId(org), createdBy: new Types.ObjectId(owner.user._id), deletedAt: null, firstName: '=HYPERLINK("http://evil.test","x")', lastName: '', phone: '+15550100100',
      leadSource: 'WEBSITE', leadType: 'BUYER', status: 'NEW', priority: 'MEDIUM', assignedTo: null, createdAt: daysAgo(1), updatedAt: new Date(),
    });
    const text = (await api.get(`/reports/lead-performance/export?${P30}`)).text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
    expect(text).not.toMatch(/(^|[\r\n,])"?=HYPERLINK/);
  });

  it('requires the export permission and the same report access as the report itself', async () => {
    const { a, manager, api } = await world();
    expect((await a.api.get(`/reports/lead-performance/export?${P30}`)).status).toBe(403); // agents may read reports, not export them
    expect((await manager.api.get(`/reports/lead-performance/export?${P30}`)).status).toBe(200);
    expect((await a.api.get(`/reports/agent-performance/export?${P30}`)).status).toBe(403);
    expect((await api.get(`/reports/lead-performance/export?${P30}&sortBy=phone`)).status).toBe(422);
  });

  it('never exports another organization\'s data', async () => {
    await world();
    const other = await setupOrg();
    const res = await other.api.get(`/reports/lead-performance/export?${P30}`);
    expect(lines(res.text)).toHaveLength(1); // header only
  });
});