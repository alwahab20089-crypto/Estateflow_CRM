import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setStorageForTests } from '../src/storage/storage';
import {
  app,
  API,
  bearer,
  memberOf,
  propertyBody,
  setupOrg
} from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function memoryStorage() {
  const files = new Map<string, Buffer>();
  setStorageForTests({
    put: async (key, data) => { files.set(key, data); return { key, url: `/uploads/${key}` }; },
    delete: async (key) => { files.delete(key); },
  });
  return files;
}
const upload = (token: string, org: string, id: string, file: Buffer, filename: string, contentType: string) =>
  request(app).post(`${API}/properties/${id}/images`).set(bearer(token)).set('X-Organization-Id', org).attach('images', file, { filename, contentType });

describe('properties', () => {
  it('creates a property and ignores client-supplied tenant/author fields', async () => {
    const { org, api } = await setupOrg();
    const other = await setupOrg();
    const res = await api.post('/properties', propertyBody({ organizationId: other.org, createdBy: other.owner.user._id, images: [{ key: 'x' }] }));
    expect(res.status).toBe(201);
    expect(res.body.data.priceAmount).toBe(250_000_000);
    expect(res.body.data.images).toEqual([]);
    expect(res.body.data.organizationId).toBeUndefined();
    expect((await other.api.get('/properties')).body.data).toHaveLength(0);
    expect((await api.get('/properties')).body.data).toHaveLength(1);
    expect(org).toBeTruthy();
  });

  it.each([
    ['zero price', { priceAmount: 0 }],
    ['float price', { priceAmount: 10.5 }],
    ['negative deposit', { securityDepositAmount: -1 }],
    ['negative area', { area: -5 }],
    ['bad currency', { currency: 'DOLLARS' }],
    ['bad coordinates', { latitude: 95, longitude: 10 }],
    ['rent without period', { listingType: 'RENT' }],
  ])('rejects %s', async (_n, patch) => {
    const { api } = await setupOrg();
    expect((await api.post('/properties', propertyBody(patch))).status).toBe(422);
  });

  it('rejects an owner contact or agent from another organization', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const foreignContact = (await b.api.post('/contacts', { firstName: 'Zed', phone: '+923001234567' })).body.data._id;
    expect((await a.api.post('/properties', propertyBody({ ownerContactId: foreignContact }))).status).toBe(422);

    const created = (await a.api.post('/properties', propertyBody())).body.data;
    expect((await a.api.patch(`/properties/${created._id}/assign`, { assignedTo: b.owner.user._id })).status).toBe(422);
  });

  it('assigns to an active member, lists with filters and pagination, archives and restores', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    for (let i = 0; i < 3; i++) await api.post('/properties', propertyBody({ title: `Villa ${i}`, priceAmount: 100_000 * (i + 1), city: i === 2 ? 'Karachi' : 'Lahore' }));
    const first = (await api.get('/properties?sortBy=price&sortOrder=asc&limit=2')).body;
    expect(first.data.map((p: { title: string }) => p.title)).toEqual(['Villa 0', 'Villa 1']);
    expect(first.meta.total).toBe(3);
    expect((await api.get('/properties?city=karachi')).body.data).toHaveLength(1);
    expect((await api.get('/properties?minPrice=150000&maxPrice=250000')).body.data).toHaveLength(1);
    expect((await api.get('/properties?search=villa&bogus=1')).status).toBe(422);

    const id = first.data[0]._id;
    const assigned = await api.patch(`/properties/${id}/assign`, { assignedTo: agent.user._id });
    expect(assigned.body.data.assignee.name).toBeTruthy();

    expect((await api.delete(`/properties/${id}`)).status).toBe(200);
    expect((await api.get(`/properties/${id}`)).status).toBe(200); // owner may still open archived ones
    expect((await api.get('/properties')).body.meta.total).toBe(2);
    expect((await api.post(`/properties/${id}/restore`)).status).toBe(200);
    expect((await api.get('/properties')).body.meta.total).toBe(3);
  });

  it('hides other tenants\' properties by id', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const id = (await a.api.post('/properties', propertyBody())).body.data._id;
    for (const res of [await b.api.get(`/properties/${id}`), await b.api.patch(`/properties/${id}`, { title: 'x' }), await b.api.delete(`/properties/${id}`)]) {
      expect(res.status).toBe(404);
    }
  });

  it('enforces permissions: agents cannot assign or edit properties they neither own nor created', async () => {
    const { org, api } = await setupOrg();
    const agent = await memberOf(org, 'AGENT');
    const id = (await api.post('/properties', propertyBody())).body.data._id;
    expect((await agent.api.patch(`/properties/${id}/assign`, { assignedTo: agent.user._id })).status).toBe(403);
    expect((await agent.api.patch(`/properties/${id}`, { title: 'Mine now' })).status).toBe(403);
    expect((await agent.api.patch(`/properties/${id}/status`, { propertyStatus: 'INACTIVE' })).status).toBe(403);
    const mine = (await agent.api.post('/properties', propertyBody())).body.data;
    expect(mine.assignedTo).toBe(agent.user._id);
    expect((await agent.api.patch(`/properties/${mine._id}`, { title: 'Edited' })).status).toBe(200);
  });

  it('validates uploads and stores only safe keys', async () => {
    const files = memoryStorage();
    const { owner, org, api } = await setupOrg();
    const id = (await api.post('/properties', propertyBody())).body.data._id;

    expect((await upload(owner.accessToken, org, id, Buffer.from('hello'), 'a.txt', 'text/plain')).status).toBe(422);
    expect((await upload(owner.accessToken, org, id, Buffer.from('<script>'), 'a.png', 'image/png')).status).toBe(422); // lies about content
    expect((await upload(owner.accessToken, org, id, PNG, 'a.jpg', 'image/png')).status).toBe(422); // extension mismatch
    expect(files.size).toBe(0);

    const ok = await upload(owner.accessToken, org, id, PNG, '../../evil name.png', 'image/png');
    expect(ok.status).toBe(201);
    expect(ok.body.data.images).toHaveLength(1);
    expect(ok.body.data.primaryImageUrl).toMatch(/^\/uploads\/.+\.png$/);
    expect(JSON.stringify(ok.body)).not.toContain('"key"');
    const [key] = [...files.keys()];
    expect(key).toMatch(new RegExp(`^${org}/properties/${id}/[0-9a-f-]{36}\\.png$`));

    const imageId = ok.body.data.images[0]._id;
    const removed = await api.delete(`/properties/${id}/images/${imageId}`);
    expect(removed.body.data.images).toHaveLength(0);
    expect(files.size).toBe(0);
    setStorageForTests(undefined);
  });
});