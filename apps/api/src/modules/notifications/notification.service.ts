
import { Types, type ClientSession } from 'mongoose';
import {
  TASK_RELATED_ENTITY_TYPES,
  type NotificationType,
} from '../../constants';
import { AppError } from '../../utils/app-error';
import type { TenantContext } from '../members/member.service';
import { Notification } from './notification.model';
import type { ListNotificationsQuery } from './notification.validation';

type Id = string | Types.ObjectId;

export type RelatedEntityType =
  | (typeof TASK_RELATED_ENTITY_TYPES)[number]
  | null;

const oid = (v: Id) => new Types.ObjectId(String(v));

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export interface NewNotification {
  organizationId: Id;
  recipientUserId: Id;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: RelatedEntityType;
  relatedEntityId?: Id | null;
  taskId?: Id | null;
  /** Set for events that must be delivered at most once. */
  deliveryKey?: string;
}

/**
 * Creates a notification. With a deliveryKey it is idempotent: an upsert
 * on (organizationId, deliveryKey), backed by a unique partial index.
 * Returns true only if THIS call created it.
 *
 * An upsert is used instead of insert + catch(11000) because a duplicate-key
 * error aborts a MongoDB transaction.
 */
export async function createNotification(
  input: NewNotification,
  session?: ClientSession,
): Promise<boolean> {
  const fields = {
    recipientUserId: input.recipientUserId,
    type: input.type,
    title: clip(input.title, 200),
    message: clip(input.message, 500),
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    taskId: input.taskId ?? null,
    isRead: false,
    readAt: null,
    deletedAt: null,
  };

  if (!input.deliveryKey) {
    await Notification.create(
      [{ organizationId: input.organizationId, ...fields }],
      session ? { session } : {},
    );

    return true;
  }

  const res = await Notification.updateOne(
    {
      organizationId: input.organizationId,
      deliveryKey: input.deliveryKey,
    },
    { $setOnInsert: fields },
    { upsert: true, ...(session ? { session } : {}) },
  );

  return res.upsertedCount > 0;
}

/**
 * Every query is pinned to the verified organization AND the calling user:
 * other members' notifications do not exist for you.
 */
const ownScope = (tenant: TenantContext, userId: string) => ({
  organizationId: oid(tenant.organizationId),
  recipientUserId: oid(userId),
  deletedAt: null,
});

interface NotificationLike {
  _id: Id;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string | null;
  relatedEntityId?: Id | null;
  taskId?: Id | null;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
}

export const toNotificationDto = (n: NotificationLike) => ({
  _id: String(n._id),
  type: n.type,
  title: n.title,
  message: n.message,
  relatedEntityType: n.relatedEntityType ?? null,
  relatedEntityId: n.relatedEntityId ? String(n.relatedEntityId) : null,
  taskId: n.taskId ? String(n.taskId) : null,
  isRead: n.isRead,
  readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
  createdAt: new Date(n.createdAt).toISOString(),
});

export async function listNotifications(
  tenant: TenantContext,
  userId: string,
  q: ListNotificationsQuery,
) {
  const filter = {
    ...ownScope(tenant, userId),
    ...(q.unread ? { isRead: false } : {}),
  };

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({
      ...ownScope(tenant, userId),
      isRead: false,
    }),
  ]);

  return {
    items: items.map((n) =>
      toNotificationDto(n as unknown as NotificationLike),
    ),
    meta: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      unreadCount,
    },
  };
}

export const unreadCount = (tenant: TenantContext, userId: string) =>
  Notification.countDocuments({
    ...ownScope(tenant, userId),
    isRead: false,
  });

async function findOwn(
  tenant: TenantContext,
  userId: string,
  id: string,
) {
  const n = await Notification.findOne({
    ...ownScope(tenant, userId),
    _id: oid(id),
  });

  if (!n) {
    throw AppError.notFound('Notification not found');
  }

  return n;
}

export async function markRead(
  tenant: TenantContext,
  userId: string,
  id: string,
) {
  const n = await findOwn(tenant, userId, id);

  if (!n.isRead) {
    n.isRead = true;
    n.readAt = new Date();
    await n.save();
  }

  return toNotificationDto(n as unknown as NotificationLike);
}

export async function markAllRead(
  tenant: TenantContext,
  userId: string,
) {
  const res = await Notification.updateMany(
    {
      ...ownScope(tenant, userId),
      isRead: false,
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
      },
    },
  );

  return { updated: res.modifiedCount };
}

export async function removeNotification(
  tenant: TenantContext,
  userId: string,
  id: string,
) {
  const n = await findOwn(tenant, userId, id);

  n.set('deletedAt', new Date());
  await n.save();
}
