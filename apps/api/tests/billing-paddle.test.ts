import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingEvent, Plan, Subscription } from '../src/modules/commercial/commercial.model';
import { getOrganizationEntitlements } from '../src/modules/commercial/entitlements.service';
import { getBillingProvider, resolveProvider, setBillingProviderForTests } from '../src/modules/commercial/providers';
import { BillingProviderError, InvalidSignatureError } from '../src/modules/commercial/providers/billing-provider';
import {
  createPaddleProvider, normalizeSubscription, PADDLE_STATUS_MAP, type PaddleConfig,
} from '../src/modules/commercial/providers/paddle.provider';
import { API, app, memberOf, setupOrg } from './helpers';

const SECRET = 'pdl_ntfset_test_secret_value_0123456789';
const API_KEY = 'pdl_sdbx_apikey_testkeytestkeytestkey';
const SUB_ID = 'sub_01paddletest0001';
const CUSTOMER_ID = 'ctm_01paddletest0001';
const PRICE = { proMonth: 'pri_promonth01', proYear: 'pri_proyear01', bizMonth: 'pri_bizmonth01' };

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
type Entity = Record<string, unknown>;

/** Shaped like the subscription entity in Paddle's webhook reference. */
function entity(over: Entity = {}): Entity {
  return {
    id: SUB_ID, status: 'active', customer_id: CUSTOMER_ID,
    items: [{ price: { id: PRICE.proMonth }, status: 'active', quantity: 1 }],
    current_billing_period: { starts_at: iso(-86_400_000), ends_at: iso(30 * 86_400_000) },
    scheduled_change: null, custom_data: null,
    started_at: iso(-86_400_000), first_billed_at: iso(-86_400_000), next_billed_at: iso(30 * 86_400_000),
    paused_at: null, canceled_at: null, updated_at: iso(0), ...over,
  };
}
let counter = 0;
const hook = (type: string, data: unknown, id = `evt_test${String((counter += 1)).padStart(6, '0')}`) =>
  JSON.stringify({ event_id: id, event_type: type, occurred_at: iso(0), notification_id: `ntf_test${counter}`, data });
const header = (raw: string | Buffer, secret = SECRET, ts = Math.floor(Date.now() / 1000)) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:`).update(raw).digest('hex')}`;
const send = (raw: string, sig = header(raw), provider = 'paddle') =>
  request(app).post(`${API}/webhooks/billing/${provider}`).set('Content-Type', 'application/json').set('Paddle-Signature', sig).send(raw);

/* ----------------------------------------------------------------- a stateful fake of the Paddle API (no network) */
function createFakePaddle() {
  const state = {
    sub: null as Entity | null,
    transactions: [] as { body: unknown }[],
    calls: [] as { method: string; path: string; body: unknown; auth: string | null }[],
    failNext: null as number | null,
  };
  const touch = (change: Entity) => {
    const prev = new Date(String(state.sub!.updated_at)).getTime();
    state.sub = { ...state.sub!, ...change, updated_at: new Date(Math.max(Date.now(), prev + 1)).toISOString() };
  };
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path: url.pathname, body, auth: new Headers(init?.headers).get('authorization') });
    if (state.failNext) { const status = state.failNext; state.failNext = null; return new Response('{}', { status }); }
    const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

    if (method === 'POST' && url.pathname === '/transactions') {
      state.transactions.push({ body });
      const id = `txn_01test${state.transactions.length}`;
      return json({ id, checkout: { url: `https://app.example.test/app/settings/billing?_ptxn=${id}` } }, 201);
    }
    if (!state.sub) return new Response('{}', { status: 404 });
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === 'GET' && url.pathname === `/subscriptions/${SUB_ID}`) return json(state.sub);
    if (method === 'POST' && url.pathname === `/subscriptions/${SUB_ID}/cancel`) {
      if (b.effective_from === 'immediately') touch({ status: 'canceled', canceled_at: iso(0), current_billing_period: null, next_billed_at: null, scheduled_change: null });
      else touch({ scheduled_change: { action: 'cancel', effective_at: (state.sub.current_billing_period as { ends_at: string }).ends_at, resume_at: null } });
      return json(state.sub);
    }
    if (method === 'PATCH' && url.pathname === `/subscriptions/${SUB_ID}`) {
      if ('scheduled_change' in b) touch({ scheduled_change: null });
      if (Array.isArray(b.items)) touch({ items: (b.items as { price_id: string }[]).map((i) => ({ price: { id: i.price_id }, status: 'active', quantity: 1 })) });
      return json(state.sub);
    }
    if (method === 'POST' && url.pathname === `/customers/${CUSTOMER_ID}/portal-sessions`) {
      return json({
        id: 'cpls_01test', customer_id: CUSTOMER_ID,
        urls: { general: { overview: 'https://portal.example.test/overview' }, subscriptions: [{ id: SUB_ID, view_subscription: 'https://portal.example.test/sub', cancel_subscription: 'https://portal.example.test/cancel', update_subscription_payment_method: 'https://portal.example.test/pay' }] },
      }, 201);
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { state, fn };
}

