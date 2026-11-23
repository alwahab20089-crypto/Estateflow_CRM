import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '../../../constants';
import {
  BillingProviderError,
  InvalidSignatureError,
  type BillingProvider,
  type NormalizedSubscription,
  type ParsedWebhook,
} from './billing-provider';

/*
 * Development/test only (blocked in production by env validation). No network, no credentials, no real payments.
 * It is independent of every real provider: its own state, its own signature scheme and its own neutral event format.
 * Passing tests against this mock prove EstateFlow's own logic. They do NOT prove that any real provider works.
 */

export const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret-not-for-production';
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';
export const signMockBody = (body: string | Buffer, secret = MOCK_WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');

/** Tests read and write this to simulate what the provider would answer. */
export const mockProviderStore = {
  subscriptions: new Map<string, NormalizedSubscription>(),
  checkouts: [] as { organizationId: string; subscriptionRef: string; variantId: string; email: string }[],
  reset() {
    this.subscriptions.clear();
    this.checkouts.length = 0;
  },
};

/* ----------------------------------------------------------------- test builders */

export function defaultMockSubscription(over: Partial<NormalizedSubscription> = {}): NormalizedSubscription {
  const now = new Date();
  return {
    providerSubscriptionId: 'sub_1',
    providerCustomerId: 'cus_1',
    providerVariantId: '111',
    status: 'ACTIVE',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
    customData: {},
    ...over,
  };
}

/** A signed-body helper for tests: reuse the same `id` to simulate a redelivery. */
export const mockSubscriptionEvent = (o: { id?: string; type?: string; subscription?: Partial<NormalizedSubscription> } = {}) =>
  JSON.stringify({ id: o.id ?? `mevt_${randomUUID()}`, type: o.type ?? 'subscription.updated', subscription: defaultMockSubscription(o.subscription) });

export const mockInvoiceEvent = (o: { id?: string; type?: 'payment.failed' | 'payment.paid'; subscriptionId?: string; occurredAt?: Date } = {}) =>
  JSON.stringify({
    id: o.id ?? `mevt_${randomUUID()}`,
    type: o.type ?? 'payment.failed',
    invoice: { subscriptionId: o.subscriptionId ?? 'sub_1', occurredAt: (o.occurredAt ?? new Date()).toISOString() },
  });

export const mockOtherEvent = (type = 'customer.updated', id = `mevt_${randomUUID()}`) => JSON.stringify({ id, type });

/* ----------------------------------------------------------------- wire format */

const date = z.string().transform((v, ctx) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'invalid date' });
    return z.NEVER;
  }
  return d;
});
const optionalDate = date.nullish().transform((v) => v ?? null);

const wireSubscription = z.object({
  providerSubscriptionId: z.string().min(1),
  providerCustomerId: z.string().min(1),
  providerVariantId: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
  currentPeriodStart: optionalDate,
  currentPeriodEnd: optionalDate,
  trialEnd: optionalDate,
  cancelAtPeriodEnd: z.boolean().default(false),
  createdAt: optionalDate,
  updatedAt: date,
  customData: z.record(z.string(), z.unknown()).default({}),
});
const wireEvent = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  subscription: wireSubscription.optional(),
  invoice: z
    .object({ subscriptionId: z.string().min(1), occurredAt: date, customData: z.record(z.string(), z.unknown()).default({}) })
    .optional(),
});

/* ----------------------------------------------------------------- provider */

export function createMockBillingProvider(): BillingProvider {
  const get = (id: string) => {
    const sub = mockProviderStore.subscriptions.get(id);
    if (!sub) throw new BillingProviderError('The billing provider returned 404', 404);
    return sub;
  };
  /** Every change moves updatedAt strictly forward, like a real provider's entity version. */
  const touch = (sub: NormalizedSubscription, change: Partial<NormalizedSubscription>): NormalizedSubscription => {
    const next = { ...sub, ...change, updatedAt: new Date(Math.max(Date.now(), sub.updatedAt.getTime() + 1)) };
    mockProviderStore.subscriptions.set(sub.providerSubscriptionId, next);
    return next;
  };

  return {
    name: 'mock',
    isConfigured: () => true,

    async createCheckout(i) {
      mockProviderStore.checkouts.push({ organizationId: i.organizationId, subscriptionRef: i.subscriptionRef, variantId: i.variantId, email: i.email });
      const n = mockProviderStore.checkouts.length;
      return { url: `https://mock-checkout.invalid/c/${n}`, providerCheckoutId: `chk_${n}`, expiresAt: new Date(Date.now() + 86_400_000) };
    },

    async retrieveSubscription(id) {
      return get(id);
    },

    // Like a real "cancel at period end": the subscription keeps running and is flagged. A paused one ends immediately.
    async cancelSubscription(id) {
      const sub = get(id);
      return touch(sub, sub.status === 'PAUSED' ? { status: 'CANCELLED', cancelAtPeriodEnd: false, currentPeriodEnd: new Date() } : { cancelAtPeriodEnd: true });
    },

    async resumeSubscription(id) {
      const sub = get(id);
      if (sub.status === 'CANCELLED') throw new BillingProviderError('The billing provider returned 409', 409);
      return touch(sub, { cancelAtPeriodEnd: false });
    },

    async changePlan(id, variantId) {
      const sub = get(id);
      if (sub.status === 'PAST_DUE' || sub.status === 'CANCELLED') throw new BillingProviderError('The billing provider returned 409', 409);
      return touch(sub, { providerVariantId: variantId });
    },

    async getPortalUrl(id) {
      get(id);
      return `https://mock-portal.invalid/p/${id}`;
    },

    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders) {
      const header = headers[MOCK_SIGNATURE_HEADER];
      if (typeof header !== 'string' || !/^[0-9a-f]{64}$/i.test(header)) throw new InvalidSignatureError();
      const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest();
      const given = Buffer.from(header, 'hex');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InvalidSignatureError();
    },

    parseWebhook(rawBody: Buffer): ParsedWebhook {
      const e = wireEvent.parse(JSON.parse(rawBody.toString('utf8')));
      if (e.type.startsWith('subscription.')) {
        if (!e.subscription) throw new Error('subscription event without a subscription');
        return { kind: 'subscription', eventId: e.id, eventType: e.type, subscription: e.subscription };
      }
      if (e.type === 'payment.failed' || e.type === 'payment.paid') {
        if (!e.invoice) throw new Error('payment event without an invoice');
        return {
          kind: 'invoice', eventId: e.id, eventType: e.type, providerSubscriptionId: e.invoice.subscriptionId,
          outcome: e.type === 'payment.failed' ? 'FAILED' : 'PAID', occurredAt: e.invoice.occurredAt, customData: e.invoice.customData,
        };
      }
      return { kind: 'other', eventId: e.id, eventType: e.type };
    },
  };
}