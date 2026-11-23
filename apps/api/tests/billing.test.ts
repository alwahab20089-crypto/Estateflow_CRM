import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { BillingEvent, Plan, Subscription } from '../src/modules/commercial/commercial.model';
import { acquireUsageSlot, getOrganizationEntitlements, reserveAutomationExecution } from '../src/modules/commercial/entitlements.service';
import {
    InvalidSignatureError,
    type NormalizedSubscription,
} from '../src/modules/commercial/providers/billing-provider';
import {
    createMockBillingProvider, defaultMockSubscription, MOCK_SIGNATURE_HEADER, mockInvoiceEvent, mockOtherEvent,
    mockProviderStore, mockSubscriptionEvent, signMockBody,
} from '../src/modules/commercial/providers/mock.provider';
import { Lead } from '../src/modules/leads/lead.model';
import { API, app, memberOf, setupOrg } from './helpers';

const FREE = { name: 'Free', slug: 'free', isFallback: true, sortOrder: 0, features: { analytics: false }, limits: { members: 5, leads: 2, properties: 5, deals: 5, automationExecutionsPerMonth: 0, storageBytes: 1e9 } };
const PRO = {
    name: 'Pro', slug: 'pro', sortOrder: 1, features: { analytics: true, automations: true }, limits: { members: 10, leads: null, properties: null, deals: null, automationExecutionsPerMonth: 2, storageBytes: null },
    prices: [{ interval: 'MONTH', amount: 4900, currency: 'USD', variants: [{ provider: 'mock', variantId: '111' }] }, { interval: 'YEAR', amount: 49000, currency: 'USD', variants: [{ provider: 'mock', variantId: '222' }] }],
};
const BIZ = {
    name: 'Business', slug: 'biz', sortOrder: 2, features: { analytics: true, automations: true }, limits: { members: null, leads: null, properties: null, deals: null, automationExecutionsPerMonth: 100, storageBytes: null },
    prices: [{ interval: 'MONTH', amount: 14900, currency: 'USD', variants: [{ provider: 'mock', variantId: '333' }] }],
};

const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
const lead = (api: { post: (u: string, b?: object) => Promise<request.Response> }, o = {}) =>
    api.post('/leads', { firstName: 'Olivia', phone: '+15550100100', leadSource: 'WEBSITE', leadType: 'BUYER', ...o });

const post = (raw: string, sig = signMockBody(raw), provider = 'mock') =>
    request(app).post(`${API}/webhooks/billing/${provider}`).set('Content-Type', 'application/json').set(MOCK_SIGNATURE_HEADER, sig).send(raw);

async function org() {
    const ctx = await setupOrg();
    const checkout = await ctx.api.post('/billing/checkout', { planSlug: 'pro', interval: 'MONTH' });
    expect(checkout.status).toBe(200);
    return { ...ctx, checkout: checkout.body.data as { url: string; subscriptionId: string } };
}
type Ctx = Awaited<ReturnType<typeof org>>;
const custom = (c: Ctx) => ({ organization_id: c.org, subscription_ref: c.checkout.subscriptionId });
const subEvent = (
  c: Ctx,
  subscription: Partial<NormalizedSubscription>,
  id?: string,
) =>
  mockSubscriptionEvent({
    id,
    type: 'subscription.updated',
    subscription: { customData: custom(c), ...subscription },
  });
/** Activates the organization through a verified event and registers the same subscription with the fake provider API. */
async function activate(c: Ctx, over = {}) {
    const sub = { updatedAt: at(-20_000), ...over };
    expect((await post(subEvent(c, sub))).status).toBe(200);
    mockProviderStore.subscriptions.set('sub_1', defaultMockSubscription({ ...sub, customData: {} }));
}

beforeEach(async () => {
    mockProviderStore.reset();
    await Plan.create([FREE, PRO]);
});

