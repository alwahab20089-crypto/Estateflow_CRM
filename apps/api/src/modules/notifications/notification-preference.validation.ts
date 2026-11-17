import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../../constants';

const item = z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean().optional(), email: z.boolean().optional() }).strict()
  .refine((v) => v.email === undefined || v.type === 'AUTOMATION', { message: 'Email can only be configured for automation notifications', path: ['email'] });

export const updatePreferencesSchema = z.object({ preferences: z.array(item).min(1).max(NOTIFICATION_TYPES.length) });