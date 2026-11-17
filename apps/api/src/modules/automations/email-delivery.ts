import type { Types } from 'mongoose';
import { getEmailProvider } from '../../utils/email-provider';
import { EmailDelivery } from './automation.model';

type Id = string | Types.ObjectId;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * At-most-once-per-key delivery with tracking. Safe to call again after a crash or retry:
 * a SENT delivery is never sent twice; QUEUED/FAILED ones are attempted again.
 */
export async function sendTrackedEmail(i: { organizationId: Id; userId: Id; to: string; subject: string; text: string; deliveryKey: string }) {
  const provider = getEmailProvider();
  const key = { organizationId: i.organizationId, deliveryKey: i.deliveryKey };
  await EmailDelivery.updateOne(key, { $setOnInsert: { userId: i.userId, provider: provider.name, subject: clip(i.subject, 200), status: 'QUEUED', attempts: 0 } }, { upsert: true });

  const claimed = await EmailDelivery.findOneAndUpdate(
    { ...key, status: { $in: ['QUEUED', 'FAILED'] } },
    { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { sent: false, duplicate: true };

  try {
    const r = await provider.send({ to: i.to, subject: i.subject, text: i.text, idempotencyKey: i.deliveryKey });
    await EmailDelivery.updateOne({ _id: claimed._id }, { $set: { status: 'SENT', providerMessageId: r.messageId, sentAt: new Date(), error: null } });
    return { sent: true, duplicate: false };
  } catch (err) {
    await EmailDelivery.updateOne({ _id: claimed._id }, { $set: { status: 'FAILED', error: clip(err instanceof Error ? err.message : 'send failed', 500) } });
    throw err;
  }
}