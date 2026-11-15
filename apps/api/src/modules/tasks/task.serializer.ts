import type { Types } from 'mongoose';
import type { UserBrief } from '../leads/lead.serializer';
import { isOpenTask } from './task.lifecycle';

type Id = Types.ObjectId | string;
const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

export interface TaskLike {
  _id: Id; title: string; description?: string | null; taskType: string; status: string; priority: string;
  dueAt?: Date | null; reminderAt?: Date | null; completedAt?: Date | null; assignedTo?: Id | null; createdBy: Id;
  relatedEntityType?: string | null; relatedEntityId?: Id | null; tags?: string[] | null;
  reminderStatus?: string | null; reminderDeliveredAt?: Date | null;
  deletedAt?: Date | null; createdAt: Date; updatedAt: Date;
}

export interface TaskBriefs {
  assignee: UserBrief | null;
  creator: UserBrief | null;
  related: { type: string; _id: string; label: string } | null;
}

const brief = (u: UserBrief | null) =>
  u ? { _id: String(u._id), name: u.name, email: u.email, avatar: u.avatar ?? undefined } : null;

/** Explicit allow-list: organizationId, lock fields, searchKeywords and ranks never leave the API. All dates are UTC ISO strings. */
export function toTaskDto(t: TaskLike, b: TaskBriefs) {
  return {
    _id: String(t._id),
    title: t.title,
    description: t.description ?? null,
    taskType: t.taskType,
    status: t.status,
    priority: t.priority,
    dueAt: iso(t.dueAt),
    reminderAt: iso(t.reminderAt),
    reminderStatus: t.reminderStatus ?? 'NONE',
    reminderDeliveredAt: iso(t.reminderDeliveredAt),
    completedAt: iso(t.completedAt),
    isOverdue: isOpenTask(t.status) && Boolean(t.dueAt) && new Date(t.dueAt!).getTime() < Date.now(),
    assignedTo: t.assignedTo ? String(t.assignedTo) : null,
    assignee: brief(b.assignee),
    createdBy: String(t.createdBy),
    creator: brief(b.creator),
    relatedEntityType: t.relatedEntityType ?? null,
    relatedEntityId: t.relatedEntityId ? String(t.relatedEntityId) : null,
    related: b.related,
    tags: t.tags ?? [],
    deletedAt: iso(t.deletedAt),
    createdAt: iso(t.createdAt)!,
    updatedAt: iso(t.updatedAt)!,
  };
}