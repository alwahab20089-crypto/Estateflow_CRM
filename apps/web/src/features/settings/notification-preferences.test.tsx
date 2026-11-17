
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationPreferenceService } from '@/services/automation-service';
import { renderWithProviders } from '@/test/utils';
import { NotificationPreferences } from './notification-preferences';

vi.mock('@/services/automation-service', () => ({
  automationService: {},
  notificationPreferenceService: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

let canEdit = true;

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    can: () => canEdit,
  }),
}));

const prefs = [
  { type: 'TASK_ASSIGNED', mandatory: true, inApp: true, email: null },
  { type: 'TASK_REMINDER', mandatory: false, inApp: true, email: null },
  { type: 'AUTOMATION', mandatory: false, inApp: true, email: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  canEdit = true;

  vi.mocked(notificationPreferenceService.get).mockResolvedValue(prefs);
});

describe('NotificationPreferences', () => {
  it('locks mandatory notifications and lets optional ones be turned off', async () => {
    vi.mocked(notificationPreferenceService.update).mockResolvedValue(
      prefs.map((p) =>
        p.type === 'TASK_REMINDER' ? { ...p, inApp: false } : p,
      ),
    );

    renderWithProviders(<NotificationPreferences />);

    const mandatory = await screen.findByRole('switch', {
      name: 'Task assigned in-app',
    });

    expect(mandatory).toBeDisabled();
    expect(mandatory).toBeChecked();
    expect(screen.getByText('Required')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('switch', {
        name: 'Task reminder in-app',
      }),
    );

    await waitFor(() => {
      expect(notificationPreferenceService.update).toHaveBeenCalledWith([
        { type: 'TASK_REMINDER', inApp: false },
      ]);
    });

    await waitFor(() => {
      expect(
        screen.getByRole('switch', {
          name: 'Task reminder in-app',
        }),
      ).not.toBeChecked();
    });
  });

  it('shows the email channel only for automation notifications, and disables everything without permission', async () => {
    canEdit = false;

    renderWithProviders(<NotificationPreferences />);

    await screen.findByRole('switch', {
      name: 'Automation email',
    });

    expect(
      screen.queryByRole('switch', {
        name: 'Task reminder email',
      }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole('switch', {
        name: 'Automation in-app',
      }),
    ).toBeDisabled();
  });

  it('shows loading and error states', async () => {
    vi.mocked(notificationPreferenceService.get).mockRejectedValue(
      new Error('boom'),
    );

    renderWithProviders(<NotificationPreferences />);

    expect(
      screen.getByRole('status', {
        name: 'Loading preferences',
      }),
    ).toBeInTheDocument();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

