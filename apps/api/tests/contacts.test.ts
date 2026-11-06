import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Activity } from '../src/modules/activities/activity.model';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { Contact } from '../src/modules/contacts/contact.model';
import { Lead } from '../src/modules/leads/lead.model';
import { API, app, asUser, memberOf, registerUser, setupOrg } from './helpers';

type Api = ReturnType<typeof asUser>;

const validContact = (over: object = {}) => ({
  firstName: 'Lucas', lastName: 'Meyer', email: 'Lucas@Example.com', phone: '+49 (151) 234-5678',
  contactType: 'BUYER', company: 'Meyer Immobilien', tags: ['VIP', 'vip', 'berlin'], ...over,
});
const validLead = (over: object = {}) => ({
  firstName: 'Olivia', lastName: 'Bennett', phone: '+1 555 010 0100', email: 'olivia@example.com',
  leadSource: 'WEBSITE', leadType: 'BUYER', ...over,
});
async function qualifiedLead(api: Api, over: object = {}) {
  const lead = (await api.post('/leads', validLead(over))).body.data;
  await api.patch(`/leads/${lead._id}/status`, { status: 'QUALIFIED' });
  return lead as { _id: string };
}

describe('create contact', () => {
  it('derives tenant and author server-side, normalizes input and hides internals', async () => {
    const { owner, org, api } = await setupOrg();
    const other = await registerUser();
    const res = await api.post('/contacts', validContact({ organizationId: other.organization._id, createdBy: other.user._id, linkedLeadId: 'x', deletedAt: '2020-01-01' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'lucas@example.com', phone: '+491512345678', fullName: 'Lucas Meyer', status: 'ACTIVE', tags: ['vip', 'berlin'] });
    expect(res.body.data.organizationId).toBeUndefined();
    expect(res.body.data.searchKeywords).toBeUndefined();
    expect(res.body.data.nameSort).toBeUndefined();
    const stored = await Contact.findById(res.body.data._id);
    expect(String(stored?.organizationId)).toBe(org);
    expect(String(stored?.createdBy)).toBe(owner.user._id);
    expect(stored?.linkedLeadId).toBeUndefined();
    expect(stored?.deletedAt).toBeNull();
  });

  it('allows a contact without an email, but needs a phone or an email', async () => {
    const { api } = await setupOrg();
    expect((await api.post('/contacts', { firstName: 'NoEmail', phone: '03001234567' })).status).toBe(201);
    const res = await api.post('/contacts', { firstName: 'Nobody' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('phone');
  });

  it('validates required fields and formats', async () => {
    const { api } = await setupOrg();
    const res = await api.post('/contacts', { firstName: '', email: 'nope', phone: '12', contactType: 'ALIEN' });
    expect(res.status).toBe(422);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'email', 'phone', 'contactType']));
  });

  it('requires authentication', async () => {
    const { org } = await setupOrg();
    expect((await request(app).post(`${API}/contacts`).set('X-Organization-Id', org).send(validContact())).status).toBe(401);
  });

  it('blocks a duplicate email (409) but only warns about a duplicate phone', async () => {
    const { api } = await setupOrg();
    await api.post('/contacts', validContact());
    const email = await api.post('/contacts', validContact({ firstName: 'Other', phone: '03000000000' }));
    expect(email.status).toBe(409);
    expect(email.body.code).toBe('EMAIL_IN_USE');
    expect(email.body.errors[0].path).toBe('email');
    const phone = await api.post('/contacts', validContact({ firstName: 'Twin', email: 'twin@example.com' }));
    expect(phone.status).toBe(201);
    expect(phone.body.meta.duplicates).toHaveLength(1);
  });

  it('writes an activity and an audit log without PII', async () => {
    const { api } = await setupOrg();
    const res = await api.post('/contacts', validContact());
    expect(await Activity.countDocuments({ entityType: 'CONTACT', entityId: res.body.data._id, activityType: 'CREATED' })).toBe(1);
    const audit = await AuditLog.findOne({ action: 'contact.created' }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toMatch(/lucas|meyer|491512/i);
  });

  it('rejects an assignee from another organization, and lets agents assign only themselves', async () => {
    const { org, api } = await setupOrg();
    const outsider = await registerUser();
    const bad = await api.post('/contacts', validContact({ assignedTo: outsider.user._id }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].path).toBe('assignedTo');

    const agent = await memberOf(org, 'AGENT');
    const mine = await agent.api.post('/contacts', validContact({ email: 'a@example.com' }));
    expect(mine.body.data.assignedTo).toBe(agent.user._id);
    const other = await memberOf(org, 'AGENT');
    expect((await agent.api.post('/contacts', validContact({ email: 'b@example.com', assignedTo: other.user._id }))).status).toBe(403);
  });
});

describe('tenant isolation and visibility', () => {
  it('returns 404 for every cross-tenant operation', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const contact = (await a.api.post('/contacts', validContact())).body.data;
    const url = `/contacts/${contact._id}`;
    const results = await Promise.all([
      b.api.get(url), b.api.patch(url, { firstName: 'X' }), b.api.delete(url), b.api.post(`${url}/restore`),
      b.api.patch(`${url}/assign`, { assignedTo: null }), b.api.post(`${url}/notes`, { body: 'hi' }), b.api.get(`${url}/activities`),
    ]);
    for (const res of results) expect(res.status).toBe(404);
    expect((await b.api.get('/contacts/64b7f0c2a1b2c3d4e5f60718')).body.message).toBe((await b.api.get(url)).body.message);
    expect((await Contact.findById(contact._id))?.firstName).toBe('Lucas');
  });

  it('only lists the active organization contacts and refuses foreign organizations', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    await a.api.post('/contacts', validContact());
    await b.api.post('/contacts', validContact({ firstName: 'Zed', email: 'zed@example.com' }));
    const list = await a.api.get('/contacts');
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].firstName).toBe('Lucas');
    const outsider = await registerUser();
    expect((await asUser(outsider.accessToken, a.org).get('/contacts')).status).toBe(404);
  });

  it('restricts agents to their own contacts', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const hidden = (await api.post('/contacts', validContact({ email: 'h@example.com' }))).body.data;
    const mine = (await agent.api.post('/contacts', validContact({ email: 'm@example.com', phone: '03009999999' }))).body.data;
    expect((await agent.api.get('/contacts')).body.data.map((c: { _id: string }) => c._id)).toEqual([mine._id]);
    expect((await agent.api.get(`/contacts/${hidden._id}`)).status).toBe(404);
  });
});

