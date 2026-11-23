import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import type { SubscriptionStatus } from '../../../constants';
import {
  BillingProviderError,
  InvalidSignatureError,
  type BillingProvider,
  type NormalizedSubscription,
  type ParsedWebhook,
} from './billing-provider';

/*
 * Paddle Billing (NOT Paddle Classic). Verified against developer.paddle.com:
 *  - Auth:        Authorization: Bearer <api key>; sandbox keys contain "_sdbx" (api-reference/about/authentication)
 *  - Base URLs:   https://sandbox-api.paddle.com and https://api.paddle.com (sdks/sandbox)
 *  - Checkout:    POST /transactions with items[{price_id, quantity}] and custom_data; response carries checkout.url,
 *                 which is OUR default payment link + ?_ptxn=<transaction id>. The page behind it must run Paddle.js
 *                 (api-reference/transactions/create-transaction, build/transactions/pass-transaction-checkout)
 *  - custom_data on a transaction is copied to the subscription Paddle creates (build/transactions/custom-data)
 *  - Cancel:      POST /subscriptions/{id}/cancel { effective_from: next_billing_period | immediately };
 *                 paused subscriptions can only be cancelled immediately (api-reference/subscriptions/cancel-subscription)
 *  - Resume:      PATCH /subscriptions/{id} { scheduled_change: null } removes a scheduled cancel (build/subscriptions/cancel-subscriptions)
 *  - Plan change: PATCH /subscriptions/{id} { items: [full list], proration_billing_mode } (api-reference/subscriptions/update-subscription)
 *  - Portal:      POST /customers/{customer_id}/portal-sessions { subscription_ids } (api-reference/customer-portals/...)
 *  - Webhooks:    Paddle-Signature: ts=<unix>;h1=<hex>; HMAC-SHA256 over `${ts}:${rawBody}` (webhooks/signature-verification)
 *
 * NOT documented on the pages used, so deliberately not implemented: the Paddle-Version header, the error-body shape,
 * and the behaviour of cancelling a *trialing* subscription (the request is sent as-is and Paddle's answer is surfaced).
 */

export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddleConfig {
  apiKey: string;
  /** Public client-side token. Only used by the browser (served through the API), kept here so isConfigured() is truthful. */
  clientToken: string;
  /** Notification destination secret key (pdl_ntfset_...). */
  webhookSecret: string;
  environment: PaddleEnvironment;
  /** Max |now - ts| accepted for a webhook, in seconds. 0 disables the check. Default 60. */
  toleranceSeconds?: number;
  baseUrl?: string;
  /** Injected in tests so no network is ever used. */
  fetchImpl?: typeof fetch;
  /** Injected in tests for deterministic timestamp checks. */
  now?: () => number;
}

const BASE_URLS: Record<PaddleEnvironment, string> = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
};
const REQUEST_TIMEOUT_MS = 10_000;

/** Paddle status -> internal status. Paddle only reports these five; anything else throws and never grants access. */
export const PADDLE_STATUS_MAP: Readonly<Record<string, SubscriptionStatus>> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  paused: 'PAUSED',
  canceled: 'CANCELLED',
};

/**
 * Events whose `data` is a subscription entity and are applied through the shared, ordered, idempotent path.
 * Paddle documents subscription.created and subscription.updated as the core pair ("updated covers them all"); the
 * others carry the same entity and are accepted so a state change is never missed. Everything else is acknowledged and skipped.
 */
export const PADDLE_SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.trialing',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.canceled',
]);

/* ----------------------------------------------------------------- schemas */

const datetime = z.string().transform((v, ctx) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'invalid datetime' });
    return z.NEVER;
  }
  return d;
});
const optionalDatetime = datetime.nullish().transform((v) => v ?? null);

const subscriptionEntity = z
  .object({
    id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
    status: z.string(),
    customer_id: z.string().regex(/^ctm_[A-Za-z0-9]+$/),
    items: z.array(
      z
        .object({
          price: z.object({ id: z.string().regex(/^pri_[A-Za-z0-9]+$/) }).passthrough(),
          trial_dates: z.object({ ends_at: optionalDatetime }).passthrough().nullish(),
        })
        .passthrough(),
    ),
    current_billing_period: z.object({ starts_at: datetime, ends_at: datetime }).passthrough().nullish(),
    scheduled_change: z.object({ action: z.string() }).passthrough().nullish(),
    custom_data: z.record(z.string(), z.unknown()).nullish(),
    next_billed_at: optionalDatetime,
    canceled_at: optionalDatetime,
    created_at: optionalDatetime,
    started_at: optionalDatetime,
    updated_at: datetime,
  })
  .passthrough();

