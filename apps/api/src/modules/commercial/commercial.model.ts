import { model, Schema, type InferSchemaType, type Types } from 'mongoose';
import { BILLING_INTERVALS, LIVE_SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUSES } from '../../constants';

const ref = (to: string, required = false) => ({ type: Schema.Types.ObjectId, ref: to, required });
const minor = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'must be an integer number of minor units' } };

/* ----------------------------------------------------------------- Plan */
// Differs from the suggested flat shape on purpose: one tier ("Pro") has several prices (monthly, yearly), so
// priceAmount / currency / billingInterval live in prices[] instead of duplicating the tier per interval.
const planSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 60, match: /^[a-z0-9-]+$/ },
    description: { type: String, trim: true, maxlength: 500 },
    prices: {
      type: [{
        _id: false,
        interval: { type: String, enum: BILLING_INTERVALS, required: true },
        amount: minor, // integer minor units (cents). Never floats.
        currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
        /** The provider's own product variant ids for this price, e.g. { provider: 'lemonsqueezy', variantId: '123' }. */
        variants: { type: [{ _id: false, provider: { type: String, required: true }, variantId: { type: String, required: true } }], default: [] },
      }],
      default: [],
      validate: { validator: (v: { interval: string }[]) => new Set(v.map((p) => p.interval)).size === v.length, message: 'one price per interval' },
    },
    features: { type: Schema.Types.Mixed, default: {} },
    limits: { type: Schema.Types.Mixed, default: {} },
    /** Display only: the trial itself is configured on the provider's variant. Keep the two in sync. */
    trialDays: { type: Number, min: 0, max: 90, default: 0 },
    /** The explicit "no paid subscription" plan (e.g. Free). At most one. Without one, such organizations are RESTRICTED. */
    isFallback: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);
planSchema.index({ slug: 1 }, { unique: true });
planSchema.index({ isFallback: 1 }, { unique: true, partialFilterExpression: { isFallback: true }, name: 'one_fallback_plan' });
planSchema.index({ isActive: 1, sortOrder: 1 });
planSchema.index({ 'prices.variants.provider': 1, 'prices.variants.variantId': 1 });

/* ----------------------------------------------------------------- Subscription */
const subscriptionSchema = new Schema(
  {
    organizationId: ref('Organization', true),
    planId: ref('Plan', true),
    planSlug: { type: String, required: true }, // history stays readable even if the plan is later edited
    provider: { type: String, required: true },
    providerCustomerId: { type: String },
    providerSubscriptionId: { type: String },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
    billingInterval: { type: String, enum: BILLING_INTERVALS, required: true },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    trialStart: { type: Date },
    trialEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date },
    /** Pending checkout (INCOMPLETE only): lets a repeated request return the same checkout instead of making another. */
    checkoutUrl: { type: String, maxlength: 2000 },
    checkoutExpiresAt: { type: Date },
    /** The provider's own last-modified time of the state we applied. Older events are ignored (out-of-order delivery). */
    providerUpdatedAt: { type: Date },
    lastPaymentFailedAt: { type: Date },
    paymentEventAt: { type: Date },
    createdBy: ref('User'),
  },
  { timestamps: true },
);
subscriptionSchema.index({ organizationId: 1, createdAt: -1 }); // history
subscriptionSchema.index({ provider: 1, providerSubscriptionId: 1 }, { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: 'string' } }, name: 'unique_provider_subscription' });
// Business rule: never two live subscriptions for one organization (also makes concurrent checkouts safe).
subscriptionSchema.index({ organizationId: 1 }, { unique: true, partialFilterExpression: { status: { $in: [...LIVE_SUBSCRIPTION_STATUSES] } }, name: 'one_live_subscription_per_org' });

/* ----------------------------------------------------------------- BillingEvent */
const billingEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    providerEventId: { type: String, required: true, maxlength: 200 },
    organizationId: { type: Schema.Types.ObjectId, default: null },
    eventType: { type: String, required: true, maxlength: 100 },
    processingStatus: { type: String, enum: ['RECEIVED', 'PROCESSING', 'PROCESSED', 'SKIPPED', 'FAILED'], default: 'RECEIVED' },
    attempts: { type: Number, default: 0 },
    lockedAt: { type: Date },
    processedAt: { type: Date },
    errorSummary: { type: String, maxlength: 500 },
    /** The signature-verified raw body, kept so a failed event can be retried. Never returned by any API. */
    payload: { type: String, select: false, maxlength: 120_000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
billingEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });
billingEventSchema.index({ processingStatus: 1, createdAt: 1 });
billingEventSchema.index({ organizationId: 1, createdAt: -1 });

/* ----------------------------------------------------------------- usage helpers */
const usageCounterSchema = new Schema({
  organizationId: ref('Organization', true), key: { type: String, required: true }, periodKey: { type: String, required: true }, count: { type: Number, default: 0, min: 0 },
});
usageCounterSchema.index({ organizationId: 1, key: 1, periodKey: 1 }, { unique: true });

const usageLockSchema = new Schema({ organizationId: ref('Organization', true), key: { type: String, required: true }, owner: String, lockedUntil: { type: Date, default: () => new Date(0) } });
usageLockSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export type PlanRecord = InferSchemaType<typeof planSchema> & { _id: Types.ObjectId };
export type SubscriptionRecord = InferSchemaType<typeof subscriptionSchema> & { _id: Types.ObjectId };
export const Plan = model('Plan', planSchema);
export const Subscription = model('Subscription', subscriptionSchema);
export const BillingEvent = model('BillingEvent', billingEventSchema);
export const UsageCounter = model('UsageCounter', usageCounterSchema);
export const UsageLock = model('UsageLock', usageLockSchema);