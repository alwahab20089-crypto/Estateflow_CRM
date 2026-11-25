import { generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit-log.model';
import { createInvitation } from '../src/modules/invitations/invitation.service';
import { licenseEntitlementSource, registerEntitlementSource } from '../src/modules/licensing/entitlements.service';
import { EDITION_PRESETS } from '../src/modules/licensing/license.catalog';
import {
  hashLicenseKey,
  parsePrivateKey,
  parsePublicKey,
  signLicense,
  verifyLicense,
  type LicensePayload,
} from '../src/modules/licensing/license.crypto';
import { License } from '../src/modules/licensing/license.model';
import { API, app, bearer, memberOf, setupOrg } from './helpers';
import { UNLIMITED_ENTITLEMENTS } from './unlimited-entitlements';

const privateKey = () => parsePrivateKey(process.env.TEST_LICENSE_PRIVATE_KEY!);
const publicKey = () => parsePublicKey(process.env.LICENSE_PUBLIC_KEY!);
const DAY = 86_400_000;

function issue(over: Partial<LicensePayload> = {}, daysFromNow: number | null = 30) {
  const now = Date.now();
  return signLicense(
    {
      v: 1,
      jti: randomUUID(),
      licensee: 'Test Agency',
      edition: 'PROFESSIONAL',
      ...EDITION_PRESETS.PROFESSIONAL,
      issuedAt: new Date(now).toISOString(),
      expiresAt: daysFromNow === null ? null : new Date(now + daysFromNow * DAY).toISOString(),
      ...over,
    },
    privateKey(),
  );
}

const validLead = (over: object = {}) => ({
  firstName: 'Olivia', lastName: 'Bennett', phone: '+1 (555) 010-0100', email: 'olivia@example.com',
  leadSource: 'WEBSITE', leadType: 'BUYER', ...over,
});

// The rest of the suite runs with unlimited entitlements; these tests need the real license source.
beforeAll(() => registerEntitlementSource(licenseEntitlementSource));
afterAll(() => registerEntitlementSource(async () => UNLIMITED_ENTITLEMENTS));

describe('license keys (crypto)', () => {
  it('round-trips a signed license', () => {
    const { payload } = verifyLicense(issue({ licensee: 'Round Trip' }), publicKey());
    expect(payload.licensee).toBe('Round Trip');
    expect(payload.edition).toBe('PROFESSIONAL');
  });

  it('ignores spaces and line breaks added when pasting', () => {
    const key = issue();
    const pasted = `  ${key.slice(0, 40)}\n${key.slice(40)}  `;
    expect(verifyLicense(pasted, publicKey()).key).toBe(key);
  });

  it('rejects a tampered payload, a foreign signature and garbage', () => {
    const [prefix, payload, sig] = issue().split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), edition: 'AGENCY' })).toString('base64url');
    expect(() => verifyLicense(`${prefix}.${forged}.${sig}`, publicKey())).toThrow();

    const other = generateKeyPairSync('ed25519');
    const foreign = signLicense(
      { v: 1, jti: randomUUID(), licensee: 'X', edition: 'AGENCY', ...EDITION_PRESETS.AGENCY, issuedAt: new Date().toISOString(), expiresAt: null },
      other.privateKey,
    );
    expect(() => verifyLicense(foreign, publicKey())).toThrow();
    expect(() => verifyLicense('not-a-license', publicKey())).toThrow();
    expect(() => verifyLicense('', publicKey())).toThrow();
  });
});

