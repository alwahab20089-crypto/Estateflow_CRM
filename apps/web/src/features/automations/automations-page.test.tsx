
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationService } from '@/services/automation-service';
import { renderWithProviders } from '@/test/utils';
import type { WorkflowDto } from '@/types/automations';
import { AutomationsPage } from './automations-page';

const { perms } = vi.hoisted(() => ({
  perms: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('@/services/automation-service', () => ({
  automationService: {
    list: vi.fn(),
    activate: vi.fn(),
    pause: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
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

const wf = (o: Partial<WorkflowDto> = {}): WorkflowDto => ({
  _id: 'w1',
  name: 'Follow up high priority',
  description: 'Creates a task',
  status: 'ACTIVE',
  version: 1,
  triggerType: 'LEAD_CREATED',
  triggerConfig: {},
  conditions: [],
  conditionOperator: 'ALL',
  actions: [],
  executionSettings: {
    maxAttempts: 3,
    notifyOnCompletion: false,
    maxExecutionsPerHour: 100,
  },
  createdBy: 'u1',
  updatedBy: null,
  lastExecutedAt: new Date(Date.now() - 3_600_000).toISOString(),
  createdAt: '',
  updatedAt: '',
  stats: {
    total: 12,
    completed: 10,
    failed: 2,
  },
  ...o,
});

const result = (data: WorkflowDto[]) => ({
  data,
  meta: {
    page: 1,
    limit: 20,
    total: data.length,
    totalPages: 1,
  },
});

const render = () =>
  renderWithProviders(<AutomationsPage />, {
    route: '/app/automations',
    path: '/app/automations',
  });

beforeEach(() => {
  vi.clearAllMocks();
  perms.mockReturnValue(true);
});

describe('AutomationsPage', () => {
  it('shows trigger, status, last run and success/failure counts', async () => {
    vi.mocked(automationService.list).mockResolvedValue(result([wf()]));

    render();

    expect(
      await screen.findByText('Follow up high priority'),
    ).toBeInTheDocument();

    const automationRow = screen.getByRole('row', {
      name: /Follow up high priority/i,
    });

    expect(
      within(automationRow).getByText('A lead is created'),
    ).toBeInTheDocument();

    expect(within(automationRow).getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/12 total/)).toBeInTheDocument();
    expect(screen.getByText('2 failed')).toBeInTheDocument();
  });

  it('pauses an active automation and activates a paused one', async () => {
    vi.mocked(automationService.list).mockResolvedValue(
      result([
        wf(),
        wf({ _id: 'w2', name: 'Paused one', status: 'PAUSED' }),
      ]),
    );

    vi.mocked(automationService.pause).mockResolvedValue(
      wf({ status: 'PAUSED' }),
    );

    vi.mocked(automationService.activate).mockResolvedValue(
      wf({ _id: 'w2' }),
    );

    render();

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Pause Follow up high priority',
      }),
    );

    await waitFor(() =>
      expect(automationService.pause).toHaveBeenCalledWith('w1'),
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Activate Paused one',
      }),
    );

    await waitFor(() =>
      expect(automationService.activate).toHaveBeenCalledWith('w2'),
    );
  });

  it('archives only after confirmation', async () => {
    vi.mocked(automationService.list).mockResolvedValue(result([wf()]));
    vi.mocked(automationService.remove).mockResolvedValue(undefined);

    render();

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Archive Follow up high priority',
      }),
    );

    expect(automationService.remove).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Archive' }),
    );

    await waitFor(() =>
      expect(automationService.remove).toHaveBeenCalledWith('w1'),
    );
  });

  it('sends search and filters to the API', async () => {
    vi.mocked(automationService.list).mockResolvedValue(result([wf()]));

    render();

    await screen.findByText('Follow up high priority');

    await userEvent.selectOptions(
      screen.getByLabelText('Filter by status'),
      'ACTIVE',
    );

    await waitFor(() =>
      expect(automationService.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
          page: 1,
        }),
        expect.anything(),
      ),
    );
  });

  it('hides management controls without permission', async () => {
    perms.mockImplementation(
      (permission) => permission === 'automations:read',
    );

    vi.mocked(automationService.list).mockResolvedValue(result([wf()]));

    render();

    await screen.findByText('Follow up high priority');

    expect(
      screen.queryByRole('link', { name: /new automation/i }),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: /pause/i }),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: /archive/i }),
    ).not.toBeInTheDocument();
  });

  it('renders empty and error states', async () => {
    vi.mocked(automationService.list).mockResolvedValue(result([]));

    const { unmount } = render();

    expect(
      await screen.findByText('No automations yet'),
    ).toBeInTheDocument();

    unmount();

    vi.mocked(automationService.list).mockRejectedValue(
      new Error('boom'),
    );

    render();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
