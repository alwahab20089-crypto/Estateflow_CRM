import { env } from '../../../config/env';
import type { BillingProvider } from './billing-provider';
import { createMockBillingProvider } from './mock.provider';
import { createPaddleProvider } from './paddle.provider';

let cached: BillingProvider | null | undefined;

/** The provider is chosen by server configuration only. Nothing in a request can select or switch it. */
export function getBillingProvider(): BillingProvider | null {
  if (cached !== undefined) return cached;
  if (env.BILLING_PROVIDER === 'paddle') {
    // env.ts guarantees these are present and correctly prefixed when BILLING_PROVIDER=paddle.
    cached = createPaddleProvider({
      apiKey: env.PADDLE_API_KEY!,
      clientToken: env.PADDLE_CLIENT_TOKEN!,
      webhookSecret: env.PADDLE_WEBHOOK_SECRET!,
      environment: env.PADDLE_ENVIRONMENT,
      toleranceSeconds: env.PADDLE_WEBHOOK_TOLERANCE_SECONDS,
    });
  } else if (env.BILLING_PROVIDER === 'mock' && env.NODE_ENV !== 'production') {
    cached = createMockBillingProvider();
  } else {
    cached = null;
  }
  return cached;
}

/** The webhook path segment must equal the configured provider's name, otherwise the route answers 404. */
export const resolveProvider = (name: string) => {
  const p = getBillingProvider();
  return p && p.name === name && p.isConfigured() ? p : null;
};

export const setBillingProviderForTests = (p: BillingProvider | null | undefined) => {
  cached = p;
};