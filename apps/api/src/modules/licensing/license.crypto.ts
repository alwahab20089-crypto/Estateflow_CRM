import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { LICENSE_EDITIONS } from '../../constants';
import { featuresSchema, limitsSchema } from './license.catalog';

/**
 * A license key is   EF1.<payload>.<signature>   (payload = base64url JSON, signature = Ed25519 over "EF1.<payload>").
 * The vendor signs with a PRIVATE key that never ships; every install only holds the PUBLIC key (LICENSE_PUBLIC_KEY),
 * so a customer can verify a key offline but cannot make one. Honest limit: a determined customer who edits the
 * software or the database can still bypass checks. The goal is reasonable protection, not DRM.
 */
const PREFIX = 'EF1';

export const licensePayloadSchema = z
  .object({
    v: z.literal(1),
    jti: z.uuid(),
    licensee: z.string().trim().min(1).max(120),
    edition: z.enum(LICENSE_EDITIONS),
    features: featuresSchema,
    limits: limitsSchema,
    issuedAt: z.iso.datetime(),
    /** null = perpetual. */
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export class LicenseKeyError extends Error {}

/** Pasted keys often gain spaces or line breaks. They are never part of a key. */
export const normalizeLicenseKey = (raw: string) => raw.replace(/\s+/g, '');

/** SHA-256 of the normalized key. Only this hash is stored. */
export const hashLicenseKey = (key: string) => createHash('sha256').update(normalizeLicenseKey(key)).digest('hex');

/** Accepts a PEM, including one stored in an .env file with literal "\n" sequences. */
const pemFrom = (raw: string) => raw.trim().replace(/\\n/g, '\n');
export const parsePublicKey = (raw: string): KeyObject => createPublicKey(pemFrom(raw));
export const parsePrivateKey = (raw: string): KeyObject => createPrivateKey(pemFrom(raw));

export function signLicense(payload: LicensePayload, privateKey: KeyObject): string {
  const body = `${PREFIX}.${Buffer.from(JSON.stringify(licensePayloadSchema.parse(payload))).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
}

/** Throws LicenseKeyError for ANY problem, with one generic message: callers must not learn which check failed. */
export function verifyLicense(rawKey: string, publicKey: KeyObject): { payload: LicensePayload; key: string } {
  const key = normalizeLicenseKey(rawKey);
  const fail = () => new LicenseKeyError('This license key is not valid.');

  const parts = key.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw fail();
  const [, payloadB64, signatureB64] = parts as [string, string, string];

  try {
    if (!verify(null, Buffer.from(`${PREFIX}.${payloadB64}`), publicKey, Buffer.from(signatureB64, 'base64url'))) throw fail();
  } catch {
    throw fail();
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  const parsed = licensePayloadSchema.safeParse(json);
  if (!parsed.success) throw fail();
  return { payload: parsed.data, key };
}