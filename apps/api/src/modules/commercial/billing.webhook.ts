import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/app-error';
import { isObjectId } from '../../utils/object-id';
import { recordAudit } from '../audit/audit.service';
import { Organization } from '../organizations/organization.model';
import { BillingEvent, Plan, Subscription } from './commercial.model';
import { invalidateEntitlements } from './entitlements.service';
import { intervalOf, InvalidSignatureError, type NormalizedSubscription } from './providers/billing-provider';
import { resolveProvider } from './providers';

const LEASE_MS = 5 * 60_000;
const clip = (s: string, n = 500) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type ApplyOutcome = { outcome: 'APPLIED' | 'STALE' | 'UNMATCHED'; organizationId?: string };

async function resolvePlan(provider: string, variantId: string) {
  const plan = await Plan.findOne({ prices: { $elemMatch: { variants: { $elemMatch: { provider, variantId } } } } });
  if (!plan) return null;
  const price = plan.prices.find((p) => p.variants.some((v) => v.provider === provider && v.variantId === variantId));
  return { plan, interval: intervalOf(price?.interval ?? 'MONTH') };
}

/**
 * Applies provider subscription state. Used by BOTH webhooks and direct provider API responses, so there is one path
 * and one set of rules. Idempotent, and ordered by the provider's own updated_at: older state never overwrites newer.
 */
