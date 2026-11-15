import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES, TASK_RELATED_ENTITY_TYPES } from '../../constants';

const notificationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    relatedEntityType: { type: String, enum: [...TASK_RELATED_ENTITY_TYPES, null], default: null },
    relatedEntityId: { type: Schema.Types.ObjectId, default: null },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    /** Idempotency key. Present only on notifications that must never be duplicated (reminders, overdue). */
    deliveryKey: { type: String, maxlength: 200 },
    /** Soft delete: keeps the delivery key so a dismissed reminder can never be re-created. */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ organizationId: 1, recipientUserId: 1, deletedAt: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, recipientUserId: 1, isRead: 1, deletedAt: 1 });
notificationSchema.index({ taskId: 1 });
notificationSchema.index(
  { organizationId: 1, deliveryKey: 1 },
  { unique: true, partialFilterExpression: { deliveryKey: { $type: 'string' } }, name: 'unique_delivery_key' },
);

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = model('Notification', notificationSchema);