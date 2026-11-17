import { Types } from 'mongoose';
import { MANDATORY_NOTIFICATION_TYPES, NOTIFICATION_TYPES, type NotificationType } from '../../constants';
import { AppError } from '../../utils/app-error';
import type { TenantContext } from '../members/member.service';
import { NotificationPreference } from './notification-preference.model';

type Id = string | Types.ObjectId;
type Prefs = Record<string, { inApp?: boolean; email?: boolean } | undefined>;
const mandatory = (t: string) => (MANDATORY_NOTIFICATION_TYPES as readonly string[]).includes(t);
const load = async (org: Id, user: Id): Promise<Prefs> =>
  ((await NotificationPreference.findOne({ organizationId: org, userId: user }).select('preferences').lean())?.preferences ?? {}) as Prefs;

/** Defaults: every channel enabled. Mandatory types are always enabled, whatever is stored. */
export async function isInAppEnabled(org: Id, user: Id, type: NotificationType): Promise<boolean> {
  if (mandatory(type)) return true;
  return (await load(org, user))[type]?.inApp !== false;
}
/** The email channel is consumed by automation email actions (type AUTOMATION). */
export async function isEmailPreferred(org: Id, user: Id): Promise<boolean> {
  return (await load(org, user)).AUTOMATION?.email !== false;
}

export async function getPreferences(tenant: TenantContext, userId: string) {
  const p = await load(tenant.organizationId, userId);
  return NOTIFICATION_TYPES.map((type) => ({
    type, mandatory: mandatory(type),
    inApp: mandatory(type) ? true : p[type]?.inApp !== false,
    email: type === 'AUTOMATION' ? p[type]?.email !== false : null, // only automation emails exist today
  }));
}

export async function updatePreferences(tenant: TenantContext, userId: string, input: { preferences: { type: string; inApp?: boolean; email?: boolean }[] }) {
  const $set: Record<string, boolean> = {};
  for (const item of input.preferences) {
    if (mandatory(item.type) && (item.inApp === false || item.email === false)) {
      throw AppError.conflict(`${item.type} notifications cannot be disabled.`, 'NOTIFICATION_MANDATORY');
    }
    if (item.inApp !== undefined) $set[`preferences.${item.type}.inApp`] = item.inApp; // type is a validated enum: safe path
    if (item.email !== undefined) $set[`preferences.${item.type}.email`] = item.email;
  }
  if (Object.keys($set).length) {
    await NotificationPreference.updateOne({ organizationId: tenant.organizationId, userId }, { $set }, { upsert: true });
  }
  return getPreferences(tenant, userId);
}