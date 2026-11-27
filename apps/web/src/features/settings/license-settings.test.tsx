import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { licenseService } from '@/services/license-service';
import { renderWithProviders } from '@/test/utils';
import type { LicenseOverview } from '@/types/license';
import { LicenseSettings } from './license-settings';

vi.mock('@/services/license-service', () => ({ licenseService: { status: vi.fn(), current: vi.fn(), activate: vi.fn(), deactivate: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: (p: string) => permissions.includes(p) }) }));

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const KEY = `EF1.${'a'.repeat(40)}.${'b'.repeat(40)}`;

const overview = (over: Partial<LicenseOverview> = {}): LicenseOverview => ({
  configured: true,
  state: 'ACTIVE',
  edition: 'PROFESSIONAL',
  features: { analytics: true, csvExport: false, automations: true, advancedNotifications: false },
  limits: { members: 15, leads: 100, properties: null, deals: 50 },
  validUntil: day(200),
  graceEndsAt: day(214),
  license: { licensee: 'Awan Properties', keyLast4: '7K2Q', issuedAt: day(-30), activatedAt: day(-29), expiresAt: day(200), status: 'ACTIVE' },
  usage: [
    { key: 'members', used: 3, limit: 15, remaining: 12, atLimit: false, overLimit: false },
    { key: 'leads', used: 100, limit: 100, remaining: 0, atLimit: true, overLimit: false },
    { key: 'properties', used: 40, limit: null, remaining: null, atLimit: false, overLimit: false },
    { key: 'deals', used: 60, limit: 50, remaining: 0, atLimit: true, overLimit: true },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['license:read', 'license:manage'];
  vi.mocked(licenseService.current).mockResolvedValue(overview());
});

describe('LicenseSettings', () => {
  it('shows the license, usage against each limit and the included features', async () => {
    renderWithProviders(<LicenseSettings />);
    expect(await screen.findByText('Awan Properties')).toBeInTheDocument();
    expect(screen.getByText('PROFESSIONAL')).toBeInTheDocument();
    expect(screen.getByText('••••7K2Q')).toBeInTheDocument();
    expect(screen.getByText('3 of 15')).toBeInTheDocument();
    expect(screen.getByText('40 of Unlimited')).toBeInTheDocument();
    expect(screen.getByText('Limit reached.')).toBeInTheDocument();
    expect(screen.getByText(/Over the limit/)).toBeInTheDocument();
    expect(screen.getByText(/Analytics/)).toHaveTextContent('(included)');
    expect(screen.getByText(/CSV export/)).toHaveTextContent('(not included)');
  });

  it('never shows the full key anywhere', async () => {
    renderWithProviders(<LicenseSettings />);
    await screen.findByText('Awan Properties');
    expect(document.body.textContent).not.toContain('EF1.');
  });

  it('activates a pasted key and confirms', async () => {
    vi.mocked(licenseService.activate).mockResolvedValue(overview());
    renderWithProviders(<LicenseSettings />);
    await userEvent.type(await screen.findByLabelText('License key'), KEY);
    await userEvent.click(screen.getByRole('button', { name: /Activate/ }));
    await waitFor(() => expect(licenseService.activate).toHaveBeenCalledWith(KEY));
    expect(toast.success).toHaveBeenCalledWith('License activated');
  });

  it('rejects a too-short key without calling the server', async () => {
    renderWithProviders(<LicenseSettings />);
    await userEvent.type(await screen.findByLabelText('License key'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /Activate/ }));
    expect(await screen.findByText('Paste the full license key')).toBeInTheDocument();
    expect(licenseService.activate).not.toHaveBeenCalled();
  });

  it('shows the server message next to the field when a key is refused', async () => {
    vi.mocked(licenseService.activate).mockRejectedValue(
      new ApiError(409, 'LICENSE_ALREADY_USED', 'This license key is already used by another organization.'),
    );
    renderWithProviders(<LicenseSettings />);
    await userEvent.type(await screen.findByLabelText('License key'), KEY);
    await userEvent.click(screen.getByRole('button', { name: /Activate/ }));
    expect(await screen.findByText('This license key is already used by another organization.')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('asks before deactivating, then deactivates', async () => {
    vi.mocked(licenseService.deactivate).mockResolvedValue(overview({ state: 'INACTIVE' }));
    renderWithProviders(<LicenseSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate license' }));
    expect(licenseService.deactivate).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(licenseService.deactivate).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('License deactivated');
  });

  it('explains when the server cannot activate licenses and disables the form', async () => {
    vi.mocked(licenseService.current).mockResolvedValue(overview({ configured: false, license: null, state: 'NONE', edition: null }));
    renderWithProviders(<LicenseSettings />);
    expect(await screen.findByText(/LICENSE_PUBLIC_KEY/)).toBeInTheDocument();
    expect(screen.getByLabelText('License key')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Activate/ })).toBeDisabled();
  });

  it('is read-only without license:manage', async () => {
    permissions = ['license:read'];
    renderWithProviders(<LicenseSettings />);
    await screen.findByText('Awan Properties');
    expect(screen.queryByLabelText('License key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate license' })).not.toBeInTheDocument();
  });
});