describe('list contacts', () => {
  const seed = async (api: Api) => {
    const rows = [
      { firstName: 'Charlie', lastName: 'Brown', contactType: 'SELLER', email: 'charlie@acme.com', phone: '03001111111', company: 'Acme Holdings', tags: ['vip'] },
      { firstName: 'Alice', lastName: 'Young', contactType: 'BUYER', email: 'alice@mail.com', phone: '03002222222', company: 'Globex', tags: [] },
      { firstName: 'Bob', lastName: 'Stone', contactType: 'BUYER', email: 'bob@mail.com', phone: '+923003333333', tags: ['vip', 'investor'] },
      { firstName: 'Dana', lastName: 'Lee', contactType: 'TENANT', phone: '03004444444', status: 'INACTIVE' },
      { firstName: 'Eve', lastName: 'Park', contactType: 'LANDLORD', email: 'eve@mail.com', phone: '03005555555' },
    ];
    for (const row of rows) expect((await api.post('/contacts', row)).status).toBe(201);
  };

  it('paginates with metadata and rejects bad parameters', async () => {
    const { api } = await setupOrg();
    await seed(api);
    const p2 = await api.get('/contacts?limit=2&page=2');
    expect(p2.body.meta).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(p2.body.data).toHaveLength(2);
    expect((await api.get('/contacts?limit=101')).status).toBe(422);
    expect((await api.get('/contacts?bogus=1')).status).toBe(422);
  });

  it('searches by name, email, phone and company', async () => {
    const { api } = await setupOrg();
    await seed(api);
    const names = async (q: string) => (await api.get(`/contacts?search=${q}`)).body.data.map((c: { firstName: string }) => c.firstName);
    expect(await names('ali')).toEqual(['Alice']);
    expect(await names('bob@')).toEqual(['Bob']);
    expect(await names('0300222')).toEqual(['Alice']);
    expect(await names('%2B92300333')).toEqual(['Bob']);
    expect(await names('acme')).toEqual(['Charlie']);
    expect(await names('glob')).toEqual(['Alice']);
    expect(await names('zzzz')).toEqual([]);
    expect((await api.get('/contacts?search=.*')).status).toBe(200);
  });

  it('filters by type, status, tag, assignee and date', async () => {
    const { org, api } = await setupOrg();
    await seed(api);
    expect((await api.get('/contacts?contactType=BUYER')).body.meta.total).toBe(2);
    expect((await api.get('/contacts?status=INACTIVE')).body.data[0].firstName).toBe('Dana');
    expect((await api.get('/contacts?tag=vip')).body.meta.total).toBe(2);
    expect((await api.get('/contacts?assignedTo=unassigned')).body.meta.total).toBe(5);
    const manager = await memberOf(org, 'MANAGER');
    const first = (await api.get('/contacts?limit=1')).body.data[0];
    await api.patch(`/contacts/${first._id}/assign`, { assignedTo: manager.user._id });
    expect((await api.get(`/contacts?assignedTo=${manager.user._id}`)).body.meta.total).toBe(1);
    const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    expect((await api.get(`/contacts?createdFrom=${future}`)).body.meta.total).toBe(0);
  });

  it('sorts by name and type in both directions', async () => {
    const { api } = await setupOrg();
    await seed(api);
    const asc = await api.get('/contacts?sortBy=name&sortOrder=asc');
    expect(asc.body.data.map((c: { firstName: string }) => c.firstName)).toEqual(['Alice', 'Bob', 'Charlie', 'Dana', 'Eve']);
    const desc = await api.get('/contacts?sortBy=name&sortOrder=desc');
    expect(desc.body.data[0].firstName).toBe('Eve');
    expect((await api.get('/contacts?sortBy=contactType&sortOrder=asc')).body.data[0].contactType).toBe('BUYER');
  });

  it('lists the organization tags', async () => {
    const { api } = await setupOrg();
    await seed(api);
    expect((await api.get('/contacts/tags')).body.data).toEqual(['investor', 'vip']);
  });
});

