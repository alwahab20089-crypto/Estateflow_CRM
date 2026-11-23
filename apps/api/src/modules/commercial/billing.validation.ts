import { z } from 'zod';
import { BILLING_INTERVALS } from '../../constants';

export const checkoutSchema = z.object({
  planSlug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  interval: z.enum(BILLING_INTERVALS),
}).strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;