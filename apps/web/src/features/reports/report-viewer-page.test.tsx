import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { reportService } from '@/services/analytics-service';
import { renderWithProviders } from '@/test/utils';
import type { ReportDefinition } from '@/types/analytics';
import { makeMeta } from '../analytics/analytics-test-utils';
import { ReportViewerPage } from './report-viewer-page';

const auth = vi.hoisted(() => ({ allowed: new Set<string>() }));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    can: (p: string) => auth.allowed.has(p),
    activeMembership: {
      organization: {
        timezone: 'Asia/Karachi',
        currency: 'USD',
      },
    },
  }),
}));

// Mock license feature entitlement for CSV exports
vi.mock('@/features/license/use-license', () => ({
  useFeature: () => ({ allowed: true }),
}));

vi.mock('@/services/analytics-service', () => ({
  analyticsService: {},
  reportService: {
    catalog: vi.fn(),
    run: vi.fn(),
    exportCsv: vi.fn(),
  },
}));

vi.mock('@/services/lead-service', async (orig) => ({
  ...(await orig<object>()),
  leadService: {
    members: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const def: ReportDefinition = {
  id: 'lead-performance',
  title: 'Lead Performance Report',
  description: 'Leads created in the period.',
  usesDateRange: true,
  filters: ['leadSource', 'status', 'assignedTo'],
  statuses: ['NEW', 'QUALIFIED'],
  canExport: true,
  columns: [
    { key: 'name', label: 'Lead', type: 'text' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'value', label: 'Value', type: 'money' },
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'rate', label: 'Rate', type: 'percent' },
    { key: 'createdAt', label: 'Created', type: 'date' },
  ],
  sortable: ['createdAt', 'name'],
  defaultSort: { key: 'createdAt', order: 'desc' },
};

const result = (
  rows: Array<Record<string, string | number | null>>,
  total = rows.length,
) => ({
  data: {
    columns: def.columns,
    rows,
    summary: {
      newLeads: rows.length,
      conversionRate: 20,
    },
  },
  meta: {
    page: 1,
    limit: 20,
    total,
    totalPages: Math.max(1, Math.ceil(total / 20)),
    report: {
      id: def.id,
      title: def.title,
      usesDateRange: true,
    },
    dateRange: {
      from: '2026-10-17',
      to: '2026-11-15',
      timezone: 'Asia/Karachi',
    },
    sort: {
      key: 'createdAt',
      order: 'desc' as const,
    },
    scope: 'organization' as const,
    generatedAt: makeMeta().generatedAt,
  },
});

const row = {
  name: 'Olivia Bennett',
  source: 'WEBSITE',
  value: 250000,
  currency: 'USD',
  rate: 66.7,
  createdAt: '2026-11-01',
};

const render = (qs = '') =>
  renderWithProviders(
    <ReportViewerPage />,
    {
      route: `/app/reports/lead-performance${qs}`,
      path: '/app/reports/:reportId',
    },
  );

beforeEach(() => {
  vi.clearAllMocks();

  auth.allowed = new Set(['reports:read', 'reports:export']);

  vi.mocked(reportService.catalog).mockResolvedValue([def]);
  vi.mocked(reportService.run).mockResolvedValue(result([row], 45));

  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('ReportViewerPage', () => {
  it('renders the table with formatted cells', async () => {
    render();

    expect(await screen.findByText('Olivia Bennett')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('$250,000.00')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
    expect(screen.getByText('Nov 1, 2026')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–20 of 45/)).toBeInTheDocument();
  });

  it('sends only supported filters, with the date range and pagination', async () => {
    render('?status=QUALIFIED&leadSource=WEBSITE&dealType=SALE');

    await screen.findByText('Olivia Bennett');

    const params = vi.mocked(reportService.run).mock.calls[0]![1];

    expect(params).toMatchObject({
      period: '30d',
      status: 'QUALIFIED',
      leadSource: 'WEBSITE',
      page: 1,
      limit: 20,
    });

    expect(params).not.toHaveProperty('dealType');
  });

  it('paginates and sorts through the API', async () => {
    render();

    await userEvent.click(await screen.findByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(reportService.run).toHaveBeenLastCalledWith(
        'lead-performance',
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Lead' }));

    await waitFor(() =>
      expect(reportService.run).toHaveBeenLastCalledWith(
        'lead-performance',
        expect.objectContaining({
          sortBy: 'name',
          sortOrder: 'asc',
          page: 1,
        }),
        expect.anything(),
      ),
    );
  });

  it('shows an empty state', async () => {
    vi.mocked(reportService.run).mockResolvedValue(result([], 0));

    render();

    expect(
      await screen.findByText('No rows match these filters'),
    ).toBeInTheDocument();
  });

  it('exports the whole filtered dataset (no page/limit) and downloads it', async () => {
    vi.mocked(reportService.exportCsv).mockResolvedValue(new Blob(['a,b']));

    render('?status=QUALIFIED');

    await screen.findByText('Olivia Bennett');

    await userEvent.click(
      screen.getByRole('button', { name: /export csv/i }),
    );

    await waitFor(() => expect(reportService.exportCsv).toHaveBeenCalled());

    const params = vi.mocked(reportService.exportCsv).mock.calls[0]![1];

    expect(params).toMatchObject({
      status: 'QUALIFIED',
      period: '30d',
    });

    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('limit');

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    expect(toast.success).toHaveBeenCalled();
  });

  it('reports an export failure clearly', async () => {
    vi.mocked(reportService.exportCsv).mockRejectedValue(
      new ApiError(
        422,
        'EXPORT_TOO_LARGE',
        'This report has 60000 rows. Narrow the filters.',
      ),
    );

    render();

    await screen.findByText('Olivia Bennett');

    await userEvent.click(
      screen.getByRole('button', { name: /export csv/i }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This report has 60000 rows. Narrow the filters.',
      ),
    );

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('hides export without reports:export', async () => {
    auth.allowed = new Set(['reports:read']);

    render();

    await screen.findByText('Olivia Bennett');

    expect(
      screen.queryByRole('button', { name: /export csv/i }),
    ).not.toBeInTheDocument();
  });
});