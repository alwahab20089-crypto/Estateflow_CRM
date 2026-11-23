/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { recordAudit } from '../audit/audit.service';
import type { TenantContext } from '../members/member.service';
import { User } from '../users/user.model';
import { applyProviderSubscription } from './billing.webhook';
import type { CheckoutInput } from './billing.validation';
import { Plan, Subscription } from './commercial.model';
import { getOrganizationEntitlements, getOrganizationUsage, invalidateEntitlements, isEntitling } from './entitlements.service';
import { getBillingProvider } from './providers';
import { BillingProviderError } from './providers/billing-provider';

const CHECKOUT_TTL_MS = 24 * 3_600_000;
const oid = (v: string) => new Types.ObjectId(v);

const providerOrFail = () => {
  const p = getBillingProvider();
  if (!p || !p.isConfigured()) throw new AppError(503, 'Billing is not available right now.', 'BILLING_NOT_CONFIGURED');
  return p;
};
const appUrl = () => env.FRONTEND_URL.split(',')[0]!.trim().replace(/\/$/, '');

/**
 * Every provider call goes through here. A provider 4xx means the provider refused the change (409 for the client);
 * anything else (outage, 5xx, unreadable answer) is a 502. Provider details are never leaked to the client.
 * Without this, BillingProviderError.status (e.g. 404) would be mistaken for a body-parser error by the error handler.
 */
async function viaProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BillingProviderError) {
      if (err.status !== undefined && err.status >= 400 && err.status < 500) {
        throw AppError.conflict('The billing provider rejected this change. Refresh and try again.', 'BILLING_CHANGE_REJECTED');
      }
      throw new AppError(502, 'The billing provider could not complete the request. Please try again.', 'BILLING_PROVIDER_ERROR');
    }
    throw err;
  }
}

const planDto = (p: any, providerName: string | undefined) => ({
  slug: p.slug, name: p.name, description: p.description ?? null, trialDays: p.trialDays ?? 0, isFallback: p.isFallback,
  features: p.features, limits: p.limits,
  prices: p.prices.map((x: any) => ({ interval: x.interval, amount: x.amount, currency: x.currency, purchasable: Boolean(providerName && x.variants.some((v: any) => v.provider === providerName)) })),
});

export async function listPlans() {
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  const provider = getBillingProvider();
  return plans.map((p) => planDto(p, provider?.isConfigured() ? provider.name : undefined));
}

/** A scheduled cancellation can be undone only while the subscription is still running. */
const canResume = (s: any) => Boolean(s.cancelAtPeriodEnd) && ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(s.status);

const subscriptionDto = (s: any) => ({
  _id: String(s._id), planSlug: s.planSlug, status: s.status, billingInterval: s.billingInterval,
  currentPeriodStart: s.currentPeriodStart ?? null, currentPeriodEnd: s.currentPeriodEnd ?? null, trialEnd: s.trialEnd ?? null,
  cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd), cancelledAt: s.cancelledAt ?? null, canResume: canResume(s),
  paymentIssue: Boolean(s.lastPaymentFailedAt) || s.status === 'PAST_DUE' || s.status === 'UNPAID', lastPaymentFailedAt: s.lastPaymentFailedAt ?? null, createdAt: s.createdAt,
});

/** What the browser needs to open the provider's checkout. Public values only (the Paddle client token is public by design). */
const checkoutConfig = (provider: ReturnType<typeof getBillingProvider>) => {
  if (!provider || !provider.isConfigured()) return null;
  if (provider.name === 'paddle') return { provider: 'paddle', environment: env.PADDLE_ENVIRONMENT, clientToken: env.PADDLE_CLIENT_TOKEN ?? null };
  return { provider: provider.name };
};

