import { env } from '../config/env';
import { logger } from '../config/logger';

export interface EmailMessage { to: string; subject: string; text: string; idempotencyKey: string }
export interface EmailProvider { readonly name: string; send(message: EmailMessage): Promise<{ messageId: string }> }

/** In-memory outbox used by the `memory` provider (tests). */
export const outbox: EmailMessage[] = [];

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

// Only providers that can be verified without external credentials ship here. A real provider (SMTP, SES, ...)
// implements EmailProvider and is plugged in with setEmailProvider() at startup, with its own env validation.
const FACTORIES: Record<string, () => EmailProvider> = {
  disabled: () => ({ name: 'disabled', async send() { throw new Error('Email provider is disabled'); } }),
  log: () => ({
    name: 'log',
    async send(m) {
      logger.info({ to: mask(m.to), subject: m.subject, key: m.idempotencyKey }, 'email (log provider, body not logged)');
      return { messageId: `log:${m.idempotencyKey}` };
    },
  }),
  memory: () => ({ name: 'memory', async send(m) { outbox.push(m); return { messageId: `mem:${outbox.length}` }; } }),
};

let current: EmailProvider | null = null;
export const getEmailProvider = (): EmailProvider => (current ??= FACTORIES[env.EMAIL_PROVIDER]!());
export const setEmailProvider = (p: EmailProvider | null) => { current = p; };
export const emailEnabled = () => getEmailProvider().name !== 'disabled';