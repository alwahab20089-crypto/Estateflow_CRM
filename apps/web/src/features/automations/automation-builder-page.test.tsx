
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationService } from '@/services/automation-service';
import { renderWithProviders } from '@/test/utils';
import { AutomationBuilderPage } from './automation-builder-page';

vi.mock('@/services/automation-service', () => ({
  automationService: {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    activate: vi.fn(),
  },
  notificationPreferenceService: {},
}));

vi.mock('@/services/lead-service', async (orig) => ({
  ...(await orig<object>()),
  leadService: {
    members: vi.fn().mockResolvedValue([
      {
        userId: 'u1',
        name: 'Ayesha Khan',
        email: 'a@x.com',
        role: 'AGENT',
      },
    ]),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ can: () => true }),
}));

const render = () =>
  renderWithProviders(<AutomationBuilderPage />, {
    route: '/app/automations/new',
    path: '/app/automations/new',
  });

const next = () =>
  userEvent.click(screen.getByRole('button', { name: 'Next' }));

beforeEach(() => vi.clearAllMocks());

async function reachActions() {
  await userEvent.type(
    screen.getByLabelText('Name'),
    'Follow up high priority',
  );

  await next();

  await userEvent.click(
    screen.getByRole('radio', { name: /A lead is created/ }),
  );

  await next();
}

describe('AutomationBuilderPage', () => {
  it("won't leave a step with missing required input", async () => {
    render();

    await next();

    expect(
      await screen.findByText('Name is required'),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'X');

    await next();
    await next();

    expect(
      await screen.findByText('Choose a trigger'),
    ).toBeInTheDocument();
  });

  it('builds a workflow step by step, shows a readable review and saves a draft with the exact API payload', async () => {
    vi.mocked(automationService.create).mockResolvedValue({
      _id: 'w9',
    } as never);

    render();

    await reachActions();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add condition' }),
    );

    await userEvent.selectOptions(
      screen.getByLabelText('Condition 1 field'),
      'priority',
    );

    await userEvent.selectOptions(
      screen.getByLabelText('Condition 1 operator'),
      'EQUALS',
    );

    await userEvent.selectOptions(
      screen.getByLabelText('Condition 1 value'),
      'HIGH',
    );

    await next();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add action' }),
    );

    const action = screen.getByRole('region', { name: 'Action 1' });
    const titleInput = within(action).getByLabelText('Task title');

    // Paste literal template braces instead of typing keyboard syntax.
    await userEvent.click(titleInput);
    await userEvent.paste('Call {{name}}');

    await userEvent.selectOptions(
      within(action).getByLabelText('Assign the task to'),
      'USER',
    );

    await userEvent.selectOptions(
      await within(action).findByLabelText('Team member'),
      'u1',
    );

    await next();

    const summary = screen.getByRole('region', { name: 'Summary' });

    expect(
      within(summary).getByText('A lead is created'),
    ).toBeInTheDocument();

    expect(
      within(summary).getByText('Priority equals HIGH'),
    ).toBeInTheDocument();

    expect(
      within(summary).getByText(
        'Create task "Call {{name}}" for Ayesha Khan',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Save as draft' }),
    );

    await waitFor(() =>
      expect(automationService.create).toHaveBeenCalledTimes(1),
    );

    expect(automationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Follow up high priority',
        triggerType: 'LEAD_CREATED',
        conditionOperator: 'ALL',
        conditions: [
          {
            field: 'priority',
            operator: 'EQUALS',
            value: 'HIGH',
          },
        ],
        actions: [
          expect.objectContaining({
            type: 'CREATE_TASK',
            title: 'Call {{name}}',
            assignTo: {
              mode: 'USER',
              userId: 'u1',
            },
          }),
        ],
      }),
    );

    // A draft must never be activated implicitly.
    expect(automationService.activate).not.toHaveBeenCalled();
  });

  it('activates only after saving, via "Save & activate"', async () => {
    vi.mocked(automationService.create).mockResolvedValue({
      _id: 'w9',
    } as never);

    vi.mocked(automationService.activate).mockResolvedValue({} as never);

    render();

    await reachActions();
    await next();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add action' }),
    );

    const action = screen.getByRole('region', { name: 'Action 1' });

    await userEvent.type(
      within(action).getByLabelText('Task title'),
      'Call',
    );

    await next();

    await userEvent.click(
      screen.getByRole('button', { name: 'Save & activate' }),
    );

    await waitFor(() =>
      expect(automationService.activate).toHaveBeenCalledWith('w9'),
    );
  });

  it('only offers actions that fit the chosen trigger and drops incompatible ones when the trigger changes', async () => {
    render();

    await reachActions();
    await next();

    const picker = screen.getByLabelText('Action type to add');

    expect(
      within(picker).queryByRole('option', {
        name: 'Update the task status',
      }),
    ).not.toBeInTheDocument();

    expect(
      within(picker).getByRole('option', {
        name: 'Assign the lead',
      }),
    ).toBeInTheDocument();
  });

  it('shows server validation errors on the review step and keeps the form', async () => {
    const { ApiError } = await import('@/lib/api-client');

    vi.mocked(automationService.create).mockRejectedValue(
      new ApiError(
        422,
        'VALIDATION_ERROR',
        'Invalid',
        [
          {
            path: 'actions.0.assignTo.userId',
            message: 'Not an active member',
          },
        ],
      ),
    );

    render();

    await reachActions();
    await next();

    await userEvent.click(
      screen.getByRole('button', { name: 'Add action' }),
    );

    await userEvent.type(
      within(screen.getByRole('region', { name: 'Action 1' }))
        .getByLabelText('Task title'),
      'Call',
    );

    await next();

    await userEvent.click(
      screen.getByRole('button', { name: 'Save as draft' }),
    );

    expect(
      await screen.findByText(
        /actions.0.assignTo.userId: Not an active member/,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Summary' }),
    ).toBeInTheDocument();
  });
});
