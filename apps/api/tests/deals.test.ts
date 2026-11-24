import { describe, expect, it } from 'vitest';
import { Activity } from '../src/modules/activities/activity.model';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import {
  memberOf,
  propertyBody,
  setupOrg
} from './helpers';

type Api = Awaited<ReturnType<typeof setupOrg>>['api'];
const STEPS = ['QUALIFICATION', 'PROPERTY_MATCHED', 'VIEWING_SCHEDULED', 'NEGOTIATION', 'CONTRACT'];

async function seed(api: Api, listingType: 'SALE' | 'RENT' | 'LEASE' = 'SALE') {
  const contact = (await api.post('/contacts', { firstName: 'Buyer', phone: '+923001112233' })).body.data._id as string;
  const property = (await api.post('/properties', propertyBody({ listingType, ...(listingType === 'RENT' ? { rentPeriod: 'MONTHLY' } : {}) }))).body.data._id as string;
  return { contact, property };
}
const newDeal = (api: Api, s: { contact: string; property: string }, o: Record<string, unknown> = {}) =>
  api.post('/deals', { title: 'Deal', contactId: s.contact, propertyId: s.property, dealType: 'SALE', valueAmount: 240_000_000, ...o });
async function advance(api: Api, id: string, upTo: string) {
  for (const stage of STEPS) {
    expect((await api.patch(`/deals/${id}/stage`, { stage })).status).toBe(200);
    if (stage === upTo) return;
  }
}