/** Onboarding/billing state. Everything here is read from persisted, provider-confirmed state: never from the browser. */
export async function getSubscriptionOverview(tenant: TenantContext) {
  const org = oid(tenant.organizationId);
  const latest = await Subscription.findOne({ organizationId: org }).sort({ createdAt: -1 }).lean();
  const entitlements = await getOrganizationEntitlements(tenant.organizationId);
  const provider = getBillingProvider();
  const now = new Date();

  let onboarding: { state: string; message: string };
  if (!latest) onboarding = { state: 'NO_PLAN', message: 'Choose a plan to unlock more of EstateFlow.' };
  else if (latest.status === 'INCOMPLETE') {
    const pending = (latest.checkoutExpiresAt?.getTime() ?? latest.createdAt.getTime() + CHECKOUT_TTL_MS) > now.getTime();
    onboarding = pending
      ? { state: 'CHECKOUT_PENDING', message: 'Waiting for the billing provider to confirm your subscription. This usually takes under a minute.' }
      : { state: 'NO_PLAN', message: 'Your last checkout was not completed.' };
  } else if (latest.status === 'PAST_DUE' || latest.status === 'UNPAID') onboarding = { state: 'PAYMENT_FAILED', message: 'Your last payment failed. Update your payment method to keep your plan.' };
  else if (latest.status === 'CANCELLED') onboarding = { state: isEntitling(latest, now) ? 'CANCELLING' : 'ENDED', message: isEntitling(latest, now) ? 'Your plan is cancelled and stays active until the end of the paid period.' : 'Your subscription has ended.' };
  else if (latest.status === 'EXPIRED' || latest.status === 'PAUSED') onboarding = { state: latest.status, message: latest.status === 'PAUSED' ? 'Billing is paused.' : 'Your subscription has ended.' };
  else if (latest.cancelAtPeriodEnd) onboarding = { state: 'CANCELLING', message: 'Your plan will end at the close of this period.' };
  else onboarding = { state: latest.status, message: 'Your subscription is active.' };

  return {
    billingAvailable: Boolean(provider?.isConfigured()),
    checkoutConfig: checkoutConfig(provider),
    onboarding,
    subscription: latest ? subscriptionDto(latest) : null,
    entitlements: { source: entitlements.source, planSlug: entitlements.planSlug, planName: entitlements.planName, status: entitlements.status, features: entitlements.features, limits: entitlements.limits, validUntil: entitlements.validUntil },
  };
}

/**
 * Creates (or re-uses) a checkout. This NEVER activates anything: access is granted only when a verified provider event
 * or provider API response says so. A repeated call returns the same pending checkout, so retries cannot create
 * duplicate subscriptions or duplicate organizations' worth of checkouts.
 */
