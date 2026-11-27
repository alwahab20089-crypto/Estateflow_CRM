import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { recordAudit } from '../audit/audit.service';
import type { TenantContext } from '../members/member.service';
import {
  evaluateLicense,
  getOrganizationEntitlements,
  getOrganizationUsage,
  invalidateEntitlements,
} from './entitlements.service';
import { hashLicenseKey, LicenseKeyError, parsePublicKey, verifyLicense } from './license.crypto';
import { License } from './license.model';

const publicKey = () => {
  if (!env.LICENSE_PUBLIC_KEY) {
    throw new AppError(503, 'This installation is not set up to activate licenses (LICENSE_PUBLIC_KEY is missing).', 'LICENSE_NOT_CONFIGURED');
  }
  return parsePublicKey(env.LICENSE_PUBLIC_KEY);
};

const invalid = (message = 'This license key is not valid.') => new AppError(422, message, 'LICENSE_INVALID');

/** What the owner and the UI see. Never contains the key or its hash. */
export async function getLicenseOverview(t: TenantContext) {
  const [entitlements, usage] = await Promise.all([
    getOrganizationEntitlements(t.organizationId),
    getOrganizationUsage(t.organizationId),
  ]);
  // Prefer the ACTIVE row for the details; otherwise show the most recent one.
  const license =
    (await License.findOne({ organizationId: t.organizationId, status: 'ACTIVE' }).lean()) ??
    (await License.findOne({ organizationId: t.organizationId }).sort({ updatedAt: -1 }).lean());

  return {
    configured: Boolean(env.LICENSE_PUBLIC_KEY),
    state: entitlements.state,
    edition: entitlements.edition,
    features: entitlements.features,
    limits: entitlements.limits,
    validUntil: entitlements.validUntil,
    graceEndsAt: entitlements.graceEndsAt,
    license: license
      ? {
        licensee: license.licensee,
        keyLast4: license.keyLast4,
        issuedAt: license.issuedAt,
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt ?? null,
        status: license.status,
      }
      : null,
    usage,
  };
}

/** The version every member may read: drives the expiry banner and disabled buttons. Counts only; no license details. */
export async function getLicenseStatus(t: TenantContext) {
  const [e, usage] = await Promise.all([getOrganizationEntitlements(t.organizationId), getOrganizationUsage(t.organizationId)]);
  return {
    state: e.state,
    edition: e.edition,
    features: e.features,
    limits: e.limits,
    validUntil: e.validUntil,
    graceEndsAt: e.graceEndsAt,
    usage,
  };
}

export async function activateLicense(t: TenantContext, userId: string, rawKey: string, meta: RequestMeta) {
  let verified: ReturnType<typeof verifyLicense>;
  try {
    verified = verifyLicense(rawKey, publicKey());
  } catch (err) {
    if (err instanceof LicenseKeyError) throw invalid(err.message);
    throw err;
  }
  const { payload, key } = verified;
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

  // A license that is already past its grace period cannot be activated.
  if (evaluateLicense({ expiresAt }).state === 'EXPIRED') {
    throw new AppError(422, 'This license has expired. Ask your vendor for a renewed key.', 'LICENSE_EXPIRED');
  }

  const keyHash = hashLicenseKey(key);
  const existing = await License.findOne({ licenseKeyHash: keyHash }).select('+licenseKeyHash organizationId status');

  if (existing) {
    if (String(existing.organizationId) !== t.organizationId) {
      throw AppError.conflict('This license key is already used by another organization.', 'LICENSE_ALREADY_USED');
    }
    if (existing.status === 'REVOKED') throw AppError.conflict('This license has been revoked.', 'LICENSE_REVOKED');
    if (existing.status === 'ACTIVE') return getLicenseOverview(t); // idempotent: pasting the same key twice changes nothing
  }

  await runUnitOfWork(async ({ session, onRollback }) => {
    // The previous ACTIVE license is deactivated first: the partial unique index allows only one ACTIVE row.
    const previous = await License.find({ organizationId: t.organizationId, status: 'ACTIVE' }).select('_id').session(session ?? null);
    const previousIds = previous.map((p) => p._id);
    if (previousIds.length) {
      await License.updateMany({ _id: { $in: previousIds } }, { $set: { status: 'INACTIVE' } }, { session });
      onRollback(() => License.updateMany({ _id: { $in: previousIds } }, { $set: { status: 'ACTIVE' } }));
    }

    let licenseDocId;
    if (existing) {
      // Same organization, deactivated earlier: switch it back on.
      await License.updateOne({ _id: existing._id }, { $set: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: userId } }, { session });
      onRollback(() => License.updateOne({ _id: existing._id }, { $set: { status: 'INACTIVE' } }));
      licenseDocId = existing._id;
    } else {
      try {
        const [created] = await License.create(
          [
            {
              organizationId: t.organizationId,
              licenseId: payload.jti,
              licenseKeyHash: keyHash,
              keyLast4: key.slice(-4),
              licensee: payload.licensee,
              edition: payload.edition,
              status: 'ACTIVE',
              features: payload.features,
              limits: payload.limits,
              issuedAt: new Date(payload.issuedAt),
              expiresAt,
              activatedBy: userId,
            },
          ],
          { session },
        );
        licenseDocId = created!._id;
        onRollback(() => License.deleteOne({ _id: created!._id }));
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          throw AppError.conflict('This license key is already used.', 'LICENSE_ALREADY_USED');
        }
        throw err;
      }
    }

    await recordAudit(
      {
        organizationId: t.organizationId,
        actorId: userId,
        action: 'license.activated',
        resource: 'license',
        resourceId: licenseDocId,
        after: { edition: payload.edition, licensee: payload.licensee, expiresAt, keyLast4: key.slice(-4) },
        meta,
      },
      session,
    );
  });

  invalidateEntitlements(t.organizationId);
  return getLicenseOverview(t);
}

/** Turns the current license off. Data stays readable; nothing new can be created until a license is activated again. */
export async function deactivateLicense(t: TenantContext, userId: string, meta: RequestMeta) {
  const active = await License.findOneAndUpdate(
    { organizationId: t.organizationId, status: 'ACTIVE' },
    { $set: { status: 'INACTIVE' } },
    { returnDocument: 'after' },
  );
  if (!active) throw AppError.conflict('There is no active license to deactivate.', 'LICENSE_NOT_ACTIVE');

  await recordAudit({
    organizationId: t.organizationId,
    actorId: userId,
    action: 'license.deactivated',
    resource: 'license',
    resourceId: active._id,
    before: { edition: active.edition, licensee: active.licensee, keyLast4: active.keyLast4 },
    meta,
  });
  invalidateEntitlements(t.organizationId);
  return getLicenseOverview(t);
}