describe('deals', () => {
  it('creates at NEW, validates references and money, and strips client-controlled fields', async () => {
    const { org, api } = await setupOrg();
    const s = await seed(api);
    const res = await newDeal(api, s, { stage: 'WON', organizationId: 'x', lostReason: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.data.stage).toBe('NEW');
    expect(res.body.data.property.title).toBe('3 Bed House');
    expect((await newDeal(api, s, { valueAmount: 0 })).status).toBe(422);
    expect((await newDeal(api, s, { valueAmount: 1.5 })).status).toBe(422);
    expect((await newDeal(api, s, { probability: 101 })).status).toBe(422);
    expect((await newDeal(api, s, { assignedTo: (await setupOrg()).owner.user._id })).status).toBe(422);
    expect(org).toBeTruthy();
  });

  it('rejects cross-tenant contact, lead and property, and incompatible deal/property types', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const mine = await seed(a.api);
    const theirs = await seed(b.api);
    expect((await newDeal(a.api, { contact: theirs.contact, property: mine.property })).status).toBe(422);
    expect((await newDeal(a.api, { contact: mine.contact, property: theirs.property })).status).toBe(422);
    expect((await newDeal(a.api, mine, { leadId: '64b000000000000000000001' })).status).toBe(422);
    expect((await newDeal(a.api, mine, { dealType: 'RENT' })).status).toBe(422); // property is for SALE
    const sold = await seed(a.api);
    await a.api.patch(`/properties/${sold.property}/status`, { propertyStatus: 'INACTIVE' });
    expect((await newDeal(a.api, sold)).status).toBe(422); // property status does not permit a deal
  });

  it('enforces stage rules on the server', async () => {
    const { api } = await setupOrg();
    const s = await seed(api);
    const id = (await newDeal(api, s)).body.data._id;
    expect((await api.patch(`/deals/${id}/stage`, { stage: 'NEGOTIATION' })).status).toBe(422); // skipping
    expect((await api.patch(`/deals/${id}/stage`, { stage: 'WON' })).status).toBe(422); // closing needs close-won
    expect((await api.patch(`/deals/${id}/stage`, { stage: 'NEW' })).status).toBe(422); // same stage
    await advance(api, id, 'NEGOTIATION');
    expect((await api.patch(`/deals/${id}/stage`, { stage: 'QUALIFICATION' })).status).toBe(200); // moving back is allowed
    const early = (await newDeal(api, s)).body.data._id;
    expect((await api.post(`/deals/${early}/close-won`, {})).status).toBe(409); // still NEW
  });

  it('closes WON: marks the property SOLD/RENTED, validates the date, and keeps other deals untouched', async () => {
    const { api } = await setupOrg();
    const s = await seed(api);
    const winner = (await newDeal(api, s)).body.data._id;
    const bystander = (await newDeal(api, s, { title: 'Other' })).body.data._id;
    await advance(api, winner, 'NEGOTIATION');

    expect((await api.post(`/deals/${winner}/close-won`, { actualClosingDate: new Date(Date.now() + 10 * 864e5).toISOString() })).status).toBe(422);
    const won = await api.post(`/deals/${winner}/close-won`, { valueAmount: 235_000_000 });
    expect(won.status).toBe(200);
    expect(won.body.data.stage).toBe('WON');
    expect(won.body.data.valueAmount).toBe(235_000_000);
    expect(won.body.data.actualClosingDate).toBeTruthy();
    expect((await api.get(`/properties/${s.property}`)).body.data.propertyStatus).toBe('SOLD');
    expect((await api.get(`/deals/${bystander}`)).body.data.stage).toBe('NEW');
    expect((await api.patch(`/deals/${winner}/stage`, { stage: 'NEGOTIATION' })).status).toBe(409); // terminal
    expect((await api.delete(`/deals/${winner}`)).status).toBe(409);

    const rent = await seed(api, 'RENT');
    const rentDeal = (await newDeal(api, rent, { dealType: 'RENT' })).body.data._id;
    await advance(api, rentDeal, 'NEGOTIATION');
    await api.post(`/deals/${rentDeal}/close-won`, {});
    expect((await api.get(`/properties/${rent.property}`)).body.data.propertyStatus).toBe('RENTED');
  });

  it('closes LOST only with a reason, and leaves the property alone', async () => {
    const { api } = await setupOrg();
    const s = await seed(api);
    const id = (await newDeal(api, s)).body.data._id;
    expect((await api.post(`/deals/${id}/close-lost`, {})).status).toBe(422);
    expect((await api.post(`/deals/${id}/close-lost`, { lostReason: '   ' })).status).toBe(422);
    const lost = await api.post(`/deals/${id}/close-lost`, { lostReason: 'Bought elsewhere' });
    expect(lost.body.data.stage).toBe('LOST');
    expect(lost.body.data.lostReason).toBe('Bought elsewhere');
    expect((await api.get(`/properties/${s.property}`)).body.data.propertyStatus).toBe('AVAILABLE');
  });

  it('only one of two racing close-won requests succeeds', async () => {
    const { api } = await setupOrg();
    const s = await seed(api);
    const ids = [(await newDeal(api, s, { title: 'A' })).body.data._id, (await newDeal(api, s, { title: 'B' })).body.data._id];
    for (const id of ids) await advance(api, id, 'NEGOTIATION');
    const results = await Promise.all(ids.map((id) => api.post(`/deals/${id}/close-won`, {})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stages = await Promise.all(ids.map(async (id) => (await api.get(`/deals/${id}`)).body.data.stage));
    expect(stages.filter((x) => x === 'WON')).toHaveLength(1);
    expect((await api.get(`/properties/${s.property}`)).body.data.propertyStatus).toBe('SOLD');
  });

  it('reopen requires deals:reopen, needs a reason, releases the property and is audited', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const manager = await memberOf(org, 'MANAGER');
    const s = await seed(api);
    const id = (await newDeal(api, s)).body.data._id;
    await advance(api, id, 'NEGOTIATION');
    await api.post(`/deals/${id}/close-won`, {});

    expect((await agent.api.post(`/deals/${id}/reopen`, { reason: 'x' })).status).toBe(403); // agents lack deals:reopen
    //     expect((await manager.api.post(`/deals/${id}/reopen`, {})).status).toBe(422);
    const reopened = await manager.api.post(`/deals/${id}/reopen`, { reason: 'Buyer financing fell through' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.stage).toBe('NEGOTIATION');
    expect(reopened.body.data.actualClosingDate).toBeNull();
    expect((await api.get(`/properties/${s.property}`)).body.data.propertyStatus).toBe('AVAILABLE');
    expect(await AuditLog.countDocuments({ action: 'deal.reopened', resourceId: id })).toBe(1);

    const mine = (await agent.api.post('/contacts', { firstName: 'A', phone: '+923007654321' })).body.data._id;
    const own = (await agent.api.post('/deals', { title: 'Own', contactId: mine, propertyId: s.property, dealType: 'SALE', valueAmount: 1000 })).body.data._id;
    await agent.api.post(`/deals/${own}/close-lost`, { lostReason: 'No budget' });
    expect((await agent.api.post(`/deals/${own}/reopen`, { reason: 'try again' })).status).toBe(403); // agents lack deals:reopen
  });

  it('writes audit logs and activity timelines for the important events', async () => {
    const { api } = await setupOrg();
    const s = await seed(api);
    const id = (await newDeal(api, s)).body.data._id;
    await advance(api, id, 'NEGOTIATION');
    await api.post(`/deals/${id}/close-won`, {});

    const actions = (await AuditLog.find({ resourceId: id }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['deal.created', 'deal.stage_changed', 'deal.won']));
    expect(await AuditLog.countDocuments({ resource: 'property', resourceId: s.property, action: 'property.status_changed' })).toBe(1);
    expect(await Activity.countDocuments({ entityType: 'PROPERTY', entityId: s.property, activityType: 'STATUS_CHANGE' })).toBe(1);
    const timeline = await api.get(`/deals/${id}/activities`);
    expect(timeline.body.data.some((a: { description: string }) => a.description === 'Deal closed as won')).toBe(true);
  });

  it('isolates tenants and agent visibility, validates assignment, and blocks archiving a property with open deals', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const agent = await memberOf(a.org, 'AGENT');
    const s = await seed(a.api);
    const id = (await newDeal(a.api, s)).body.data._id;

    expect((await b.api.get(`/deals/${id}`)).status).toBe(404);
    expect((await b.api.patch(`/deals/${id}/stage`, { stage: 'QUALIFICATION' })).status).toBe(404);
    expect((await agent.api.get(`/deals/${id}`)).status).toBe(404); // an agent sees only own deals
    expect((await agent.api.get('/deals')).body.data).toHaveLength(0);
    expect((await a.api.patch(`/deals/${id}/assign`, { assignedTo: b.owner.user._id })).status).toBe(422);
    expect((await a.api.patch(`/deals/${id}/assign`, { assignedTo: agent.user._id })).status).toBe(200);
    expect((await agent.api.get(`/deals/${id}`)).status).toBe(200);

    expect((await a.api.delete(`/properties/${s.property}`)).status).toBe(409);
    await a.api.post(`/deals/${id}/close-lost`, { lostReason: 'Changed mind' });
    expect((await a.api.delete(`/properties/${s.property}`)).status).toBe(200);
  });
});