describe('mock provider (no network)', () => {
    const p = createMockBillingProvider();
    it('verifies its own HMAC signature and rejects everything else', () => {
        const raw = mockOtherEvent();
        expect(() => p.verifySignature(Buffer.from(raw), { [MOCK_SIGNATURE_HEADER]: signMockBody(raw) })).not.toThrow();
        for (const bad of [signMockBody(raw + ' '), signMockBody(raw, 'other'), 'nothex', '', undefined]) {
            expect(() => p.verifySignature(Buffer.from(raw), { [MOCK_SIGNATURE_HEADER]: bad })).toThrow(InvalidSignatureError);
        }
    });
    it('parses its neutral events into the shared webhook shapes', () => {
        expect(p.parseWebhook(Buffer.from(mockSubscriptionEvent({ id: 'mevt_a' })))).toMatchObject({ kind: 'subscription', eventId: 'mevt_a' });
        expect(p.parseWebhook(Buffer.from(mockInvoiceEvent({ type: 'payment.failed' })))).toMatchObject({ kind: 'invoice', outcome: 'FAILED' });
        expect(p.parseWebhook(Buffer.from(mockOtherEvent('customer.updated')))).toMatchObject({ kind: 'other' });
        expect(() => p.parseWebhook(Buffer.from('{"id":"x","type":"subscription.updated"}'))).toThrow();
    });
});

describe('SaaS checkout and onboarding', () => {
    it('lists configured plans without provider internals', async () => {
        const { api } = await setupOrg();
        const res = await api.get('/billing/plans');
        expect(res.status).toBe(200);
        expect(res.body.data.map((x: { slug: string }) => x.slug)).toEqual(['free', 'pro']);
        expect(JSON.stringify(res.body)).not.toMatch(/variantId|111/);
        expect(res.body.data[1].prices[0]).toMatchObject({ interval: 'MONTH', amount: 4900, currency: 'USD', purchasable: true });
    });

    it('creates ONE pending checkout, repeats return the same one, and nothing is granted yet', async () => {
        const { api, org: orgId, checkout } = await org();
        expect(checkout.url).toMatch(/^https:\/\/mock-checkout\.invalid\//);
        const again = await api.post('/billing/checkout', { planSlug: 'pro', interval: 'MONTH' });
        expect(again.body.data).toMatchObject({ subscriptionId: checkout.subscriptionId, reused: true });
        const [a, b] = await Promise.all([api.post('/billing/checkout', { planSlug: 'pro', interval: 'YEAR' }), api.post('/billing/checkout', { planSlug: 'pro', interval: 'YEAR' })]);
        expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
        expect(await Subscription.countDocuments({ organizationId: orgId, status: 'INCOMPLETE' })).toBe(1); // never two live subscriptions

        const overview = (await api.get('/billing/subscription')).body.data;
        expect(overview.onboarding.state).toBe('CHECKOUT_PENDING');
        expect(overview.entitlements).toMatchObject({ source: 'FALLBACK', planSlug: 'free' });
        expect(overview.entitlements.features.analytics).toBe(false); // returning from checkout is not payment
        expect(overview.checkoutConfig).toMatchObject({ provider: 'mock' });
    });

    it('only billing:manage can start a checkout; other organizations never see this subscription', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        const admin = await memberOf(a.org, 'ADMIN');
        expect((await admin.api.post('/billing/checkout', { planSlug: 'pro', interval: 'MONTH' })).status).toBe(403);
        await a.api.post('/billing/checkout', { planSlug: 'pro', interval: 'MONTH' });
        expect((await b.api.get('/billing/subscription')).body.data.subscription).toBeNull();
    });
});