const make = (over: Partial<PaddleConfig> = {}) =>
  createPaddleProvider({ apiKey: API_KEY, clientToken: 'test_clienttoken', webhookSecret: SECRET, environment: 'sandbox', ...over });

/* ================================================================= adapter unit tests */

describe('Paddle adapter: provider selection and configuration', () => {
  afterEach(() => setBillingProviderForTests(undefined));

  it('is selected by server configuration only, and the webhook path must name it', () => {
    expect(getBillingProvider()?.name).toBe('mock'); // BILLING_PROVIDER=mock in the test environment
    setBillingProviderForTests(make());
    expect(resolveProvider('paddle')?.name).toBe('paddle');
    expect(resolveProvider('mock')).toBeNull();
    expect(resolveProvider('lemonsqueezy')).toBeNull();
  });

  it('reports itself unconfigured when a credential is missing', () => {
    expect(make({ apiKey: '' }).isConfigured()).toBe(false);
    expect(make({ clientToken: '' }).isConfigured()).toBe(false);
    expect(make({ webhookSecret: '' }).isConfigured()).toBe(false);
    setBillingProviderForTests(make({ webhookSecret: '' }));
    expect(resolveProvider('paddle')).toBeNull();
  });

  it('uses the sandbox or production API host according to the environment', async () => {
    for (const [environment, host] of [['sandbox', 'https://sandbox-api.paddle.com'], ['production', 'https://api.paddle.com']] as const) {
      const fake = createFakePaddle();
      fake.state.sub = entity();
      const spy = vi.fn(fake.fn);
      await make({ environment, fetchImpl: spy as typeof fetch }).retrieveSubscription(SUB_ID);
      expect(String(spy.mock.calls[0]![0])).toBe(`${host}/subscriptions/${SUB_ID}`);
    }
  });
});

