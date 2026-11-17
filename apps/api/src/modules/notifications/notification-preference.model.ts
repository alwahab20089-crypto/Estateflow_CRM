import { model, Schema } from 'mongoose';

const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** { [NotificationType]: { inApp?: boolean, email?: boolean } }. Missing = default (enabled). */
    preferences: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);
schema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const NotificationPreference = model('NotificationPreference', schema);