describe('billing webhooks', () => {
    it('rejects an invalid signature and changes nothing', async () => {
        const c = await org();
        const raw = subEvent(c, {});
        expect((await post(raw, 'a'.repeat(64))).status).toBe(401);
        expect((await post(raw, signMockBody(raw + 'x'))).status).toBe(401);
        expect((await post(raw, signMockBody(raw), 'paddle')).status).toBe(404); // the path segment must match the configured provider
        expect(await BillingEvent.countDocuments({})).toBe(0);
        expect((await Subscription.findById(c.checkout.subscriptionId))!.status).toBe('INCOMPLETE');
    });

    it('a verified event activates the plan; redelivery is a no-op', async () => {
        const c = await org();
        const raw = subEvent(c, {}, 'mevt_fixed');
        expect((await post(raw)).status).toBe(200);
        const sub = (await Subscription.findById(c.checkout.subscriptionId))!;
        expect(sub).toMatchObject({ status: 'ACTIVE', planSlug: 'pro', billingInterval: 'MONTH', providerSubscriptionId: 'sub_1' });
        const first = sub.updatedAt;
        expect((await getOrganizationEntitlements(c.org)).features.analytics).toBe(true);

        for (let i = 0; i < 3; i += 1) expect((await post(raw)).status).toBe(200);
        expect(await BillingEvent.countDocuments({})).toBe(1);
        expect(await Subscription.countDocuments({ organizationId: c.org })).toBe(1);
        expect((await Subscription.findById(sub._id))!.updatedAt).toEqual(first);
    });

    it('concurrent identical deliveries are processed once', async () => {
        const c = await org();
        const raw = subEvent(c, {}, 'mevt_concurrent');
        const results = await Promise.all([post(raw), post(raw), post(raw), post(raw)]);
        expect(results.every((r) => r.status === 200)).toBe(true);
        expect(await BillingEvent.countDocuments({ processingStatus: 'PROCESSED' })).toBe(1);
    });

    it('ignores events that arrive out of order', async () => {
        const c = await org();
        await post(subEvent(c, { updatedAt: at(-60_000) }));
        await post(subEvent(c, { status: 'PAST_DUE', updatedAt: at(-10_000) }));
        expect((await post(subEvent(c, { status: 'ACTIVE', updatedAt: at(-30_000) }))).status).toBe(200); // older than what we have
        expect((await Subscription.findById(c.checkout.subscriptionId))!.status).toBe('PAST_DUE');
        expect(await BillingEvent.findOne({ errorSummary: /newer state/ })).not.toBeNull();
    });

    it('payment failure flags the account but keeps access during the retry window; expiry removes it', async () => {
        const c = await org();
        await post(subEvent(c, { updatedAt: at(-50_000) }));
        await post(mockInvoiceEvent({ type: 'payment.failed', occurredAt: at(-40_000) }));
        await post(subEvent(c, { status: 'PAST_DUE', updatedAt: at(-30_000) }));
        const overview = (await c.api.get('/billing/subscription')).body.data;
        expect(overview.subscription).toMatchObject({ status: 'PAST_DUE', paymentIssue: true });
        expect(overview.onboarding.state).toBe('PAYMENT_FAILED');
        expect(overview.entitlements.source).toBe('SUBSCRIPTION');

        await post(mockInvoiceEvent({ type: 'payment.paid', occurredAt: at(-20_000) }));
        await post(subEvent(c, { status: 'ACTIVE', updatedAt: at(-10_000) }));
        expect((await c.api.get('/billing/subscription')).body.data.subscription.paymentIssue).toBe(false);

        await post(subEvent(c, { status: 'EXPIRED', currentPeriodEnd: null, updatedAt: at(-1000) }));
        expect(await getOrganizationEntitlements(c.org)).toMatchObject({ source: 'FALLBACK', planSlug: 'free' });
    });

    it('a cancelled subscription keeps access until the paid period ends, then falls back', async () => {
        const c = await org();
        await post(subEvent(c, { updatedAt: at(-20_000) }));
        await post(subEvent(c, { status: 'CANCELLED', cancelAtPeriodEnd: true, currentPeriodEnd: at(86_400_000), updatedAt: at(-10_000) }));
        const sub = (await Subscription.findById(c.checkout.subscriptionId))!;
        expect(sub).toMatchObject({ status: 'CANCELLED', cancelAtPeriodEnd: true });
        expect((await getOrganizationEntitlements(c.org)).source).toBe('SUBSCRIPTION');
        await Subscription.updateOne({ _id: sub._id }, { $set: { currentPeriodEnd: at(-1000) } });
        expect((await getOrganizationEntitlements(c.org)).source).toBe('FALLBACK');
        expect(await Subscription.countDocuments({ organizationId: c.org })).toBe(1); // history is preserved, never deleted
    });

    it('an unknown variant fails loudly, grants nothing, and succeeds on redelivery once the mapping exists', async () => {
        const c = await org();
        const raw = subEvent(c, { providerVariantId: '999' }, 'mevt_retry');
        expect((await post(raw)).status).toBeGreaterThanOrEqual(500);
        expect((await BillingEvent.findOne({}))!.processingStatus).toBe('FAILED');
        expect((await getOrganizationEntitlements(c.org)).source).toBe('FALLBACK');

        await Plan.updateOne({ slug: 'pro', 'prices.interval': 'MONTH' }, { $push: { 'prices.$.variants': { provider: 'mock', variantId: '999' } } });
        expect((await post(raw)).status).toBe(200); // same event id: the FAILED row is claimed again
        expect(await BillingEvent.countDocuments({})).toBe(1);
        expect(await BillingEvent.findOne({})).toMatchObject({ processingStatus: 'PROCESSED', attempts: 2 });
        expect((await getOrganizationEntitlements(c.org)).source).toBe('SUBSCRIPTION');
    });

    it('an unmatched checkout is skipped, never guessed', async () => {
        const c = await org();
        const raw = mockSubscriptionEvent({ subscription: { providerSubscriptionId: 'sub_x', customData: { organization_id: c.org, subscription_ref: '0'.repeat(24) } } });
        expect((await post(raw)).status).toBe(200);
        expect(await BillingEvent.findOne({ errorSummary: /no matching/ })).not.toBeNull();
    });

    it('acknowledges events it does not act on, keeps no payload, and a redelivery changes nothing', async () => {
        const raw = mockOtherEvent('customer.updated', 'mevt_other');
        expect((await post(raw)).status).toBe(200);
        expect((await post(raw)).status).toBe(200);
        expect(await BillingEvent.countDocuments({})).toBe(1);
        const stored = await BillingEvent.findOne({}).select('+payload').lean();
        expect(stored).toMatchObject({ processingStatus: 'SKIPPED', eventType: 'customer.updated' });
        expect(stored!.payload).toBeUndefined();
    });

    it("another organization's custom data cannot activate this organization's checkout", async () => {
        const a = await org();
        const b = await setupOrg();
        await post(mockSubscriptionEvent({ subscription: { customData: { organization_id: b.org, subscription_ref: a.checkout.subscriptionId } } }));
        expect((await Subscription.findById(a.checkout.subscriptionId))!.status).toBe('INCOMPLETE');
        expect((await getOrganizationEntitlements(b.org)).source).toBe('FALLBACK');
    });
});