export async function createCheckout(tenant: TenantContext, userId: string, input: CheckoutInput, meta: RequestMeta) {
  const provider = providerOrFail();
  const org = oid(tenant.organizationId);
  const plan = await Plan.findOne({ slug: input.planSlug, isActive: true });
  if (!plan || plan.isFallback) throw AppError.validation([{ path: 'planSlug', message: 'This plan cannot be purchased' }]);
  const price = plan.prices.find((p) => p.interval === input.interval);
  const variant = price?.variants.find((v) => v.provider === provider.name);
  if (!price || !variant) throw AppError.validation([{ path: 'interval', message: 'This plan is not available for the selected billing interval' }]);

  const live = await Subscription.findOne({ organizationId: org, status: { $in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'] } }).lean();
  if (live) throw AppError.conflict('This organization already has a subscription. Use plan change or manage subscription instead.', 'SUBSCRIPTION_EXISTS');

  const now = new Date();
  const pending = await Subscription.findOne({ organizationId: org, status: 'INCOMPLETE' });
  if (pending) {
    const reusable = pending.planId.equals(plan._id) && pending.billingInterval === input.interval && pending.checkoutUrl && (pending.checkoutExpiresAt?.getTime() ?? 0) > now.getTime();
    if (reusable) return { url: pending.checkoutUrl!, subscriptionId: String(pending._id), reused: true };
    await Subscription.updateOne({ _id: pending._id, status: 'INCOMPLETE' }, { $set: { status: 'EXPIRED' } }); // superseded; kept as history
  }

  let doc;
  try {
    doc = await Subscription.create({ organizationId: org, planId: plan._id, planSlug: plan.slug, provider: provider.name, status: 'INCOMPLETE', billingInterval: input.interval, createdBy: userId });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const winner = await Subscription.findOne({ organizationId: org, status: 'INCOMPLETE', checkoutUrl: { $exists: true } }).lean(); // a concurrent request won
    if (winner?.checkoutUrl) return { url: winner.checkoutUrl, subscriptionId: String(winner._id), reused: true };
    throw AppError.conflict('A checkout is already being created. Try again in a moment.', 'CHECKOUT_IN_PROGRESS');
  }

  try {
    const user = await User.findById(userId).select('email').lean();
    const out = await provider.createCheckout({
      organizationId: tenant.organizationId, subscriptionRef: String(doc._id), email: user!.email, variantId: variant.variantId,
      redirectUrl: `${appUrl()}/app/settings/billing?checkout=return`, // a hint for the UI only; it never confirms payment
    });
    await Subscription.updateOne({ _id: doc._id }, { $set: { checkoutUrl: out.url, checkoutExpiresAt: out.expiresAt ?? new Date(now.getTime() + CHECKOUT_TTL_MS) } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'billing.checkout_created', resource: 'subscription', resourceId: doc._id, after: { plan: plan.slug, interval: input.interval }, meta } as never);
    return { url: out.url, subscriptionId: String(doc._id), reused: false };
  } catch (err) {
    await Subscription.deleteOne({ _id: doc._id, status: 'INCOMPLETE' }); // nothing was sold: leave no half-created record
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'The billing provider could not start the checkout. Please try again.', 'BILLING_PROVIDER_ERROR');
  }
}

/** The customer abandoned checkout. History is kept; a later webhook can still honour a payment that did complete. */
export async function abandonCheckout(tenant: TenantContext) {
  await Subscription.updateOne({ organizationId: oid(tenant.organizationId), status: 'INCOMPLETE' }, { $set: { status: 'EXPIRED' }, $unset: { checkoutUrl: 1 } });
  return getSubscriptionOverview(tenant);
}

/** Only ever looks at the caller's own organization, so another organization's subscription is simply "not found". */
async function currentProviderSubscription(tenant: TenantContext) {
  const sub = await Subscription.findOne({ organizationId: oid(tenant.organizationId), providerSubscriptionId: { $exists: true }, status: { $in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED'] } }).sort({ createdAt: -1 });
  if (!sub) throw AppError.notFound('No subscription found');
  return sub;
}

const endedError = () => AppError.conflict('This subscription has ended. Start a new checkout to subscribe again.', 'SUBSCRIPTION_ENDED');

export async function portalUrl(tenant: TenantContext) {
  const provider = providerOrFail();
  const sub = await currentProviderSubscription(tenant);
  return { url: await viaProvider(() => provider.getPortalUrl(sub.providerSubscriptionId!)) };
}

/** Schedules the end of the paid period. Idempotent: an already scheduled or ended cancellation makes no provider call. */
export async function cancelSubscription(tenant: TenantContext, userId: string, meta: RequestMeta) {
  const provider = providerOrFail();
  const sub = await currentProviderSubscription(tenant);
  if (sub.status === 'CANCELLED' || sub.cancelAtPeriodEnd) return getSubscriptionOverview(tenant);
  const latest = await viaProvider(() => provider.cancelSubscription(sub.providerSubscriptionId!)); // trusted provider API response...
  await applyProviderSubscription(provider.name, { ...latest, customData: {} }); // ...applied through the same ordered, idempotent path as webhooks
  await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'billing.cancel_requested', resource: 'subscription', resourceId: sub._id, meta } as never);
  invalidateEntitlements(tenant.organizationId);
  return getSubscriptionOverview(tenant);
}

/** Undoes a scheduled cancellation. A subscription that has already ended cannot be reinstated: it needs a new checkout. */
export async function resumeSubscription(tenant: TenantContext, userId: string, meta: RequestMeta) {
  const provider = providerOrFail();
  const sub = await currentProviderSubscription(tenant);
  if (sub.status === 'CANCELLED') throw endedError();
  if (!sub.cancelAtPeriodEnd) return getSubscriptionOverview(tenant); // nothing scheduled: idempotent
  const latest = await viaProvider(() => provider.resumeSubscription(sub.providerSubscriptionId!));
  await applyProviderSubscription(provider.name, { ...latest, customData: {} });
  await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'billing.resume_requested', resource: 'subscription', resourceId: sub._id, meta } as never);
  invalidateEntitlements(tenant.organizationId);
  return getSubscriptionOverview(tenant);
}

export async function changePlan(tenant: TenantContext, userId: string, input: CheckoutInput, meta: RequestMeta) {
  const provider = providerOrFail();
  const sub = await currentProviderSubscription(tenant);
  const plan = await Plan.findOne({ slug: input.planSlug, isActive: true });
  const variant = plan?.prices.find((p) => p.interval === input.interval)?.variants.find((v) => v.provider === provider.name);
  if (!plan || plan.isFallback || !variant) throw AppError.validation([{ path: 'planSlug', message: 'This plan is not available' }]);

  if (sub.status === 'CANCELLED') throw endedError();
  if (sub.status !== 'ACTIVE' && sub.status !== 'TRIALING') {
    throw AppError.conflict('The plan cannot be changed right now. Resolve the payment issue or resume billing first.', 'PLAN_CHANGE_NOT_ALLOWED');
  }
  if (sub.planId.equals(plan._id) && sub.billingInterval === input.interval) return getSubscriptionOverview(tenant); // already on it: no provider call

  const latest = await viaProvider(() => provider.changePlan(sub.providerSubscriptionId!, variant.variantId));
  await applyProviderSubscription(provider.name, { ...latest, customData: {} });
  await recordAudit({ organizationId: tenant.organizationId, actorId: userId, action: 'billing.plan_change_requested', resource: 'subscription', resourceId: sub._id, after: { plan: plan.slug, interval: input.interval }, meta } as never);
  invalidateEntitlements(tenant.organizationId);
  return getSubscriptionOverview(tenant);
}

export const usageOverview = (tenant: TenantContext) => getOrganizationUsage(tenant.organizationId);