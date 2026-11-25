import { model, Schema, type InferSchemaType, type Types } from 'mongoose';
import { LICENSE_EDITIONS, LICENSE_STATUSES } from '../../constants';

const ref = (to: string, required = false) => ({ type: Schema.Types.ObjectId, ref: to, required });

/* ----------------------------------------------------------------- License */
// One row per license key activated on an install. Features and limits are copied from the signed license when it is
// activated, so entitlement checks never need the key (or a network call) on a request.
const licenseSchema = new Schema(
  {
    organizationId: ref('Organization', true),
    /** The license's own id (the signed "jti"). */
    licenseId: { type: String, required: true },
    /** SHA-256 (hex) of the license key. The key itself is never stored. */
    licenseKeyHash: { type: String, required: true, select: false, match: /^[a-f0-9]{64}$/ },
    /** Only for display ("ends in 7K2Q") so the owner can tell which key is installed. */
    keyLast4: { type: String, required: true, match: /^[A-Za-z0-9_-]{4}$/ },
    licensee: { type: String, required: true, trim: true, maxlength: 120 },
    edition: { type: String, enum: LICENSE_EDITIONS, required: true },
    status: { type: String, enum: LICENSE_STATUSES, required: true, default: 'ACTIVE' },
    features: { type: Schema.Types.Mixed, default: {} },
    limits: { type: Schema.Types.Mixed, default: {} },
    issuedAt: { type: Date, required: true },
    activatedAt: { type: Date, required: true, default: () => new Date() },
    /** null = perpetual license. */
    expiresAt: { type: Date, default: null },
    activatedBy: ref('User'),
  },
  { timestamps: true, minimize: false },
);
licenseSchema.index({ licenseKeyHash: 1 }, { unique: true });
licenseSchema.index({ licenseId: 1 }, { unique: true });
licenseSchema.index({ organizationId: 1, updatedAt: -1 });
// Business rule: never two ACTIVE licenses for one organization (also makes concurrent activations safe).
licenseSchema.index({ organizationId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'one_active_license_per_org' });

/* ----------------------------------------------------------------- usage lock */
const usageLockSchema = new Schema({
  organizationId: ref('Organization', true),
  key: { type: String, required: true },
  owner: String,
  lockedUntil: { type: Date, default: () => new Date(0) },
});
usageLockSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export type LicenseRecord = InferSchemaType<typeof licenseSchema> & { _id: Types.ObjectId };
export const License = model('License', licenseSchema);
export const UsageLock = model('UsageLock', usageLockSchema);