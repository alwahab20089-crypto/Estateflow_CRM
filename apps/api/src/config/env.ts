import 'dotenv/config';
import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');
const duration = z.string().regex(/^\d+(s|m|h|d)$/, 'use a duration like 15m, 12h or 7d');
/** `KEY=` in an .env file arrives as an empty string: treat it as "not set". Values are trimmed. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a MongoDB connection string'),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
    JWT_REFRESH_EXPIRES_IN: duration.default('7d'),
    FRONTEND_URL: z
      .string()
      .min(1)
      .refine((v) => v.split(',').every((s) => URL.canParse(s.trim())), 'must be one or more comma-separated URLs'),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : undefined)),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    LOGIN_FAILURE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    REMINDER_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    REMINDER_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(60_000),
    REMINDER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    REMINDER_LOCK_LEASE_MS: z.coerce.number().int().min(60_000).default(300_000),

    // Phase 9: workflow automation
    AUTOMATION_ENGINE_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    AUTOMATION_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    AUTOMATION_MAX_DEPTH: z.coerce.number().int().min(1).max(10).default(3),
    EMAIL_PROVIDER: z.enum(['disabled', 'log', 'memory']).default('disabled'),

    // Phase 10: SaaS billing. The provider is chosen here, on the server, and never by a request.
    BILLING_PROVIDER: z.enum(['none', 'mock', 'paddle']).default('none'),
    PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    PADDLE_API_KEY: optionalString,
    /** Public by design (Paddle.js runs in the browser). It is still served by the API, never baked into the web build. */
    PADDLE_CLIENT_TOKEN: optionalString,
    /** The notification destination's secret key (starts with pdl_ntfset_). */
    PADDLE_WEBHOOK_SECRET: optionalString,
    /** Max clock difference accepted for the webhook timestamp. 0 disables the check (the signature is still verified). */
    PADDLE_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  })
  .refine((v) => v.JWT_ACCESS_SECRET !== v.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    path: ['JWT_REFRESH_SECRET'],
  })
  .superRefine((v, ctx) => {
    // Messages name the variable and the rule only. Values (keys, secrets) are never echoed.
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (v.BILLING_PROVIDER === 'mock' && v.NODE_ENV === 'production') {
      bad('BILLING_PROVIDER', 'the mock provider is not allowed in production');
    }

    if (v.BILLING_PROVIDER === 'paddle') {
      for (const k of ['PADDLE_API_KEY', 'PADDLE_CLIENT_TOKEN', 'PADDLE_WEBHOOK_SECRET'] as const) {
        if (!v[k]) bad(k, 'required when BILLING_PROVIDER=paddle');
      }
      const sandbox = v.PADDLE_ENVIRONMENT === 'sandbox';
      if (v.PADDLE_API_KEY) {
        const prefix = sandbox ? 'pdl_sdbx_apikey_' : 'pdl_live_apikey_';
        if (!v.PADDLE_API_KEY.startsWith(prefix)) {
          bad('PADDLE_API_KEY', `must start with ${prefix} when PADDLE_ENVIRONMENT=${v.PADDLE_ENVIRONMENT}`);
        }
      }
      if (v.PADDLE_WEBHOOK_SECRET && !v.PADDLE_WEBHOOK_SECRET.startsWith('pdl_ntfset_')) {
        bad('PADDLE_WEBHOOK_SECRET', 'must be a notification destination secret key (starts with pdl_ntfset_)');
      }
      if (v.PADDLE_CLIENT_TOKEN) {
        // Paddle documents the sandbox prefix (test_) but not the live one, so live is only checked for "not a sandbox token".
        if (sandbox && !v.PADDLE_CLIENT_TOKEN.startsWith('test_')) {
          bad('PADDLE_CLIENT_TOKEN', 'a sandbox client-side token starts with test_');
        }
        if (!sandbox && v.PADDLE_CLIENT_TOKEN.startsWith('test_')) {
          bad('PADDLE_CLIENT_TOKEN', 'this is a sandbox token but PADDLE_ENVIRONMENT=production');
        }
      }
      if (sandbox && v.NODE_ENV === 'production') {
        bad('PADDLE_ENVIRONMENT', 'production deployments must use PADDLE_ENVIRONMENT=production');
      }
    }

    
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Only variable names and rules are printed, never values.
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';