describe('get and update', () => {
  it('returns a contact with its assignee', async () => {
    const { org, api } = await setupOrg();
    const manager = await memberOf(org, 'MANAGER');
    const contact = (await api.post('/contacts', validContact({ assignedTo: manager.user._id }))).body.data;
    const res = await api.get(`/contacts/${contact._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.assignee._id).toBe(manager.user._id);
    expect(res.body.data.linkedLeads).toEqual([]);
    expect((await api.get('/contacts/not-an-id')).status).toBe(404);
  });

  it('updates, clears values with null, ignores forbidden fields and records activity + audit', async () => {
    const { org, api } = await setupOrg();
    const other = await registerUser();
    const contact = (await api.post('/contacts', validContact())).body.data;
    const res = await api.patch(`/contacts/${contact._id}`, {
      company: 'New Co', email: null, status: 'INACTIVE', organizationId: other.organization._id, assignedTo: other.user._id, linkedLeadId: other.user._id,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ company: 'New Co', email: null, status: 'INACTIVE', assignedTo: null });
    const stored = await Contact.findById(contact._id);
    expect(String(stored?.organizationId)).toBe(org);
    expect(stored?.linkedLeadId).toBeUndefined();
    expect(await Activity.countDocuments({ entityId: contact._id, activityType: 'UPDATE' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'contact.updated' })).toBe(1);
  });

  it('keeps at least one way to reach the contact, and keeps emails unique', async () => {
    const { api } = await setupOrg();
    const a = (await api.post('/contacts', validContact())).body.data;
    await api.post('/contacts', validContact({ firstName: 'B', email: 'b@example.com', phone: '03001230000' }));
    expect((await api.patch(`/contacts/${a._id}`, { email: null, phone: null })).status).toBe(422);
    expect((await api.patch(`/contacts/${a._id}`, { email: 'b@example.com' })).status).toBe(409);
    expect((await api.patch(`/contacts/${a._id}`, {})).status).toBe(422);
  });
});

describe('assignment, archive and restore', () => {
  it('assigns and unassigns, rejecting non-members and agents', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const contact = (await api.post('/contacts', validContact())).body.data;
    expect((await api.patch(`/contacts/${contact._id}/assign`, { assignedTo: agent.user._id })).body.data.assignee._id).toBe(agent.user._id);
    expect((await api.patch(`/contacts/${contact._id}/assign`, { assignedTo: null })).body.data.assignedTo).toBeNull();
    const outsider = await registerUser();
    expect((await api.patch(`/contacts/${contact._id}/assign`, { assignedTo: outsider.user._id })).status).toBe(422);
    const mine = (await agent.api.post('/contacts', validContact({ email: 'q@example.com', phone: '03007777777' }))).body.data;
    expect((await agent.api.patch(`/contacts/${mine._id}/assign`, { assignedTo: null })).status).toBe(403);
  });

  it('archives (soft), hides, restores and keeps history', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const admin = await memberOf(org, 'ADMIN');
    const contact = (await api.post('/contacts', validContact({ assignedTo: agent.user._id }))).body.data;
    expect((await agent.api.delete(`/contacts/${contact._id}`)).status).toBe(403);
    expect((await admin.api.delete(`/contacts/${contact._id}`)).status).toBe(200);
    expect((await api.get('/contacts')).body.meta.total).toBe(0);
    expect((await api.get('/contacts?view=archived')).body.meta.total).toBe(1);
    expect((await agent.api.get('/contacts?view=archived')).status).toBe(403);
    expect(await Contact.countDocuments({ _id: contact._id })).toBe(1);
    const restored = await admin.api.post(`/contacts/${contact._id}/restore`);
    expect(restored.body.data.deletedAt).toBeNull();
    expect((await admin.api.post(`/contacts/${contact._id}/restore`)).status).toBe(404);
    expect(await Activity.countDocuments({ entityId: contact._id })).toBeGreaterThanOrEqual(3);
  });

  it('refuses to restore when the email was taken meanwhile', async () => {
    const { api } = await setupOrg();
    const first = (await api.post('/contacts', validContact())).body.data;
    await api.delete(`/contacts/${first._id}`);
    expect((await api.post('/contacts', validContact({ firstName: 'Replacement' }))).status).toBe(201); // frees-up works
    const res = await api.post(`/contacts/${first._id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_IN_USE');
  });
});

describe('notes and activities', () => {
  it('adds notes and lists activity newest first', async () => {
    const { api } = await setupOrg();
    const contact = (await api.post('/contacts', validContact())).body.data;
    expect((await api.post(`/contacts/${contact._id}/notes`, { body: 'Prefers email.' })).status).toBe(201);
    const list = await api.get(`/contacts/${contact._id}/activities`);
    expect(list.body.data[0].activityType).toBe('NOTE');
    expect((await api.get(`/contacts/${contact._id}/activities?type=NOTE`)).body.meta.total).toBe(1);
    expect((await api.post(`/contacts/${contact._id}/notes`, { body: '  ' })).status).toBe(422);
  });
});

describe('lead to contact conversion', () => {
  it('converts a qualified lead, linking both records and recording history', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const lead = await qualifiedLead(api, { assignedTo: agent.user._id, notes: 'Wants 3 bedrooms' });
    const res = await api.post(`/leads/${lead._id}/convert-to-contact`);
    expect(res.status).toBe(201);
    const { contact, lead: updated, linkedExisting } = res.body.data;
    expect(linkedExisting).toBe(false);
    expect(contact).toMatchObject({ firstName: 'Olivia', email: 'olivia@example.com', phone: '+15550100100', contactType: 'BUYER', source: 'WEBSITE', linkedLeadId: lead._id, assignedTo: agent.user._id, notes: 'Wants 3 bedrooms' });
    expect(updated).toMatchObject({ convertedContactId: contact._id, status: 'QUALIFIED' });
    expect(updated.convertedAt).toEqual(expect.any(String));
    expect(await Activity.countDocuments({ entityType: 'LEAD', entityId: lead._id, activityType: 'CONVERTED' })).toBe(1);
    expect(await Activity.countDocuments({ entityType: 'CONTACT', entityId: contact._id, activityType: 'CREATED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'lead.converted' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'contact.created' })).toBe(1);

    const detail = await api.get(`/contacts/${contact._id}`);
    expect(detail.body.data.linkedLeads).toHaveLength(1);
    expect(detail.body.data.linkedLeads[0]).toMatchObject({ _id: lead._id, name: 'Olivia Bennett' });
  });

  it('rejects leads that are not qualified yet, and LOST leads', async () => {
    const { api } = await setupOrg();
    const fresh = (await api.post('/leads', validLead())).body.data;
    const early = await api.post(`/leads/${fresh._id}/convert-to-contact`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('LEAD_NOT_CONVERTIBLE');

    const lost = (await api.post('/leads', validLead({ phone: '03005550000', email: 'lost@example.com' }))).body.data;
    await api.patch(`/leads/${lost._id}/status`, { status: 'LOST', reason: 'No budget' });
    const res = await api.post(`/leads/${lost._id}/convert-to-contact`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEAD_NOT_CONVERTIBLE');
    expect(res.body.message).toMatch(/reopen/i);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it('protects against repeated conversion', async () => {
    const { api } = await setupOrg();
    const lead = await qualifiedLead(api);
    expect((await api.post(`/leads/${lead._id}/convert-to-contact`)).status).toBe(201);
    const again = await api.post(`/leads/${lead._id}/convert-to-contact`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LEAD_ALREADY_CONVERTED');
    expect(again.body.details.contact._id).toEqual(expect.any(String));
    expect(await Contact.countDocuments()).toBe(1);
  });

  it('creates exactly one contact when two conversions race', async () => {
    const { api } = await setupOrg();
    const lead = await qualifiedLead(api);
    const [a, b] = await Promise.all([api.post(`/leads/${lead._id}/convert-to-contact`), api.post(`/leads/${lead._id}/convert-to-contact`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await Contact.countDocuments()).toBe(1);
    expect(await Activity.countDocuments({ entityId: lead._id, activityType: 'CONVERTED' })).toBe(1);
  });

  it('detects an existing contact by email or phone and creates nothing', async () => {
    const { api } = await setupOrg();
    const existing = (await api.post('/contacts', { firstName: 'Olivia', email: 'olivia@example.com', phone: '03001234567' })).body.data;
    const lead = await qualifiedLead(api);
    const res = await api.post(`/leads/${lead._id}/convert-to-contact`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTACT_DUPLICATE');
    expect(res.body.details.matches[0]).toMatchObject({ _id: existing._id, matchedOn: ['email'] });
    expect(await Contact.countDocuments()).toBe(1);
    expect((await api.get(`/leads/${lead._id}`)).body.data.convertedContactId).toBeNull();

    const byPhone = await qualifiedLead(api, { firstName: 'Phoney', email: 'phoney@example.com', phone: '03001234567' });
    const phoneRes = await api.post(`/leads/${byPhone._id}/convert-to-contact`);
    expect(phoneRes.body.code).toBe('CONTACT_DUPLICATE');
    expect(phoneRes.body.details.matches[0].matchedOn).toEqual(['phone']);
  });

  it('links to the existing contact without overwriting its data', async () => {
    const { api } = await setupOrg();
    const existing = (await api.post('/contacts', { firstName: 'Olivia', lastName: 'B.', email: 'olivia@example.com', phone: '03001234567', company: 'Keep Me' })).body.data;
    const lead = await qualifiedLead(api);
    const res = await api.post(`/leads/${lead._id}/convert-to-contact`, { existingContactId: existing._id });
    expect(res.status).toBe(200);
    expect(res.body.data.linkedExisting).toBe(true);
    expect(res.body.data.lead.convertedContactId).toBe(existing._id);
    const stored = await Contact.findById(existing._id);
    expect(stored).toMatchObject({ company: 'Keep Me', lastName: 'B.' });
    expect(stored?.linkedLeadId).toBeUndefined();
    expect(await Contact.countDocuments()).toBe(1);
  });

  it('is organization-scoped and permission-aware', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const lead = await qualifiedLead(a.api);
    expect((await b.api.post(`/leads/${lead._id}/convert-to-contact`)).status).toBe(404);
    const foreignContact = (await b.api.post('/contacts', validContact())).body.data;
    expect((await a.api.post(`/leads/${lead._id}/convert-to-contact`, { existingContactId: foreignContact._id })).status).toBe(404);

    const agent = await memberOf(a.org, 'AGENT');
    expect((await agent.api.post(`/leads/${lead._id}/convert-to-contact`)).status).toBe(404); // not their lead
    const mine = await qualifiedLead(agent.api, { phone: '03007770000', email: 'mine@example.com' });
    expect((await agent.api.post(`/leads/${mine._id}/convert-to-contact`)).status).toBe(201);
    expect(await Contact.countDocuments({ organizationId: b.org })).toBe(1);
    expect((await Lead.findById(lead._id))?.convertedContactId).toBeFalsy();
  });
});