describe('Paddle adapter: API operations', () => {
  it('creates a transaction with the price, custom data and bearer auth, and returns the checkout link', async () => {
    const fake = createFakePaddle();
    const out = await make({ fetchImpl: fake.fn }).createCheckout({ organizationId: 'org1', subscriptionRef: 'ref1', email: 'a@b.co', variantId: PRICE.proMonth, redirectUrl: 'https://x.test' });
    expect(out.url).toBe('https://app.example.test/app/settings/billing?_ptxn=txn_01test1');
    expect(out.providerCheckoutId).toBe('txn_01test1');
    expect(fake.state.calls[0]).toMatchObject({ method: 'POST', path: '/transactions', auth: `Bearer ${API_KEY}` });
    expect(fake.state.transactions[0]!.body).toEqual({
      items: [{ price_id: PRICE.proMonth, quantity: 1 }], collection_mode: 'automatic', custom_data: { organization_id: 'org1', subscription_ref: 'ref1' },
    });
    expect(JSON.stringify(fake.state.transactions[0])).not.toContain(API_KEY);
  });

  it('refuses a transaction without a checkout link, an insecure link in production, and malformed ids (before any request)', async () => {
    const noLink = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'txn_1', checkout: { url: null } } }), { status: 201 })) as unknown as typeof fetch;
    const input = { organizationId: 'o', subscriptionRef: 'r', email: 'a@b.co', variantId: PRICE.proMonth, redirectUrl: 'https://x.test' };
    await expect(make({ fetchImpl: noLink }).createCheckout(input)).rejects.toThrow(/default payment link/);

    const http = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'txn_1', checkout: { url: 'http://insecure.test/?_ptxn=txn_1' } } }), { status: 201 })) as unknown as typeof fetch;
    await expect(make({ environment: 'production', fetchImpl: http }).createCheckout(input)).rejects.toThrow(/insecure/);

    const never = vi.fn() as unknown as typeof fetch;
    await expect(make({ fetchImpl: never }).createCheckout({ ...input, variantId: '../prices' })).rejects.toBeInstanceOf(BillingProviderError);
    await expect(make({ fetchImpl: never }).retrieveSubscription('../../customers')).rejects.toBeInstanceOf(BillingProviderError);
    expect(never).not.toHaveBeenCalled();
  });

  it('retrieves and normalizes a subscription', async () => {
    const fake = createFakePaddle();
    fake.state.sub = entity();
    expect(await make({ fetchImpl: fake.fn }).retrieveSubscription(SUB_ID)).toMatchObject({
      providerSubscriptionId: SUB_ID, providerCustomerId: CUSTOMER_ID, providerVariantId: PRICE.proMonth, status: 'ACTIVE', cancelAtPeriodEnd: false,
    });
  });

  it('cancels at the end of the period, or immediately when the subscription is paused', async () => {
    const fake = createFakePaddle();
    fake.state.sub = entity();
    const p = make({ fetchImpl: fake.fn });
    const scheduled = await p.cancelSubscription(SUB_ID);
    expect(scheduled).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
    expect(fake.state.calls.at(-1)).toMatchObject({ method: 'POST', path: `/subscriptions/${SUB_ID}/cancel`, body: { effective_from: 'next_billing_period' } });

    fake.state.sub = entity({ status: 'paused', current_billing_period: null });
    const immediate = await p.cancelSubscription(SUB_ID);
    expect(fake.state.calls.at(-1)).toMatchObject({ body: { effective_from: 'immediately' } });
    expect(immediate.status).toBe('CANCELLED');
  });

  it('resumes by clearing the scheduled change, and changes plan with the complete item list', async () => {
    const fake = createFakePaddle();
    fake.state.sub = entity({ scheduled_change: { action: 'cancel', effective_at: iso(1e9) } });
    const p = make({ fetchImpl: fake.fn });
    expect((await p.resumeSubscription(SUB_ID)).cancelAtPeriodEnd).toBe(false);
    expect(fake.state.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { scheduled_change: null } });

    const changed = await p.changePlan(SUB_ID, PRICE.bizMonth);
    expect(changed.providerVariantId).toBe(PRICE.bizMonth);
    expect(fake.state.calls.at(-1)).toMatchObject({
      method: 'PATCH', body: { items: [{ price_id: PRICE.bizMonth, quantity: 1 }], proration_billing_mode: 'prorated_immediately', on_payment_failure: 'prevent_change' },
    });
  });

  it('creates a portal session for the subscription customer and prefers the subscription link', async () => {
    const fake = createFakePaddle();
    fake.state.sub = entity();
    expect(await make({ fetchImpl: fake.fn }).getPortalUrl(SUB_ID)).toBe('https://portal.example.test/sub');
    expect(fake.state.calls.at(-1)).toMatchObject({ method: 'POST', path: `/customers/${CUSTOMER_ID}/portal-sessions`, body: { subscription_ids: [SUB_ID] } });
  });

  it('turns HTTP and network failures into safe errors that never contain the key or the response body', async () => {
    const leaky = vi.fn(async () => new Response('{"error":{"detail":"secret-detail-xyz"}}', { status: 403 })) as unknown as typeof fetch;
    const err = await make({ fetchImpl: leaky }).retrieveSubscription(SUB_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect((err as BillingProviderError).status).toBe(403);
    expect((err as Error).message).not.toMatch(/secret-detail|pdl_/);

    const down = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(make({ fetchImpl: down }).retrieveSubscription(SUB_ID)).rejects.toThrow(/could not be reached/);
    const garbage = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(make({ fetchImpl: garbage }).retrieveSubscription(SUB_ID)).rejects.toThrow(/unreadable/);
  });
});

