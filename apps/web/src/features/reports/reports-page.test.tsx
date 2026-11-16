import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportService } from '@/services/analytics-service';
import { renderWithProviders } from '@/test/utils';
import { ReportsPage } from './reports-page';

const auth = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: (p: string) => auth.allowed.has(p), activeMembership: null }) }));
vi.mock('@/services/analytics-service', () => ({ analyticsService: {}, reportService: { catalog: vi.fn(), run: vi.fn(), exportCsv: vi.fn() } }));

const base = { description: 'd', filters: [], statuses: null, columns: [], sortable: [], defaultSort: { key: 'a', order: 'asc' as const } };
beforeEach(() => {
  vi.clearAllMocks();
  auth.allowed = new Set(['reports:read']);
});

describe('ReportsPage', () => {
  it('lists only the reports the API returns, with links', async () => {
    vi.mocked(reportService.catalog).mockResolvedValue([
      { ...base, id: 'lead-performance', title: 'Lead Performance Report', usesDateRange: true, canExport: true },
      { ...base, id: 'property-inventory', title: 'Property Inventory Report', usesDateRange: false, canExport: false },
    ]);
    renderWithProviders(<ReportsPage />, { route: '/app/reports', path: '/app/reports' });
    expect(await screen.findByRole('link', { name: 'Lead Performance Report' })).toHaveAttribute('href', '/app/reports/lead-performance');
    expect(screen.getByText('Snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Agent Performance Report')).not.toBeInTheDocument();
  });

  it('shows no access without reports:read', async () => {
    auth.allowed = new Set();
    renderWithProviders(<ReportsPage />, { route: '/app/reports', path: '/app/reports' });
    expect(await screen.findByText(/don't have access to reports/i)).toBeInTheDocument();
    expect(reportService.catalog).not.toHaveBeenCalled();
  });
});