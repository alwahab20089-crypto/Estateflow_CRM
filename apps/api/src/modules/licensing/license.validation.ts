import { z } from 'zod';

export const activateLicenseSchema = z.object({ licenseKey: z.string().trim().min(20).max(4000) }).strict();