const subscriptionResponse = z.object({ data: subscriptionEntity });
const transactionResponse = z.object({
  data: z
    .object({
      id: z.string().min(1),
      checkout: z.object({ url: z.string().nullish() }).passthrough().nullish(),
    })
    .passthrough(),
});
const portalResponse = z.object({
  data: z.object({
    urls: z.object({
      general: z.object({ overview: z.string() }).passthrough(),
      subscriptions: z.array(z.object({ id: z.string(), view_subscription: z.string().optional() }).passthrough()).default([]),
    }),
  }),
});
const webhookEnvelope = z.object({
  event_id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
  event_type: z.string().min(1).max(100),
  occurred_at: datetime,
  data: z.unknown(),
});

/* ----------------------------------------------------------------- normalization */

/** Converts a Paddle subscription entity (from the API or from a webhook) into the provider-neutral shape. */
export function normalizeSubscription(resource: unknown): NormalizedSubscription {
  const parsed = subscriptionEntity.safeParse(resource);
  if (!parsed.success) throw new BillingProviderError('The billing provider returned an unexpected subscription');
  const s = parsed.data;

  if (!Object.prototype.hasOwnProperty.call(PADDLE_STATUS_MAP, s.status)) throw new BillingProviderError(`Unknown subscription status "${s.status}"`);
  const status = PADDLE_STATUS_MAP[s.status]!;

  // One plan = one recurring price. Anything else cannot be mapped to a single entitlement, so it fails loudly.
  const [item] = s.items;
  if (s.items.length !== 1 || !item) throw new BillingProviderError('Subscriptions with more than one item are not supported');

  const period = s.current_billing_period;
  // A canceled subscription has no billing period, so access ended when it was cancelled. Using canceled_at here
  // (never a stale earlier end date) is what stops an immediate cancel from keeping entitlements until the old period end.
  const currentPeriodEnd = status === 'CANCELLED' ? s.canceled_at ?? s.updated_at : period?.ends_at ?? s.next_billed_at ?? null;

  return {
    providerSubscriptionId: s.id,
    providerCustomerId: s.customer_id,
    providerVariantId: item.price.id, // "variant" in the neutral interface = the Paddle price id (pri_...)
    status,
    currentPeriodStart: period?.starts_at ?? null,
    currentPeriodEnd,
    trialEnd: item.trial_dates?.ends_at ?? null,
    cancelAtPeriodEnd: s.scheduled_change?.action === 'cancel',
    createdAt: s.started_at ?? s.created_at ?? null,
    updatedAt: s.updated_at, // the entity's own version time: orders API responses and webhooks consistently
    customData: s.custom_data ?? {},
  };
}

/* ----------------------------------------------------------------- signature */

export function parsePaddleSignatureHeader(header: string): { ts: string; signatures: string[] } | null {
  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) return null;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') signatures.push(value);
  }
  // More than one h1 is legitimate during secret rotation; the cap only bounds the work an attacker can force.
  if (!ts || !/^\d{1,15}$/.test(ts) || signatures.length === 0 || signatures.length > 5) return null;
  return { ts, signatures };
}

/* ----------------------------------------------------------------- adapter */

const idPattern = /^[A-Za-z0-9_]{1,64}$/;
const providerId = (prefix: string, value: string) => {
  if (!idPattern.test(value) || !value.startsWith(prefix)) throw new BillingProviderError('Invalid billing identifier');
  return value;
};