describe('Paddle adapter: webhook signature (raw bytes, HMAC-SHA256 of "ts:body")', () => {
  const NOW = 1_800_000_000;
  const p = make({ now: () => NOW * 1000, toleranceSeconds: 5 });
  const raw = hook('subscription.updated', entity(), 'evt_signature01');
  const check = (body: string | Buffer, sig: string | undefined) => p.verifySignature(Buffer.from(body), { 'paddle-signature': sig });

  it('accepts a correct signature, including a timestamp inside the tolerance', () => {
    expect(() => check(raw, header(raw, SECRET, NOW))).not.toThrow();
    expect(() => check(raw, header(raw, SECRET, NOW - 4))).not.toThrow();
  });
  it('rejects tampered bodies, re-serialized JSON, and the wrong secret', () => {
    expect(() => check(raw + ' ', header(raw, SECRET, NOW))).toThrow(InvalidSignatureError);
    expect(() => check(JSON.stringify(JSON.parse(raw), null, 2), header(raw, SECRET, NOW))).toThrow(InvalidSignatureError);
    expect(() => check(raw, header(raw, 'pdl_ntfset_other', NOW))).toThrow(InvalidSignatureError);
  });
  it('rejects a stale or future timestamp, unless the check is disabled', () => {
    expect(() => check(raw, header(raw, SECRET, NOW - 10))).toThrow(InvalidSignatureError);
    expect(() => check(raw, header(raw, SECRET, NOW + 10))).toThrow(InvalidSignatureError);
    const off = make({ now: () => NOW * 1000, toleranceSeconds: 0 });
    expect(() => off.verifySignature(Buffer.from(raw), { 'paddle-signature': header(raw, SECRET, NOW - 100_000) })).not.toThrow(); // signature still verified
  });
  it('accepts a rotated header with several h1 values when one is valid, and rejects when none is', () => {
    const good = header(raw, SECRET, NOW).split('h1=')[1]!;
    const bad = 'f'.repeat(64);
    expect(() => check(raw, `ts=${NOW};h1=${bad};h1=${good}`)).not.toThrow();
    expect(() => check(raw, `ts=${NOW};h1=${bad};h1=${'e'.repeat(64)}`)).toThrow(InvalidSignatureError);
  });
  it('rejects a missing or malformed header', () => {
    const good = header(raw, SECRET, NOW).split('h1=')[1]!;
    const many = `ts=${NOW};${Array.from({ length: 7 }, () => `h1=${good}`).join(';')}`;
    for (const bad of [undefined, '', 'garbage', `ts=${NOW}`, `h1=${good}`, `ts=abc;h1=${good}`, `ts=${NOW};h1=zz`, `ts=${NOW};h1=${good.slice(0, 10)}`, many]) {
      expect(() => check(raw, bad)).toThrow(InvalidSignatureError);
    }
  });
});

