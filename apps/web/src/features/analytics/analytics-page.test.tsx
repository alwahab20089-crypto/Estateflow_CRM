import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsService } from '@/services/analytics-service';
import { renderWithProviders } from '@/test/utils';
import { AnalyticsPage } from './analytics-page';
import { leadsResult, overviewResult, trendsResult } from './analytics-test-utils';

const auth = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ can: (p: string) => auth.allowed.has(p), activeMembership: { organization: { timezone: 'Asia/Karachi', currency: 'USD' } } }),
}));
vi.mock('@/services/analytics-service', () => ({
  analyticsService: { overview: vi.fn(), leads: vi.fn(), deals: vi.fn(), properties: vi.fn(), team: vi.fn(), tasks: vi.fn(), revenue: vi.fn(), trends: vi.fn() },
  reportService: { catalog: vi.fn(), run: vi.fn(), exportCsv: vi.fn() },
}));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));

const render = () => renderWithProviders(<AnalyticsPage />, { route: '/app/analytics', path: '/app/analytics' });

beforeEach(() => {
  vi.clearAllMocks();
  auth.allowed = new Set(['analytics:read', 'leads:read', 'deals:read', 'tasks:read', 'properties:read']);
  vi.mocked(analyticsService.overview).mockResolvedValue(overviewResult());
  vi.mocked(analyticsService.trends).mockResolvedValue(trendsResult());
});

describe('AnalyticsPage', () => {
  it('renders KPI values with the right units and comparisons', async () => {
    render();
    const won = await screen.findByRole('group', { name: 'Won Deal Value' });
    expect(within(won).getByText('$12,500.00')).toBeInTheDocument();
    expect(within(won).getByText('Also: €500.00')).toBeInTheDocument();
    expect(within(won).getByText('25%')).toBeInTheDocument();

    const leads = screen.getByRole('group', { name: 'New Leads' });
    expect(within(leads).getByText('10')).toBeInTheDocument();
    expect(within(leads).getByText('vs 8 in the previous period')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Lead Conversion Rate' })).getByText('2.5 pts')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Won Deals' })).getByText('New — nothing in the previous period')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Total Leads' })).getByText('Current snapshot')).toBeInTheDocument();
    expect(analyticsService.overview).toHaveBeenCalledWith({ period: '30d' }, expect.anything());
  });

  it('refetches when the date range changes', async () => {
    render();
    await screen.findByRole('group', { name: 'Won Deal Value' });
    await userEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(analyticsService.overview).toHaveBeenLastCalledWith({ period: '90d' }, expect.anything()));
  });

  it('sends a valid custom range and blocks an invalid one', async () => {
    render();
    await screen.findByRole('group', { name: 'Won Deal Value' });
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() =>
      expect(analyticsService.overview).toHaveBeenLastCalledWith(
        { period: 'custom', from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2099-01-01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/must not be before/);
    expect(analyticsService.overview).not.toHaveBeenCalledWith(expect.objectContaining({ from: '2099-01-01' }), expect.anything());
  });

  it('shows an empty state when there are no metrics', async () => {
    vi.mocked(analyticsService.overview).mockResolvedValue(overviewResult([]));
    render();
    expect(await screen.findByText('No metrics available')).toBeInTheDocument();
  });

  it('shows an error state and recovers on retry', async () => {
    vi.mocked(analyticsService.overview).mockRejectedValue(new Error('boom'));
    render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    vi.mocked(analyticsService.overview).mockResolvedValue(overviewResult());
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('group', { name: 'Won Deal Value' })).toBeInTheDocument();
  });

  it('only shows sections the user may read', async () => {
    auth.allowed = new Set(['analytics:read', 'leads:read']);
    render();
    await screen.findByRole('group', { name: 'Won Deal Value' });
    expect(screen.getByRole('tab', { name: 'Leads' })).toBeInTheDocument();
    for (const name of ['Deals', 'Team', 'Tasks', 'Properties', 'Deal value']) expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
  });

  it('shows no access without analytics:read and makes no request', async () => {
    auth.allowed = new Set();
    render();
    expect(await screen.findByText(/don't have access to analytics/i)).toBeInTheDocument();
    expect(analyticsService.overview).not.toHaveBeenCalled();
  });

  it('renders lead charts with an accessible summary, and empty charts with a message', async () => {
    vi.mocked(analyticsService.leads).mockResolvedValue(leadsResult());
    render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Leads' }));
    expect(await screen.findByRole('img', { name: /Leads by status: New 5 \(50%\)/ })).toBeInTheDocument();
  });

  it('shows empty chart states for an empty dataset', async () => {
    vi.mocked(analyticsService.leads).mockResolvedValue(leadsResult(true));
    render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Leads' }));
    expect((await screen.findAllByText('No data for this period')).length).toBeGreaterThan(0);
  });
});