export async function applyProviderSubscription(provider: string, n: NormalizedSubscription): Promise<ApplyOutcome> {
  let doc = await Subscription.findOne({ provider, providerSubscriptionId: n.providerSubscriptionId });

  if (!doc) {
    // First event for this subscription: claim the pending checkout we created. The reference comes from custom data
    // that is only trusted because the webhook signature was verified (or the data came from the provider API).
    const ref = n.customData.subscription_ref;
    const orgId = n.customData.organization_id;
    if (isObjectId(ref) && isObjectId(orgId)) {
      doc = await Subscription.findOne({ _id: ref, organizationId: orgId, provider, providerSubscriptionId: { $exists: false }, status: { $in: ['INCOMPLETE', 'EXPIRED'] } });
    }
  }
  if (!doc) return { outcome: 'UNMATCHED' };

  const resolved = await resolvePlan(provider, n.providerVariantId);
  if (!resolved) throw new Error('The provider variant is not mapped to any plan'); // fail loudly rather than guess an entitlement

  const organizationId = String(doc.organizationId);
  const set = {
    planId: resolved.plan._id, planSlug: resolved.plan.slug, billingInterval: resolved.interval,
    providerSubscriptionId: n.providerSubscriptionId, providerCustomerId: n.providerCustomerId, status: n.status,
    currentPeriodStart: n.currentPeriodStart ?? doc.currentPeriodStart ?? undefined,
    currentPeriodEnd: n.currentPeriodEnd ?? undefined,
    trialEnd: n.trialEnd ?? undefined,
    trialStart: doc.trialStart ?? (n.trialEnd ? n.createdAt ?? undefined : undefined),
    cancelAtPeriodEnd: n.cancelAtPeriodEnd,
    cancelledAt: n.cancelAtPeriodEnd || n.status === 'CANCELLED' ? doc.cancelledAt ?? n.updatedAt : null,
    providerUpdatedAt: n.updatedAt,
  };
  // Atomic out-of-order guard: only applies if nothing newer has been applied in the meantime.
  const updated = await Subscription.findOneAndUpdate(
    { _id: doc._id, $or: [{ providerUpdatedAt: { $exists: false } }, { providerUpdatedAt: null }, { providerUpdatedAt: { $lte: n.updatedAt } }] },
    { $set: set, $unset: { checkoutUrl: 1, checkoutExpiresAt: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) return { outcome: 'STALE', organizationId };

  invalidateEntitlements(organizationId);
  await audit(organizationId, 'billing.subscription_synced', updated._id, { status: updated.status, plan: updated.planSlug, interval: updated.billingInterval });
  return { outcome: 'APPLIED', organizationId };
}

/** Billing has no human actor, so the entry is attributed to the organization owner and marked as system-originated. */
async function audit(organizationId: string, action: string, resourceId: Types.ObjectId, after: Record<string, unknown>) {
  const org = await Organization.findById(organizationId).select('ownerId').lean();
  if (!org) return;
  await recordAudit({ organizationId, actorId: org.ownerId, action, resource: 'subscription', resourceId, after: { ...after, source: 'billing' }, meta: {} } as never);
}

/* ----------------------------------------------------------------- ingress */

/** Entry point for POST /webhooks/billing/:provider. Never trusts the payload before the signature is verified. */
export async function receiveBillingWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
  const provider = resolveProvider(providerName);
  if (!provider) throw AppError.notFound('Not found');
  if (!rawBody || rawBody.length === 0) throw AppError.validation([{ path: 'body', message: 'Empty request body' }]);

  try {
    provider.verifySignature(rawBody, headers);
  } catch (err) {
    if (err instanceof InvalidSignatureError) throw AppError.unauthorized('Invalid signature.', 'INVALID_SIGNATURE');
    throw err;
  }

  let parsed;
  try {
    parsed = provider.parseWebhook(rawBody);
  } catch {
    throw AppError.validation([{ path: 'body', message: 'Unrecognised webhook payload' }]);
  }

  const customOrg = 'subscription' in parsed ? parsed.subscription.customData.organization_id : 'customData' in parsed ? parsed.customData.organization_id : undefined;
  const event = await BillingEvent.findOneAndUpdate(
    { provider: provider.name, providerEventId: parsed.eventId },
    { $setOnInsert: { eventType: parsed.eventType, processingStatus: 'RECEIVED', attempts: 0, payload: rawBody.toString('utf8'), organizationId: isObjectId(customOrg) ? customOrg : null } },
    { upsert: true, returnDocument: 'after' },
  );
  return processBillingEvent(String(event!._id)); // a redelivery finds the same row and is a no-op if already processed
}

/** Claims and processes one stored event. Safe to call concurrently, repeatedly, and for retries of failed events. */
export async function processBillingEvent(eventId: string): Promise<'PROCESSED' | 'SKIPPED' | 'DUPLICATE'> {
  const ev = await BillingEvent.findOneAndUpdate(
    { _id: eventId, $or: [{ processingStatus: { $in: ['RECEIVED', 'FAILED'] } }, { processingStatus: 'PROCESSING', lockedAt: { $lt: new Date(Date.now() - LEASE_MS) } }] },
    { $set: { processingStatus: 'PROCESSING', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).select('+payload');
  if (!ev) return 'DUPLICATE';

  const finish = (processingStatus: 'PROCESSED' | 'SKIPPED' | 'FAILED', extra: Record<string, unknown> = {}) =>
    BillingEvent.updateOne({ _id: ev._id }, { $set: { processingStatus, processedAt: new Date(), ...extra }, $unset: { lockedAt: 1 } });

  try {
    const provider = resolveProvider(ev.provider);
    if (!provider) throw new Error('The billing provider is not configured');
    const parsed = provider.parseWebhook(Buffer.from(ev.payload ?? '', 'utf8'));

    if (parsed.kind === 'subscription') {
      const r = await applyProviderSubscription(provider.name, parsed.subscription);
      await finish(r.outcome === 'APPLIED' ? 'PROCESSED' : 'SKIPPED', {
        organizationId: r.organizationId ? new Types.ObjectId(r.organizationId) : ev.organizationId,
        errorSummary: r.outcome === 'STALE' ? 'Ignored: a newer state was already applied' : r.outcome === 'UNMATCHED' ? 'Ignored: no matching checkout or subscription' : undefined,
      });
      return r.outcome === 'APPLIED' ? 'PROCESSED' : 'SKIPPED';
    }

    if (parsed.kind === 'invoice') {
      // Payment outcomes only flag a payment issue. Status itself comes from the subscription_* events, never from here.
      const sub = await Subscription.findOne({ provider: provider.name, providerSubscriptionId: parsed.providerSubscriptionId });
      if (!sub) { await finish('SKIPPED', { errorSummary: 'Ignored: unknown subscription' }); return 'SKIPPED'; }
      const update =
        parsed.outcome === 'FAILED' ? { $set: { lastPaymentFailedAt: parsed.occurredAt, paymentEventAt: parsed.occurredAt } }
        : parsed.outcome === 'PAID' ? { $set: { paymentEventAt: parsed.occurredAt }, $unset: { lastPaymentFailedAt: 1 } } : null;
      if (!update) { await finish('SKIPPED', { organizationId: sub.organizationId }); return 'SKIPPED'; }
      const applied = await Subscription.updateOne(
        { _id: sub._id, $or: [{ paymentEventAt: { $exists: false } }, { paymentEventAt: { $lte: parsed.occurredAt } }] }, update,
      );
      await finish(applied.matchedCount ? 'PROCESSED' : 'SKIPPED', { organizationId: sub.organizationId, errorSummary: applied.matchedCount ? undefined : 'Ignored: a newer payment event was already applied' });
      invalidateEntitlements(String(sub.organizationId));
      return applied.matchedCount ? 'PROCESSED' : 'SKIPPED';
    }

    await finish('SKIPPED'); // events this product does not act on (orders, customers, license keys, ...)
    return 'SKIPPED';
  } catch (err) {
    const message = clip(err instanceof Error ? err.message : 'processing failed');
    logger.error({ eventId: String(ev._id), provider: ev.provider, eventType: ev.eventType, error: message }, 'billing event failed'); // no payload, no headers
    await finish('FAILED', { errorSummary: message });
    throw err; // non-200 makes the provider redeliver
  }
}