describe('Paddle adapter: webhook parsing and state normalization', () => {
  const p = make();
  it('parses subscription events using the real event id', () => {
    for (const type of ['subscription.created', 'subscription.updated', 'subscription.canceled']) {
      expect(p.parseWebhook(Buffer.from(hook(type, entity(), 'evt_01parse'))))
        .toMatchObject({ kind: 'subscription', eventId: 'evt_01parse', eventType: type, subscription: { providerSubscriptionId: SUB_ID } });
    }
  });
  it('acknowledges unknown and unused events without touching their data', () => {
    for (const type of ['customer.updated', 'transaction.completed', 'adjustment.created', 'something.new']) {
      expect(p.parseWebhook(Buffer.from(hook(type, { anything: true })))).toMatchObject({ kind: 'other', eventType: type });
    }
  });
  it('rejects malformed envelopes, multi-item subscriptions and unknown statuses', () => {
    expect(() => p.parseWebhook(Buffer.from('not json'))).toThrow();
    expect(() => p.parseWebhook(Buffer.from(JSON.stringify({ event_type: 'subscription.updated', data: entity() })))).toThrow(); // no event_id
    const two = [{ price: { id: PRICE.proMonth } }, { price: { id: PRICE.bizMonth } }];
    expect(() => p.parseWebhook(Buffer.from(hook('subscription.updated', entity({ items: two }))))).toThrow(/more than one item/);
    expect(() => normalizeSubscription(entity({ status: 'exploded' }))).toThrow(/Unknown subscription status/);
    expect(() => normalizeSubscription(entity({ status: 'constructor' }))).toThrow(/Unknown subscription status/); // never matches a prototype key
  });
  it('maps every Paddle status', () => {
    expect(PADDLE_STATUS_MAP).toEqual({ active: 'ACTIVE', trialing: 'TRIALING', past_due: 'PAST_DUE', paused: 'PAUSED', canceled: 'CANCELLED' });
    for (const [paddle, internal] of Object.entries(PADDLE_STATUS_MAP)) expect(normalizeSubscription(entity({ status: paddle })).status).toBe(internal);
  });
  it('treats a scheduled cancel as active-until-period-end, and a canceled subscription as ended at canceled_at', () => {
    const ends = iso(10 * 86_400_000);
    expect(normalizeSubscription(entity({ scheduled_change: { action: 'cancel', effective_at: ends }, current_billing_period: { starts_at: iso(-1000), ends_at: ends } })))
      .toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(ends) });
    const canceledAt = iso(-5000);
    const ended = normalizeSubscription(entity({ status: 'canceled', canceled_at: canceledAt, current_billing_period: null, next_billed_at: null }));
    expect(ended).toMatchObject({ status: 'CANCELLED', currentPeriodEnd: new Date(canceledAt) }); // never a stale future date
  });
  it('reads the trial end from the item and tolerates a paused subscription with no billing period', () => {
    const trialEnd = iso(14 * 86_400_000);
    expect(normalizeSubscription(entity({ status: 'trialing', items: [{ price: { id: PRICE.proMonth }, status: 'trialing', trial_dates: { starts_at: iso(0), ends_at: trialEnd } }] })))
      .toMatchObject({ status: 'TRIALING', trialEnd: new Date(trialEnd) });
    expect(normalizeSubscription(entity({ status: 'paused', current_billing_period: null, next_billed_at: null }))).toMatchObject({ status: 'PAUSED', currentPeriodEnd: null });
  });
});

/* ================================================================= end-to-end through the real routes */

const FREE = { name: 'Free', slug: 'free', isFallback: true, sortOrder: 0, features: { analytics: false }, limits: { members: 5, leads: 2, properties: 5, deals: 5, automationExecutionsPerMonth: 0, storageBytes: 1e9 } };
const planOf = (slug: string, name: string, sortOrder: number, prices: { interval: string; amount: number; id: string }[]) => ({
  name, slug, sortOrder, features: { analytics: true, automations: true }, limits: { members: 10, leads: null, properties: null, deals: null, automationExecutionsPerMonth: 100, storageBytes: null },
  prices: prices.map((x) => ({ interval: x.interval, amount: x.amount, currency: 'USD', variants: [{ provider: 'paddle', variantId: x.id }] })),
});