describe('subscription management', () => {
    it('cancel schedules the end of the period, is idempotent, and resume undoes it', async () => {
        const c = await org();
        await activate(c);
        const cancelled = await c.api.post('/billing/cancel');
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.subscription).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true, canResume: true });
        expect(cancelled.body.data.onboarding.state).toBe('CANCELLING');
        expect(cancelled.body.data.entitlements.source).toBe('SUBSCRIPTION'); // access continues until the period ends
        expect((await c.api.post('/billing/cancel')).body.data.subscription.cancelAtPeriodEnd).toBe(true);

        const resumed = await c.api.post('/billing/resume');
        expect(resumed.body.data.subscription).toMatchObject({ cancelAtPeriodEnd: false, canResume: false });
        expect((await c.api.post('/billing/resume')).status).toBe(200); // nothing scheduled: idempotent
    });

    it('an ended subscription cannot be resumed or changed', async () => {
        const c = await org();
        await activate(c);
        await Subscription.updateOne({ organizationId: c.org }, { $set: { status: 'CANCELLED' } });
        expect((await c.api.post('/billing/resume')).body.code).toBe('SUBSCRIPTION_ENDED');
        expect((await c.api.post('/billing/change-plan', { planSlug: 'pro', interval: 'YEAR' })).body.code).toBe('SUBSCRIPTION_ENDED');
    });

    it('changes plan through the provider, no-ops on the current plan, and refuses while payment is overdue', async () => {
        const c = await org();
        await Plan.create(BIZ);
        await activate(c);
        const changed = await c.api.post('/billing/change-plan', { planSlug: 'biz', interval: 'MONTH' });
        expect(changed.status).toBe(200);
        expect(changed.body.data.entitlements.planSlug).toBe('biz');
        const before = mockProviderStore.subscriptions.get('sub_1')!.updatedAt;
        expect((await c.api.post('/billing/change-plan', { planSlug: 'biz', interval: 'MONTH' })).status).toBe(200);
        expect(mockProviderStore.subscriptions.get('sub_1')!.updatedAt).toEqual(before); // no second provider call

        await Subscription.updateOne({ organizationId: c.org }, { $set: { status: 'PAST_DUE' } });
        expect((await c.api.post('/billing/change-plan', { planSlug: 'pro', interval: 'YEAR' })).body.code).toBe('PLAN_CHANGE_NOT_ALLOWED');
    });

    it('returns a temporary portal link and maps provider rejections to a clean error', async () => {
        const c = await org();
        await activate(c);
        expect((await c.api.post('/billing/portal')).body.data.url).toMatch(/^https:\/\/mock-portal\.invalid\//);
        mockProviderStore.subscriptions.clear(); // the provider no longer knows the subscription (404)
        const res = await c.api.post('/billing/cancel');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('BILLING_CHANGE_REJECTED');
    });

    it('requires billing:manage and never reaches another organization', async () => {
        const c = await org();
        await activate(c);
        const admin = await memberOf(c.org, 'ADMIN');
        for (const path of ['/billing/cancel', '/billing/resume', '/billing/portal']) expect((await admin.api.post(path)).status).toBe(403);
        expect((await admin.api.post('/billing/change-plan', { planSlug: 'pro', interval: 'YEAR' })).status).toBe(403);
        const other = await setupOrg();
        expect((await other.api.post('/billing/cancel')).status).toBe(404);
    });
});

