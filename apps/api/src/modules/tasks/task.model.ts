import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import {
  REMINDER_STATUSES, TASK_PRIORITIES, TASK_RELATED_ENTITY_TYPES, TASK_STATUSES, TASK_TYPES,
} from '../../constants';
import { FAR_FUTURE, TASK_PRIORITY_RANK } from './task.lifecycle';

const text = (max: number) => ({ type: String, trim: true, maxlength: max });

const taskSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: text(5000),
    taskType: { type: String, enum: TASK_TYPES, default: 'GENERAL' },
    status: { type: String, enum: TASK_STATUSES, default: 'TODO' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'MEDIUM' },
    dueAt: { type: Date, default: null },
    reminderAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // One polymorphic link instead of four duplicate relatedXxxId columns.
    relatedEntityType: { type: String, enum: [...TASK_RELATED_ENTITY_TYPES, null], default: null },
    relatedEntityId: { type: Schema.Types.ObjectId, default: null },
    tags: { type: [String], default: [] },

    // ---- reminder delivery state (database-backed, restart-safe) ----
    reminderStatus: { type: String, enum: REMINDER_STATUSES, default: 'NONE' },
    /** Bumped every time a reminder is (re)armed or cancelled. Part of the notification delivery key. */
    reminderVersion: { type: Number, default: 0 },
    reminderNextAttemptAt: { type: Date, default: null },
    reminderAttempts: { type: Number, default: 0 },
    reminderLockedAt: { type: Date, default: null },
    reminderLockedBy: { type: String, default: null },
    reminderDeliveredAt: { type: Date, default: null },
    reminderLastError: text(300),
    overdueNotifiedAt: { type: Date, default: null },

    // ---- internal, never serialized ----
    priorityRank: { type: Number, default: 2 },
    dueSortAt: { type: Date, default: FAR_FUTURE },
    searchKeywords: { type: [String], default: [], select: false },

    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

taskSchema.pre('validate', function () {
  this.set('priorityRank', TASK_PRIORITY_RANK[String(this.get('priority'))] ?? 2);
  this.set('dueSortAt', (this.get('dueAt') as Date | null) ?? FAR_FUTURE);
  const words = new Set<string>();
  const add = (s: unknown) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).forEach((w) => words.add(w));
  add(this.get('title'));
  for (const tag of (this.get('tags') as string[] | undefined) ?? []) add(tag);
  this.set('searchKeywords', [...words].slice(0, 30));
});

taskSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
taskSchema.index({ organizationId: 1, deletedAt: 1, dueSortAt: 1 });
taskSchema.index({ organizationId: 1, deletedAt: 1, status: 1, dueAt: 1 });
taskSchema.index({ organizationId: 1, assignedTo: 1, status: 1, dueAt: 1 });
taskSchema.index({ organizationId: 1, createdBy: 1, status: 1 });
taskSchema.index({ organizationId: 1, status: 1, priority: 1 });
taskSchema.index({ organizationId: 1, relatedEntityType: 1, relatedEntityId: 1 });
taskSchema.index({ organizationId: 1, reminderAt: 1 });
taskSchema.index({ organizationId: 1, searchKeywords: 1 });
// Reminder worker queries
taskSchema.index({ reminderStatus: 1, reminderNextAttemptAt: 1 });
taskSchema.index({ reminderStatus: 1, reminderLockedAt: 1 });
taskSchema.index({ overdueNotifiedAt: 1, dueAt: 1 });
taskSchema.index({ organizationId: 1, deletedAt: 1, status: 1, completedAt: -1 });
taskSchema.index({ organizationId: 1, deletedAt: 1, assignedTo: 1, dueAt: 1 });

export type TaskDoc = HydratedDocument<InferSchemaType<typeof taskSchema>>;
export const Task = model('Task', taskSchema);