describe('Paddle end to end (fake Paddle API, signed webhooks)', () => {
  let fake: ReturnType<typeof createFakePaddle>;

  beforeEach(async () => {
    fake = createFakePaddle();
    setBillingProviderForTests(make({ fetchImpl: fake.fn }));
    await Plan.create([
      FREE,
      planOf('pro', 'Pro', 1, [{ interval: 'MONTH', amount: 4900, id: PRICE.proMonth }, { interval: 'YEAR', amount: 49000, id: PRICE.proYear }]),
      planOf('biz', 'Business', 2, [{ interval: 'MONTH', amount: 14900, id: PRICE.bizMonth }]),
    ]);
  });
  afterEach(() => { vi.restoreAllMocks(); setBillingProviderForTests(undefined); });

  async function org() {
    const ctx = await setupOrg();
    const checkout = await ctx.api.post('/billing/checkout', { planSlug: 'pro', interval: 'MONTH' });
    expect(checkout.status).toBe(200);
    const customData = (fake.state.transactions[0]!.body as { custom_data: Record<string, unknown> }).custom_data;
    return { ...ctx, checkout: checkout.body.data as { url: string; subscriptionId: string }, customData };
  }
  type Ctx = Awaited<ReturnType<typeof org>>;
  /** Paddle's subscription.created, carrying the custom data it copied from the transaction. */
  async function activate(c: Ctx, over: Entity = {}) {
    fake.state.sub = entity({ custom_data: c.customData, updated_at: iso(0), ...over });
    const res = await send(hook('subscription.created', fake.state.sub));
    expect(res.status).toBe(200);
  }
  const sub = (c: Ctx) => Subscription.findById(c.checkout.subscriptionId);

  it('checkout sends the mapped price and organization references, and grants nothing until a verified event', async () => {
    const c = await org();
    expect(fake.state.transactions[0]!.body).toMatchObject({
      items: [{ price_id: PRICE.proMonth, quantity: 1 }], custom_data: { organization_id: c.org, subscription_ref: c.checkout.subscriptionId },
    });
    expect(c.checkout.url).toContain('_ptxn=txn_01test1');
    const overview = (await c.api.get('/billing/subscription')).body.data;
    expect(overview.onboarding.state).toBe('CHECKOUT_PENDING');
    expect(overview.checkoutConfig).toMatchObject({ provider: 'paddle', environment: 'sandbox' });
    expect(overview.entitlements.source).toBe('FALLBACK');
  });

  it('a verified subscription.created activates the plan and stores the Paddle event id', async () => {
    const c = await org();
    fake.state.sub = entity({ custom_data: c.customData });
    await send(hook('subscription.created', fake.state.sub, 'evt_01activate'));
    expect(await sub(c)).toMatchObject({ status: 'ACTIVE', planSlug: 'pro', providerSubscriptionId: SUB_ID, providerCustomerId: CUSTOMER_ID });
    expect(await BillingEvent.findOne({ providerEventId: 'evt_01activate' })).toMatchObject({ provider: 'paddle', eventType: 'subscription.created', processingStatus: 'PROCESSED' });
    expect((await getOrganizationEntitlements(c.org)).features.analytics).toBe(true);
  });

  it('rejects bad signatures and stale timestamps, and stores nothing', async () => {
    const c = await org();
    fake.state.sub = entity({ custom_data: c.customData });
    const raw = hook('subscription.created', fake.state.sub);
    expect((await send(raw, header(raw, 'pdl_ntfset_wrong'))).status).toBe(401);
    expect((await send(raw + ' ')).status).toBe(401); // body changed after signing
    expect((await send(raw, header(raw, SECRET, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401); // valid signature, stale timestamp
    expect((await send(raw, 'nonsense')).status).toBe(401);
    expect((await send(raw, header(raw), 'mock')).status).toBe(404);
    expect(await BillingEvent.countDocuments({})).toBe(0);
    expect((await sub(c))!.status).toBe('INCOMPLETE');
  });

  it('duplicate and concurrent deliveries of one event are processed once', async () => {
    const c = await org();
    fake.state.sub = entity({ custom_data: c.customData });
    const raw = hook('subscription.created', fake.state.sub, 'evt_01dup');
    const results = await Promise.all(Array.from({ length: 5 }, () => send(raw)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await send(raw)).status).toBe(200);
    expect(await BillingEvent.countDocuments({})).toBe(1);
    expect(await BillingEvent.countDocuments({ processingStatus: 'PROCESSED' })).toBe(1);
    expect(await Subscription.countDocuments({ organizationId: c.org })).toBe(1);
  });

  it('acknowledges unknown events with no payload kept; a redelivery changes nothing', async () => {
    const raw = hook('customer.updated', { id: CUSTOMER_ID }, 'evt_01unknown');
    expect((await send(raw)).status).toBe(200);
    expect((await send(raw)).status).toBe(200);
    const stored = await BillingEvent.findOne({}).select('+payload').lean();
    expect(await BillingEvent.countDocuments({})).toBe(1);
    expect(stored).toMatchObject({ processingStatus: 'SKIPPED', eventType: 'customer.updated' });
    expect(stored!.payload).toBeUndefined();
  });

  it('an older event never overwrites newer state', async () => {
    const c = await org();
    await activate(c, { updated_at: iso(-60_000) });
    await send(hook('subscription.past_due', entity({ status: 'past_due', custom_data: c.customData, updated_at: iso(-10_000) })));
    expect((await send(hook('subscription.updated', entity({ status: 'active', custom_data: c.customData, updated_at: iso(-30_000) })))).status).toBe(200);
    expect((await sub(c))!.status).toBe('PAST_DUE');
    expect(await BillingEvent.findOne({ errorSummary: /newer state/ })).not.toBeNull();
    const overview = (await c.api.get('/billing/subscription')).body.data;
    expect(overview.onboarding.state).toBe('PAYMENT_FAILED');
    expect(overview.entitlements.source).toBe('SUBSCRIPTION'); // access continues while Paddle retries payment
  });

  it('an immediate cancellation removes access at once, even though the old period end is still in the future', async () => {
    const c = await org();
    await activate(c, { updated_at: iso(-20_000) });
    expect((await getOrganizationEntitlements(c.org)).source).toBe('SUBSCRIPTION');
    const canceled = entity({ status: 'canceled', canceled_at: iso(-1000), current_billing_period: null, next_billed_at: null, custom_data: c.customData, updated_at: iso(-5000) });
    await send(hook('subscription.canceled', canceled));
    expect((await sub(c))!.status).toBe('CANCELLED');
    expect((await getOrganizationEntitlements(c.org)).source).toBe('FALLBACK');
  });

  it('records trialing subscriptions and grants access during the trial', async () => {
    const c = await org();
    const trialEnd = iso(14 * 86_400_000);
    await activate(c, { status: 'trialing', items: [{ price: { id: PRICE.proMonth }, status: 'trialing', trial_dates: { starts_at: iso(0), ends_at: trialEnd } }] });
    expect(await sub(c)).toMatchObject({ status: 'TRIALING', trialEnd: new Date(trialEnd) });
    expect((await getOrganizationEntitlements(c.org)).source).toBe('SUBSCRIPTION');
  });

  it('a failed event is not marked processed, answers non-2xx, and succeeds when Paddle redelivers', async () => {
    const c = await org();
    fake.state.sub = entity({ custom_data: c.customData, items: [{ price: { id: 'pri_unmapped0001' } }] });
    const raw = hook('subscription.created', fake.state.sub, 'evt_01retry');
    expect((await send(raw)).status).toBeGreaterThanOrEqual(500);
    expect(await BillingEvent.findOne({ providerEventId: 'evt_01retry' })).toMatchObject({ processingStatus: 'FAILED', attempts: 1 });
    expect((await sub(c))!.status).toBe('INCOMPLETE');

    await Plan.updateOne({ slug: 'pro', 'prices.interval': 'MONTH' }, { $push: { 'prices.$.variants': { provider: 'paddle', variantId: 'pri_unmapped0001' } } });
    expect((await send(raw)).status).toBe(200); // Paddle signs the redelivery afresh
    expect(await BillingEvent.countDocuments({})).toBe(1);
    expect(await BillingEvent.findOne({})).toMatchObject({ processingStatus: 'PROCESSED', attempts: 2 });
    expect((await sub(c))!.status).toBe('ACTIVE');
  });

  it('a database failure while applying never marks the event processed', async () => {
    const c = await org();
    fake.state.sub = entity({ custom_data: c.customData });
    const raw = hook('subscription.created', fake.state.sub, 'evt_01dbdown');
    const spy = vi.spyOn(Subscription, 'findOneAndUpdate').mockRejectedValueOnce(new Error('db down'));
    expect((await send(raw)).status).toBe(500);
    spy.mockRestore();
    expect(await BillingEvent.findOne({})).toMatchObject({ processingStatus: 'FAILED', errorSummary: 'db down' });
    expect((await sub(c))!.status).toBe('INCOMPLETE');
    expect((await send(raw)).status).toBe(200);
    expect((await sub(c))!.status).toBe('ACTIVE');
  });

  it('schedules a cancel through the API, is idempotent, and resume clears it', async () => {
    const c = await org();
    await activate(c);
    const first = await c.api.post('/billing/cancel');
    expect(first.body.data.subscription).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true, canResume: true });
    expect(first.body.data.onboarding.state).toBe('CANCELLING');
    expect((await getOrganizationEntitlements(c.org)).source).toBe('SUBSCRIPTION');
    const cancelCalls = () => fake.state.calls.filter((x) => x.path.endsWith('/cancel')).length;
    expect(cancelCalls()).toBe(1);
    await c.api.post('/billing/cancel');
    expect(cancelCalls()).toBe(1); // already scheduled: no second provider call

    const resumed = await c.api.post('/billing/resume');
    expect(resumed.body.data.subscription).toMatchObject({ cancelAtPeriodEnd: false, canResume: false });
    expect(fake.state.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { scheduled_change: null } });
  });

  it('once Paddle reports the subscription canceled it cannot be resumed', async () => {
    const c = await org();
    await activate(c, { updated_at: iso(-20_000) });
    await send(hook('subscription.canceled', entity({ status: 'canceled', canceled_at: iso(-1000), current_billing_period: null, next_billed_at: null, custom_data: c.customData, updated_at: iso(-5000) })));
    const res = await c.api.post('/billing/resume');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SUBSCRIPTION_ENDED');
  });

  it('changes plan with the full item list, then ignores a repeat; a past-due subscription must fix payment first', async () => {
    const c = await org();
    await activate(c);
    const changed = await c.api.post('/billing/change-plan', { planSlug: 'biz', interval: 'MONTH' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.entitlements.planSlug).toBe('biz');
    expect(fake.state.calls.filter((x) => x.method === 'PATCH').at(-1)).toMatchObject({ body: { items: [{ price_id: PRICE.bizMonth, quantity: 1 }], proration_billing_mode: 'prorated_immediately' } });
    const patches = () => fake.state.calls.filter((x) => x.method === 'PATCH').length;
    const before = patches();
    await c.api.post('/billing/change-plan', { planSlug: 'biz', interval: 'MONTH' });
    expect(patches()).toBe(before);

    await Subscription.updateOne({ organizationId: c.org }, { $set: { status: 'PAST_DUE' } });
    expect((await c.api.post('/billing/change-plan', { planSlug: 'pro', interval: 'YEAR' })).body.code).toBe('PLAN_CHANGE_NOT_ALLOWED');
  });

  it('maps a Paddle rejection to a clean conflict and a Paddle outage to a 502, without leaking details', async () => {
    const c = await org();
    await activate(c);
    fake.state.failNext = 409;
    const rejected = await c.api.post('/billing/cancel');
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('BILLING_CHANGE_REJECTED');
    fake.state.failNext = 500;
    const outage = await c.api.post('/billing/cancel');
    expect(outage.status).toBe(502);
    expect(JSON.stringify(outage.body)).not.toMatch(/pdl_|sub_01/);
  });

  it('returns a temporary portal link for the customer', async () => {
    const c = await org();
    await activate(c);
    expect((await c.api.post('/billing/portal')).body.data.url).toBe('https://portal.example.test/sub');
  });

  it('keeps organizations apart: another org cannot activate, see, or manage this subscription', async () => {
    const a = await org();
    const b = await setupOrg();
    fake.state.sub = entity({ custom_data: { organization_id: b.org, subscription_ref: a.checkout.subscriptionId } });
    await send(hook('subscription.created', fake.state.sub));
    expect((await sub(a))!.status).toBe('INCOMPLETE');
    expect((await getOrganizationEntitlements(b.org)).source).toBe('FALLBACK');
    expect((await b.api.get('/billing/subscription')).body.data.subscription).toBeNull();
    expect((await b.api.post('/billing/cancel')).status).toBe(404);
    expect((await b.api.post('/billing/resume')).status).toBe(404);
  });

  it('only billing:manage can change billing', async () => {
    const c = await org();
    await activate(c);
    const admin = await memberOf(c.org, 'ADMIN');
    for (const path of ['/billing/cancel', '/billing/resume', '/billing/portal']) expect((await admin.api.post(path)).status).toBe(403);
    expect((await admin.api.post('/billing/change-plan', { planSlug: 'biz', interval: 'MONTH' })).status).toBe(403);
  });

  it('the existing limit and feature behaviour still applies after a Paddle activation', async () => {
    const c = await org();
    expect((await c.api.get('/analytics/overview')).body.code).toBe('FEATURE_NOT_AVAILABLE'); // needs the requireFeature wiring
    await activate(c);
    expect((await c.api.get('/analytics/overview')).status).toBe(200);
  });
});