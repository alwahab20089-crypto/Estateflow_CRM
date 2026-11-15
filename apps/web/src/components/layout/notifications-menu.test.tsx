import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock } from '@/features/tasks/task-test-utils';
import { notificationService } from '@/services/notification-service';
import { renderWithProviders } from '@/test/utils';
import type { NotificationDto } from '@/types/tasks';
import { NotificationsMenu } from './notifications-menu';

vi.mock('@/services/notification-service', () => ({
  notificationService: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), remove: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => authMock());

const note = (over: Partial<NotificationDto> = {}): NotificationDto => ({
  _id: 'n1', type: 'TASK_REMINDER', title: 'Reminder: Call buyer', message: 'Reminder for task "Call buyer".', relatedEntityType: 'LEAD', relatedEntityId: 'lead1',
  taskId: 't1', isRead: false, readAt: null, createdAt: new Date().toISOString(), ...over,
});
const page = (data: NotificationDto[], unreadCount: number) => ({ data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1, unreadCount } });
beforeEach(() => vi.clearAllMocks());

describe('NotificationsMenu', () => {
  it('shows the unread count on the bell, and no badge when everything is read', async () => {
    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 3 });
    const { unmount } = renderWithProviders(<NotificationsMenu />);
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('3');
    unmount();

    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 0 });
    renderWithProviders(<NotificationsMenu />);
    expect(await screen.findByRole('button', { name: 'Notifications, 0 unread' })).toBeInTheDocument();
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
  });

  it('marks a notification read and navigates to its task', async () => {
    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 1 });
    vi.mocked(notificationService.list).mockResolvedValue(page([note()], 1));
    vi.mocked(notificationService.markRead).mockResolvedValue(note({ isRead: true }));
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
const notification = await screen.findByRole('dialog');

const notificationTitle = within(notification).getByText(
  'Reminder: Call buyer',
);

await userEvent.click(notificationTitle.closest('button')!);await waitFor(() => expect(notificationService.markRead).toHaveBeenCalledWith('n1'));
    expect(await screen.findByText('elsewhere')).toBeInTheDocument(); // navigated away from "/" (to /app/tasks?task=t1)
  });

  it('marks all as read, and deletes one notification', async () => {
    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 2 });
    vi.mocked(notificationService.list).mockResolvedValue(page([note(), note({ _id: 'n2', title: 'Overdue: Send brochure' })], 2));
    vi.mocked(notificationService.markAllRead).mockResolvedValue({ updated: 2 });
    vi.mocked(notificationService.remove).mockResolvedValue(undefined);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(notificationService.markAllRead).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Delete notification: Overdue: Send brochure' }));
    await waitFor(() => expect(notificationService.remove).toHaveBeenCalledWith('n2'));
  });

  it('shows loading, empty and error states', async () => {
    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 0 });
    vi.mocked(notificationService.list).mockResolvedValue(page([], 0));
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('shows an error with retry when the list cannot load', async () => {
    vi.mocked(notificationService.unreadCount).mockResolvedValue({ count: 1 });
    vi.mocked(notificationService.list).mockRejectedValue(new Error('boom'));
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});