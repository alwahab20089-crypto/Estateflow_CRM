import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { OPEN_TASK_STATUSES } from '../../constants';
import { logger } from '../../config/logger';
import { runUnitOfWork } from '../../utils/transaction';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { OrganizationMember } from '../members/member.model';
import { createNotification } from '../notifications/notification.service';
import { Task, type TaskDoc } from './task.model';

const OPEN = [...OPEN_TASK_STATUSES];
const MAX_ATTEMPTS = 5;
const OVERDUE_WINDOW_MS = 7 * 86_400_000; // never back-fill notices for tasks that went overdue long ago
const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface ProcessOptions {
  now?: Date;
  batchSize?: number;
  /** A PROCESSING reminder whose lock is older than this is considered abandoned (crashed worker) and is retried. */
  leaseMs?: number;
  workerId?: string;
}
export interface ProcessResult { claimed: number; delivered: number; skipped: number; failed: number }

/**
 * Atomically claims ONE due reminder. findOneAndUpdate is atomic per document, so two workers (or two API
 * instances) can never claim the same reminder. Also reclaims reminders whose worker died mid-flight.
 */
function claimNext(now: Date, leaseMs: number, workerId: string) {
  return Task.findOneAndUpdate(
    {
      status: { $in: OPEN },
      deletedAt: null,
      $or: [
        { reminderStatus: 'PENDING', reminderNextAttemptAt: { $lte: now } },
        { reminderStatus: 'PROCESSING', reminderLockedAt: { $lte: new Date(now.getTime() - leaseMs) } },
      ],
    } as never,
    { $set: { reminderStatus: 'PROCESSING', reminderLockedAt: now, reminderLockedBy: workerId }, $inc: { reminderAttempts: 1 } },
    { sort: { reminderNextAttemptAt: 1 }, returnDocument: 'after', timestamps: false }, // timestamps:false: a claim is not a user edit
  );
}

async function isActiveMember(organizationId: unknown, userId: string, session: unknown) {
  return OrganizationMember.exists({ organizationId, userId, status: 'ACTIVE', invitationStatus: 'ACCEPTED' } as never).session((session ?? null) as never);
}

/** Delivers one claimed reminder. Idempotent: the delivery key embeds (task, reminderVersion, recipient). */
async function deliver(claimed: TaskDoc, now: Date): Promise<'delivered' | 'skipped'> {
  return runUnitOfWork(async (uow) => {
    // Re-check under the same transaction: the task may have been edited, completed or deleted since the claim.
    const task = await Task.findOne({
      _id: claimed._id,
      organizationId: claimed.organizationId,
      reminderStatus: 'PROCESSING',
      reminderVersion: claimed.reminderVersion,
      status: { $in: OPEN },
      deletedAt: null,
    } as never).session(uow.session ?? null);
    if (!task) return 'skipped';

    const recipient = String(task.assignedTo ?? task.createdBy);
    if (!(await isActiveMember(task.organizationId, recipient, uow.session))) {
      await Task.updateOne({ _id: task._id, reminderVersion: task.reminderVersion }, { $set: { reminderStatus: 'CANCELLED', reminderLockedAt: null, reminderLockedBy: null } }, { session: uow.session, timestamps: false });
      return 'skipped';
    }

    await createNotification(
      {
        organizationId: task.organizationId,
        recipientUserId: recipient,
        type: 'TASK_REMINDER',
        title: `Reminder: ${task.title}`,
        message: `Reminder for task "${task.title}".`,
        relatedEntityType: task.relatedEntityType,
        relatedEntityId: task.relatedEntityId,
        taskId: task._id,
        deliveryKey: `task-reminder:${task._id}:${task.reminderVersion}:${recipient}`,
      },
      uow.session,
    );

    const marked = await Task.updateOne(
      { _id: task._id, reminderStatus: 'PROCESSING', reminderVersion: task.reminderVersion },
      { $set: { reminderStatus: 'DELIVERED', reminderDeliveredAt: now, reminderLockedAt: null, reminderLockedBy: null, reminderLastError: null } },
      { session: uow.session, timestamps: false },
    );
    if (marked.modifiedCount === 1) {
      await recordActivity({ organizationId: task.organizationId, userId: recipient, entityType: 'TASK', entityId: task._id, activityType: 'FOLLOW_UP', description: 'Reminder delivered', metadata: { system: true } }, uow.session);
      await recordAudit({ organizationId: task.organizationId, actorId: null, action: 'task.reminder_delivered', resource: 'task', resourceId: task._id, after: { recipient, reminderVersion: task.reminderVersion } }, uow.session);
    }
    return 'delivered';
  });
}