export function createPaddleProvider(cfg: PaddleConfig): BillingProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl ?? BASE_URLS[cfg.environment];
  const now = cfg.now ?? Date.now;
  const tolerance = cfg.toleranceSeconds ?? 60;

  async function call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BillingProviderError('The billing provider could not be reached');
    }
    // The response body is never copied into an error: it may echo identifiers, and the key must never appear anywhere.
    if (!res.ok) throw new BillingProviderError(`The billing provider returned ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new BillingProviderError('The billing provider returned an unreadable response');
    }
  }

  const readSubscription = (raw: unknown) => {
    const parsed = subscriptionResponse.safeParse(raw);
    if (!parsed.success) throw new BillingProviderError('The billing provider returned an unexpected subscription');
    return normalizeSubscription(parsed.data.data);
  };
  const subscriptionPath = (subId: string) => `/subscriptions/${providerId('sub_', subId)}`;

  const retrieve = async (subId: string) => readSubscription(await call('GET', subscriptionPath(subId)));

  return {
    name: 'paddle',
    isConfigured: () => Boolean(cfg.apiKey && cfg.clientToken && cfg.webhookSecret),

    async createCheckout(i) {
      // No Paddle customer is pre-created: the checkout collects the email. `i.email` and `i.redirectUrl` are therefore
      // not sent here; the web page passes them to Paddle.js. custom_data is copied to the subscription Paddle creates.
      const raw = await call('POST', '/transactions', {
        items: [{ price_id: providerId('pri_', i.variantId), quantity: 1 }],
        collection_mode: 'automatic',
        custom_data: { organization_id: i.organizationId, subscription_ref: i.subscriptionRef },
      });
      const parsed = transactionResponse.safeParse(raw);
      if (!parsed.success) throw new BillingProviderError('The billing provider returned an unexpected checkout');
      const url = parsed.data.data.checkout?.url;
      if (!url) {
        throw new BillingProviderError('The transaction has no checkout link. Check that a default payment link is approved in the Paddle dashboard.');
      }
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new BillingProviderError('The billing provider returned an invalid checkout link');
      }
      if (target.protocol !== 'https:' && !(target.protocol === 'http:' && cfg.environment === 'sandbox')) {
        throw new BillingProviderError('The billing provider returned an insecure checkout link');
      }
      return { url: target.toString(), providerCheckoutId: parsed.data.data.id };
    },

    retrieveSubscription: retrieve,

    async cancelSubscription(subId) {
      // A paused subscription can only be cancelled immediately; everything else cancels at the end of the paid period.
      const current = await retrieve(subId);
      const effective_from = current.status === 'PAUSED' ? 'immediately' : 'next_billing_period';
      return readSubscription(await call('POST', `${subscriptionPath(subId)}/cancel`, { effective_from }));
    },

    /** Removes a scheduled cancellation. A subscription that is already canceled cannot be reinstated: it needs a new checkout. */
    async resumeSubscription(subId) {
      return readSubscription(await call('PATCH', subscriptionPath(subId), { scheduled_change: null }));
    },

    async changePlan(subId, variantId) {
      return readSubscription(
        await call('PATCH', subscriptionPath(subId), {
          items: [{ price_id: providerId('pri_', variantId), quantity: 1 }], // the COMPLETE item list: omitted items are removed
          proration_billing_mode: 'prorated_immediately',
          on_payment_failure: 'prevent_change', // the documented default, stated so a payment failure never applies the change
        }),
      );
    },

    async getPortalUrl(subId) {
      const sub = await retrieve(subId); // the portal session is per customer
      const raw = await call('POST', `/customers/${providerId('ctm_', sub.providerCustomerId)}/portal-sessions`, { subscription_ids: [sub.providerSubscriptionId] });
      const parsed = portalResponse.safeParse(raw);
      if (!parsed.success) throw new BillingProviderError('The billing provider returned an unexpected portal session');
      const { urls } = parsed.data.data;
      // Links are temporary: generated per request, never stored or cached.
      return urls.subscriptions.find((s) => s.id === sub.providerSubscriptionId)?.view_subscription ?? urls.general.overview;
    },

    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders) {
      const header = headers['paddle-signature'];
      if (typeof header !== 'string') throw new InvalidSignatureError();
      const sig = parsePaddleSignatureHeader(header);
      if (!sig) throw new InvalidSignatureError();

      // The signed payload is `${ts}:` followed by the exact bytes received. Never re-serialized JSON.
      const expected = createHmac('sha256', cfg.webhookSecret).update(Buffer.concat([Buffer.from(`${sig.ts}:`), rawBody])).digest();
      let matched = false;
      for (const candidate of sig.signatures) {
        if (!/^[0-9a-f]{64}$/i.test(candidate)) continue;
        if (timingSafeEqual(Buffer.from(candidate, 'hex'), expected)) matched = true; // checks every candidate: no early exit
      }
      if (!matched) throw new InvalidSignatureError();

      if (tolerance > 0 && Math.abs(Math.floor(now() / 1000) - Number(sig.ts)) > tolerance) throw new InvalidSignatureError();
    },

    parseWebhook(rawBody: Buffer): ParsedWebhook {
      const envelope = webhookEnvelope.parse(JSON.parse(rawBody.toString('utf8')));
      const { event_id: eventId, event_type: eventType } = envelope;
      if (PADDLE_SUBSCRIPTION_EVENTS.has(eventType)) {
        return { kind: 'subscription', eventId, eventType, subscription: normalizeSubscription(envelope.data) };
      }
      // Unknown or unused events (transactions, customers, adjustments, ...): acknowledged and skipped by the caller.
      return { kind: 'other', eventId, eventType };
    },
  };
}