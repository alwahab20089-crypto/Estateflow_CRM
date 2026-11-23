import type { IncomingHttpHeaders } from 'node:http';
import type { BillingInterval, SubscriptionStatus } from '../../../constants';

export class BillingProviderError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
export class InvalidSignatureError extends Error {}

export interface NormalizedSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  providerVariantId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date | null;
  updatedAt: Date; // the provider's last-modified time: orders events that arrive out of sequence
  customData: Record<string, unknown>;
}

export type ParsedWebhook =
  | { kind: 'subscription'; eventId: string; eventType: string; subscription: NormalizedSubscription }
  | { kind: 'invoice'; eventId: string; eventType: string; providerSubscriptionId: string; outcome: 'FAILED' | 'PAID' | 'OTHER'; occurredAt: Date; customData: Record<string, unknown> }
  | { kind: 'other'; eventId: string; eventType: string };

/** Everything provider-specific stays behind this interface. Adding a provider means adding one adapter. */
export interface BillingProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(i: { organizationId: string; subscriptionRef: string; email: string; variantId: string; redirectUrl: string }): Promise<{ url: string; providerCheckoutId?: string; expiresAt?: Date }>;
  retrieveSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  cancelSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  resumeSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  changePlan(providerSubscriptionId: string, variantId: string): Promise<NormalizedSubscription>;
  getPortalUrl(providerSubscriptionId: string): Promise<string>;
  /** Throws InvalidSignatureError. Must be called with the exact raw bytes received. */
  verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): void;
  parseWebhook(rawBody: Buffer): ParsedWebhook;
}

export const intervalOf = (i: string): BillingInterval => (i === 'YEAR' ? 'YEAR' : 'MONTH');