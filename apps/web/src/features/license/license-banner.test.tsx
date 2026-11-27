import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { licenseService } from '@/services/license-service';
import { renderWithProviders } from '@/test/utils';
import type { LicenseStatus } from '@/types/license';
import { FeatureGate } from './feature-gate';
import { LicenseBanner } from './license-banner';

vi.mock('@/services/license-service', () => ({ licenseService: { status: vi.fn(), current: vi.fn(), activate: vi.fn(), deactivate: vi.fn() } }));

let permissions: string[] = [];
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: (p: string) => permissions.includes(p) }) }));

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const status = (over: Partial<LicenseStatus> = {}): LicenseStatus => ({
  state: 'ACTIVE',
  edition: 'PROFESSIONAL',
  features: { analytics: true, csvExport: true, automations: true, advancedNotifications: true },
  limits: { members: 15, leads: 100, properties: 100, deals: 100 },
  validUntil: day(300),
  graceEndsAt: day(314),
  usage: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  permissions = [];
});

describe('LicenseBanner', () => {
  it('shows nothing for a healthy license', async () => {
    vi.mocked(licenseService.status).mockResolvedValue(status());
    renderWithProviders(<LicenseBanner />);
    await vi.waitFor(() => expect(licenseService.status).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tells the owner of a new install to activate, with a link to the License tab', async () => {
    permissions = ['license:manage'];
    vi.mocked(licenseService.status).mockResolvedValue(status({ state: 'NONE', edition: null, validUntil: null, graceEndsAt: null }));
    renderWithProviders(<LicenseBanner />);
    expect(await screen.findByText('Activate your license to get started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage license' })).toHaveAttribute('href', '/app/settings?tab=license');
  });

  it('tells a member the same problem without offering the fix', async () => {
    vi.mocked(licenseService.status).mockResolvedValue(status({ state: 'EXPIRED' }));
    renderWithProviders(<LicenseBanner />);
    expect(await screen.findByText('Your license has expired')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage license' })).not.toBeInTheDocument();
  });

  it('shows nothing when the status cannot be loaded', async () => {
    vi.mocked(licenseService.status).mockRejectedValue(new Error('offline'));
    renderWithProviders(<LicenseBanner />);
    await vi.waitFor(() => expect(licenseService.status).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('FeatureGate', () => {
  const renderGate = () =>
    renderWithProviders(
      <FeatureGate feature="analytics" title="Analytics">
        <p>secret charts</p>
      </FeatureGate>,
    );

  it('mounts the page only when the feature is licensed', async () => {
    vi.mocked(licenseService.status).mockResolvedValue(status());
    renderGate();
    expect(await screen.findByText('secret charts')).toBeInTheDocument();
  });

  it('shows a locked message instead of the page, and never mounts the children', async () => {
    permissions = ['license:manage'];
    vi.mocked(licenseService.status).mockResolvedValue(
      status({ features: { analytics: false, csvExport: true, automations: true, advancedNotifications: true } }),
    );
    renderGate();
    expect(await screen.findByText("Analytics isn't available")).toBeInTheDocument();
    expect(screen.queryByText('secret charts')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage license' })).toBeInTheDocument();
  });

  it('lets the server decide when the status cannot be loaded', async () => {
    vi.mocked(licenseService.status).mockRejectedValue(new Error('offline'));
    renderGate();
    expect(await screen.findByText('secret charts')).toBeInTheDocument();
  });
});