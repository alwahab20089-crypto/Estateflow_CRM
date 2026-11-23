import { afterEach, describe, expect, it, vi } from 'vitest';

const OFF = { BILLING_PROVIDER: 'none', PADDLE_ENVIRONMENT: 'sandbox', PADDLE_API_KEY: '', PADDLE_CLIENT_TOKEN: '', PADDLE_WEBHOOK_SECRET: '', PADDLE_WEBHOOK_TOLERANCE_SECONDS: '60' };
const SANDBOX = { ...OFF, BILLING_PROVIDER: 'paddle', PADDLE_API_KEY: 'pdl_sdbx_apikey_abc', PADDLE_CLIENT_TOKEN: 'test_abc', PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_abc' };
const LIVE = { ...OFF, BILLING_PROVIDER: 'paddle', PADDLE_ENVIRONMENT: 'production', PADDLE_API_KEY: 'pdl_live_apikey_abc', PADDLE_CLIENT_TOKEN: 'live_abc', PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_abc' };

/** Re-evaluates src/config/env.ts with the given variables. A rejected configuration exits the process, which is intercepted. */
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => { errors.push(String(m)); });
  vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
  try {
    const mod = await import('../src/config/env');
    return { ok: true as const, env: mod.env, errors };
  } catch (err) {
    if (!(err instanceof Error) || err.message !== 'process.exit') throw err;
    return { ok: false as const, errors };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('billing provider selection (BILLING_PROVIDER)', () => {
  it('accepts none, mock and paddle, and no longer accepts lemonsqueezy', async () => {
    expect((await loadEnv(OFF)).ok).toBe(true);
    expect((await loadEnv({ ...OFF, BILLING_PROVIDER: 'mock' })).ok).toBe(true);
    const paddle = await loadEnv(SANDBOX);
    expect(paddle.ok && paddle.env.BILLING_PROVIDER).toBe('paddle');
    const old = await loadEnv({ ...OFF, BILLING_PROVIDER: 'lemonsqueezy' });
    expect(old.ok).toBe(false);
    expect(old.errors.join('\n')).toContain('BILLING_PROVIDER');
  });

  it('refuses the mock provider in production and a production SaaS without a provider', async () => {
    const mock = await loadEnv({ ...OFF, BILLING_PROVIDER: 'mock', NODE_ENV: 'production' });
    expect(mock.ok).toBe(false);
    expect(mock.errors.join('\n')).toMatch(/mock provider is not allowed in production/);
    const none = await loadEnv({ ...OFF, NODE_ENV: 'production', DEPLOYMENT_MODE: 'SAAS' });
    expect(none.ok).toBe(false);
    expect(none.errors.join('\n')).toMatch(/needs a billing provider/);
  });
});

describe('Paddle credentials', () => {
  it('requires every credential and names the variables, never the values', async () => {
    const r = await loadEnv({ ...OFF, BILLING_PROVIDER: 'paddle' });
    expect(r.ok).toBe(false);
    const text = r.errors.join('\n');
    for (const name of ['PADDLE_API_KEY', 'PADDLE_CLIENT_TOKEN', 'PADDLE_WEBHOOK_SECRET']) expect(text).toContain(name);
  });

  it('treats empty .env lines as not set', async () => {
    const r = await loadEnv({ ...OFF, PADDLE_API_KEY: '   ' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.env.PADDLE_API_KEY).toBeUndefined();
  });

  it('sandbox configuration loads with the sandbox prefixes', async () => {
    const r = await loadEnv(SANDBOX);
    expect(r.ok && r.env).toMatchObject({ PADDLE_ENVIRONMENT: 'sandbox', PADDLE_WEBHOOK_TOLERANCE_SECONDS: 60 });
  });

  it('rejects a key from the wrong environment without printing it', async () => {
    const secret = 'pdl_live_apikey_SUPERSECRETVALUE';
    const r = await loadEnv({ ...SANDBOX, PADDLE_API_KEY: secret });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('PADDLE_API_KEY');
    expect(r.errors.join('\n')).not.toContain('SUPERSECRETVALUE');
    expect((await loadEnv({ ...LIVE, PADDLE_API_KEY: 'pdl_sdbx_apikey_abc' })).ok).toBe(false);
  });

  it('checks the webhook secret and client token prefixes', async () => {
    expect((await loadEnv({ ...SANDBOX, PADDLE_WEBHOOK_SECRET: 'whsec_abc' })).ok).toBe(false);
    expect((await loadEnv({ ...SANDBOX, PADDLE_CLIENT_TOKEN: 'live_abc' })).ok).toBe(false); // sandbox tokens start with test_
    expect((await loadEnv({ ...LIVE, PADDLE_CLIENT_TOKEN: 'test_abc' })).ok).toBe(false); // a sandbox token in production
  });

  it('allows production only with the production environment', async () => {
    expect((await loadEnv({ ...LIVE, NODE_ENV: 'production' })).ok).toBe(true);
    const r = await loadEnv({ ...SANDBOX, NODE_ENV: 'production' });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('PADDLE_ENVIRONMENT');
  });

  it('bounds the webhook tolerance and allows 0 to disable it', async () => {
    expect((await loadEnv({ ...SANDBOX, PADDLE_WEBHOOK_TOLERANCE_SECONDS: '0' })).ok).toBe(true);
    expect((await loadEnv({ ...SANDBOX, PADDLE_WEBHOOK_TOLERANCE_SECONDS: '4000' })).ok).toBe(false);
  });
});