describe('activation', () => {
  it('starts restricted: readable, but nothing can be created', async () => {
    const { owner, org, api } = await setupOrg();
    const status = await request(app).get(`${API}/licenses/status`).set(bearer(owner.accessToken)).set('X-Organization-Id', org);
    expect(status.status).toBe(200);
    expect(status.body.data.state).toBe('NONE');

    expect((await api.get('/leads')).status).toBe(200);
    const create = await api.post('/leads', validLead());
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('LICENSE_LIMIT_REACHED');
  });

  it('activates a valid key, never stores or returns it, and is idempotent', async () => {
    const { org, api } = await setupOrg();
    const key = issue({ licensee: 'Awan Properties' });

    const res = await api.post('/licenses/activate', { licenseKey: key });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('ACTIVE');
    expect(res.body.data.edition).toBe('PROFESSIONAL');
    expect(res.body.data.license.licensee).toBe('Awan Properties');
    expect(res.body.data.license.keyLast4).toBe(key.slice(-4));
    expect(JSON.stringify(res.body)).not.toContain(key);
    expect(JSON.stringify(res.body)).not.toContain(hashLicenseKey(key));

    const row = await License.findOne({ organizationId: org }).select('+licenseKeyHash');
    expect(row?.licenseKeyHash).toBe(hashLicenseKey(key));
    expect(JSON.stringify(row?.toObject())).not.toContain(key);

    const again = await api.post('/licenses/activate', { licenseKey: key });
    expect(again.status).toBe(200);
    expect(await License.countDocuments({ organizationId: org })).toBe(1);
    expect(await AuditLog.countDocuments({ organizationId: org, action: 'license.activated' })).toBe(1);
  });

  it('rejects invalid and expired keys with the right codes', async () => {
    const { api } = await setupOrg();
    const bad = await api.post('/licenses/activate', { licenseKey: `EF1.${'a'.repeat(30)}.${'b'.repeat(30)}` });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('LICENSE_INVALID');

    const expired = await api.post('/licenses/activate', { licenseKey: issue({}, -60) }); // ended 60 days ago, grace is 14
    expect(expired.status).toBe(422);
    expect(expired.body.code).toBe('LICENSE_EXPIRED');
  });

  it('keeps working during the grace period and reports it', async () => {
    const { api } = await setupOrg();
    const res = await api.post('/licenses/activate', { licenseKey: issue({}, -3) }); // ended 3 days ago
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('GRACE');
    expect((await api.post('/leads', validLead())).status).toBe(201);
  });

  it('refuses a key that another organization already uses', async () => {
    const first = await setupOrg();
    const second = await setupOrg();
    const key = issue();
    expect((await first.api.post('/licenses/activate', { licenseKey: key })).status).toBe(200);
    const res = await second.api.post('/licenses/activate', { licenseKey: key });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LICENSE_ALREADY_USED');
  });

  it('allows only the owner to manage the license; any member can read the status', async () => {
    const { org, api } = await setupOrg();
    const admin = await memberOf(org, 'ADMIN');
    const agent = await memberOf(org, 'AGENT');
    const key = issue();

    expect((await admin.api.post('/licenses/activate', { licenseKey: key })).status).toBe(403);
    expect((await agent.api.get('/licenses/current')).status).toBe(403);
    expect((await agent.api.get('/licenses/status')).status).toBe(200);
    expect((await api.get('/licenses/current')).status).toBe(200);
  });

  it('replacing a license leaves exactly one ACTIVE row', async () => {
    const { org, api } = await setupOrg();
    await api.post('/licenses/activate', { licenseKey: issue({ licensee: 'First' }) });
    await api.post('/licenses/activate', { licenseKey: issue({ licensee: 'Second' }) });
    expect(await License.countDocuments({ organizationId: org, status: 'ACTIVE' })).toBe(1);
    expect(await License.countDocuments({ organizationId: org })).toBe(2);
    expect((await api.get('/licenses/current')).body.data.license.licensee).toBe('Second');
  });

  it('deactivating restricts creation but never hides existing data', async () => {
    const { api } = await setupOrg();
    const key = issue();
    await api.post('/licenses/activate', { licenseKey: key });
    expect((await api.post('/leads', validLead())).status).toBe(201);

    const off = await api.post('/licenses/deactivate');
    expect(off.status).toBe(200);
    expect(off.body.data.state).toBe('INACTIVE');
    expect((await api.post('/leads', validLead({ email: 'two@example.com' }))).status).toBe(403);
    expect((await api.get('/leads')).body.data).toHaveLength(1);
    expect((await api.post('/licenses/deactivate')).body.code).toBe('LICENSE_NOT_ACTIVE');

    // pasting the same key again turns it back on
    const back = await api.post('/licenses/activate', { licenseKey: key });
    expect(back.status).toBe(200);
    expect(back.body.data.state).toBe('ACTIVE');
    expect((await api.post('/leads', validLead({ email: 'three@example.com' }))).status).toBe(201);
  });
});

describe('enforcement', () => {
  it('blocks creating past a limit, but not before it', async () => {
    const { api } = await setupOrg();
    const key = issue({ limits: { ...EDITION_PRESETS.PROFESSIONAL.limits, leads: 1 } });
    await api.post('/licenses/activate', { licenseKey: key });

    expect((await api.post('/leads', validLead())).status).toBe(201);
    const second = await api.post('/leads', validLead({ email: 'two@example.com' }));
    expect(second.status).toBe(403);
    expect(second.body.code).toBe('LICENSE_LIMIT_REACHED');
    expect((await api.get('/licenses/current')).body.data.usage.find((u: { key: string }) => u.key === 'leads').atLimit).toBe(true);
  });

  it('blocks licensed features the edition leaves out', async () => {
    const { api } = await setupOrg();
    await api.post('/licenses/activate', { licenseKey: issue({ edition: 'STANDARD', ...EDITION_PRESETS.STANDARD }) });
    const res = await api.get('/analytics/overview');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_LICENSED');

    await api.post('/licenses/activate', { licenseKey: issue() }); // PROFESSIONAL replaces it
    expect((await api.get('/analytics/overview')).status).toBe(200);
  });

  it('counts pending invitations toward the member limit', async () => {
    const { owner, org, api } = await setupOrg();
    await api.post('/licenses/activate', { licenseKey: issue({ limits: { ...EDITION_PRESETS.PROFESSIONAL.limits, members: 2 } }) });

    const invite = (email: string) => createInvitation({ organizationId: org, email, role: 'AGENT', invitedBy: owner.user._id });
    await expect(invite('a@example.com')).resolves.toBeDefined(); // owner + 1 invite = 2
    await expect(invite('b@example.com')).rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
  });

  it("never lets one organization use another organization's license", async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    await a.api.post('/licenses/activate', { licenseKey: issue() });
    expect((await b.api.post('/leads', validLead())).status).toBe(403); // b still has no license
    expect((await a.api.post('/leads', validLead())).status).toBe(201);
  });
});