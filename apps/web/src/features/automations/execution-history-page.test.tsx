
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationService } from '@/services/automation-service';
import type { ExecutionDto } from '@/types/automations';
import { renderWithProviders } from '../../test/utils';
import { ExecutionHistoryPage } from './execution-history-page';

const { perms } = vi.hoisted(() => ({
  perms: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('@/services/automation-service', () => ({
  automationService: {
    get: vi.fn(),
    executions: vi.fn(),
    execution: vi.fn(),
    retry: vi.fn(),
  },
  notificationPreferenceService: {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    can: (permission: string) => perms(permission),
  }),
}));

const exec = (o: Partial<ExecutionDto> = {}): ExecutionDto => ({
  _id: 'e1',
  workflowId: 'w1',
  workflowVersion: 2,
  triggerEventId: 'ev1',
  triggerType: 'LEAD_CREATED',
  status: 'PARTIALLY_FAILED',
  attemptCount: 3,
  maxAttempts: 3,
  retryCount: 0,
  startedAt: '2026-11-16T10:00:00.000Z',
  completedAt: '2026-11-16T10:05:00.000Z',
  nextRetryAt: null,
  errorSummary: 'SEND_EMAIL_NOTIFICATION: smtp down',
  createdAt: '2026-11-16T10:00:00.000Z',
  actions: [
    {
      type: 'CREATE_IN_APP_NOTIFICATION',
      recipient: { mode: 'ASSIGNEE' },
      title: 'Hi',
      message: 'm',
    },
    {
      type: 'SEND_EMAIL_NOTIFICATION',
      recipient: { mode: 'ASSIGNEE' },
      subject: 'Lead',
      body: 'b',
    },
  ],
  payload: { name: 'Olivia Bennett' },
  actionResults: [
    {
      index: 0,
      type: 'CREATE_IN_APP_NOTIFICATION',
      status: 'SUCCESS',
      attempts: 1,
      output: { created: true },
    },
    {
      index: 1,
      type: 'SEND_EMAIL_NOTIFICATION',
      status: 'FAILED',
      attempts: 3,
      error: 'smtp down',
      retryable: true,
    },
  ],
  ...o,
});

const page = (data: ExecutionDto[]) => ({
  data,
  meta: {
    page: 1,
    limit: 20,
    total: data.length,
    totalPages: 1,
  },
});

const render = () =>
  renderWithProviders(<ExecutionHistoryPage />, {
    route: '/app/automations/w1/executions',
    path: '/app/automations/:workflowId/executions',
  });

/**
 * Opens the actual execution table row.
 * Avoid findByText('Partially failed') because the status filter
 * contains an option with the same text.
 */
const openExecution = async (status: 'Partially failed' | 'Completed') => {
  const row = await screen.findByRole('row', {
    name: new RegExp(status, 'i'),
  });

  await userEvent.click(row);
};

beforeEach(() => {
  vi.clearAllMocks();
  perms.mockReturnValue(true);

  vi.mocked(automationService.get).mockResolvedValue({
    _id: 'w1',
    name: 'Follow up',
    status: 'ACTIVE',
    triggerType: 'LEAD_CREATED',
  } as never);
});

describe('ExecutionHistoryPage', () => {
  it('shows a failed execution with per-action results and delivery behaviour', async () => {
    vi.mocked(automationService.executions).mockResolvedValue(page([exec()]));
    vi.mocked(automationService.execution).mockResolvedValue(exec());

    render();

    await openExecution('Partially failed');

    const results = await screen.findByRole('region', {
      name: 'Action results',
    });

    expect(
      within(results).getByText('Notification delivered'),
    ).toBeInTheDocument();

    expect(
      within(results).getAllByText('smtp down').length,
    ).toBeGreaterThan(0);

    expect(
      within(results).getByText(/3 attempts/),
    ).toBeInTheDocument();

    expect(screen.getByText('Olivia Bennett')).toBeInTheDocument();
  });

  it('retries a failed execution once and refreshes', async () => {
    vi.mocked(automationService.executions).mockResolvedValue(page([exec()]));
    vi.mocked(automationService.execution).mockResolvedValue(exec());

    vi.mocked(automationService.retry).mockResolvedValue(
      exec({ status: 'PENDING' }),
    );

    render();

    await openExecution('Partially failed');

    await userEvent.click(
      await screen.findByRole('button', {
        name: /Retry failed actions/,
      }),
    );

    await waitFor(() =>
      expect(automationService.retry).toHaveBeenCalledWith('w1', 'e1'),
    );
  });

  it('offers no retry for completed executions', async () => {
    const completedExecution = exec({
      status: 'COMPLETED',
      errorSummary: null,
      actionResults: [
        {
          index: 0,
          type: 'CREATE_IN_APP_NOTIFICATION',
          status: 'SUCCESS',
          attempts: 1,
          output: { created: false },
        },
      ],
    });

    vi.mocked(automationService.executions).mockResolvedValue(
      page([completedExecution]),
    );

    vi.mocked(automationService.execution).mockResolvedValue(
      completedExecution,
    );

    render();

    await openExecution('Completed');

    expect(await screen.findByText(/Not delivered/)).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: /Retry/ }),
    ).not.toBeInTheDocument();
  });

  it('hides retry without the retry permission', async () => {
    perms.mockImplementation(
      (permission) => permission !== 'automations:retry',
    );

    vi.mocked(automationService.executions).mockResolvedValue(page([exec()]));
    vi.mocked(automationService.execution).mockResolvedValue(exec());

    render();

    await openExecution('Partially failed');

    await screen.findByRole('region', {
      name: 'Action results',
    });

    expect(
      screen.queryByRole('button', { name: /Retry/ }),
    ).not.toBeInTheDocument();
  });

  it('renders empty and error states', async () => {
    vi.mocked(automationService.executions).mockResolvedValueOnce(page([]));

    const { unmount } = render();

    expect(
      await screen.findByText('No executions yet'),
    ).toBeInTheDocument();

    unmount();

    // Keep the rejection available for React Query's retry attempt.
    vi.mocked(automationService.executions).mockRejectedValue(
      new Error('boom'),
    );

    render();

    expect(
      await screen.findByRole('alert'),
    ).toBeInTheDocument();
  });
});