describe('entitlements and limits', () => {
    it('blocks paid features on the fallback plan and allows them after a verified activation', async () => {
        const c = await org();
        expect((await c.api.get('/analytics/overview')).body.code).toBe('FEATURE_NOT_AVAILABLE'); // needs the requireFeature wiring
        await post(subEvent(c, {}));
        expect((await c.api.get('/analytics/overview')).status).toBe(200);
    });

    it('enforces a hard limit on direct API calls; archived leads do not count', async () => {
        const { api } = await setupOrg(); // fallback: 2 leads
        const first = (await lead(api)).body.data;
        expect((await lead(api)).status).toBe(201);
        const blocked = await lead(api);
        expect(blocked.status).toBe(403);
        expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');
        expect(blocked.body.message).toMatch(/2 of 2/);
        await api.delete(`/leads/${first._id}`); // archive
        expect((await lead(api)).status).toBe(201);
    });

    it('never exceeds the limit under concurrent creation', async () => {
        const { api, org: orgId } = await setupOrg();
        const results = await Promise.all(Array.from({ length: 8 }, () => lead(api)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        expect(await Lead.countDocuments({ organizationId: orgId, deletedAt: null })).toBe(2);
    });

    it('keeps one organization from consuming another organization allowance', async () => {
        const a = await setupOrg();
        const b = await setupOrg();
        await lead(a.api);
        await lead(a.api);
        expect((await lead(b.api)).status).toBe(201);
    });

    it('the monthly automation counter is exact under concurrency and the slot lock is exclusive', async () => {
        const c = await org();
        await post(subEvent(c, {})); // pro: 2 executions / month
        const reservations = await Promise.all(Array.from({ length: 6 }, () => reserveAutomationExecution(c.org)));
        expect(reservations.filter(Boolean)).toHaveLength(2);

        const release = await acquireUsageSlot(c.org, 'leads');
        await expect(acquireUsageSlot(c.org, 'leads', 150)).rejects.toBeTruthy();
        await release();
        await expect(acquireUsageSlot(c.org, 'leads', 500)).resolves.toBeTypeOf('function');
    });
});