export async function processDueReminders(options: ProcessOptions = {}): Promise<ProcessResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const leaseMs = options.leaseMs ?? 300_000;
  const workerId = options.workerId ?? WORKER_ID;
  const result: ProcessResult = { claimed: 0, delivered: 0, skipped: 0, failed: 0 };

  while (result.claimed < batchSize) {
    const task = await claimNext(now, leaseMs, workerId);
    if (!task) break;
    result.claimed += 1;
    try {
      const outcome = await deliver(task, now);
      if (outcome === 'delivered') result.delivered += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      const attempts = Number(task.reminderAttempts ?? 1);
      const exhausted = attempts >= MAX_ATTEMPTS;
      logger.error({ err, taskId: String(task._id), attempts }, 'reminder delivery failed');
      await Task.updateOne(
        { _id: task._id, reminderStatus: 'PROCESSING', reminderVersion: task.reminderVersion },
        {
          $set: {
            reminderStatus: exhausted ? 'FAILED' : 'PENDING',
            reminderNextAttemptAt: new Date(now.getTime() + Math.min(2 ** attempts, 30) * 60_000), // backoff, capped at 30 min
            reminderLockedAt: null,
            reminderLockedBy: null,
            reminderLastError: String((err as Error)?.message ?? err).slice(0, 300),
          },
        },
        { timestamps: false },
      ).catch(() => undefined); // if even this fails, the lease expires and the reminder is reclaimed
    }
  }
  return result;
}

/** One overdue notice per task per due date. Idempotent through the delivery key; the flag only avoids re-scanning. */
export async function processOverdueNotifications(options: ProcessOptions = {}): Promise<{ notified: number }> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const candidates = await Task.find({
    status: { $in: OPEN },
    deletedAt: null,
    overdueNotifiedAt: null,
    dueAt: { $lte: now, $gte: new Date(now.getTime() - OVERDUE_WINDOW_MS) },
  } as never)
    .sort({ dueAt: 1 })
    .limit(batchSize);

  let notified = 0;
  for (const task of candidates) {
    try {
      await runUnitOfWork(async (uow) => {
        const flagged = await Task.updateOne(
          { _id: task._id, overdueNotifiedAt: null, dueAt: task.dueAt, status: { $in: OPEN }, deletedAt: null } as never,
          { $set: { overdueNotifiedAt: now } },
          { session: uow.session, timestamps: false },
        );
        if (flagged.modifiedCount !== 1) return; // changed meanwhile, or another worker got it
        uow.onRollback(() => Task.updateOne({ _id: task._id }, { $set: { overdueNotifiedAt: null } }, { timestamps: false }));

        const recipient = String(task.assignedTo ?? task.createdBy);
        if (!(await isActiveMember(task.organizationId, recipient, uow.session))) return;
        const created = await createNotification(
          {
            organizationId: task.organizationId,
            recipientUserId: recipient,
            type: 'TASK_OVERDUE',
            title: `Overdue: ${task.title}`,
            message: `The task "${task.title}" is past its due date.`,
            relatedEntityType: task.relatedEntityType,
            relatedEntityId: task.relatedEntityId,
            taskId: task._id,
            deliveryKey: `task-overdue:${task._id}:${task.dueAt!.getTime()}:${recipient}`,
          },
          uow.session,
        );
        if (created) notified += 1;
      });
    } catch (err) {
      logger.error({ err, taskId: String(task._id) }, 'overdue notification failed');
    }
  }
  return { notified };
}

export async function runReminderCycle(options: ProcessOptions = {}) {
  const reminders = await processDueReminders(options);
  const overdue = await processOverdueNotifications(options);
  return { reminders, overdue };
}