import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskService } from '@/services/task-service';
import { renderWithProviders } from '@/test/utils';
import { authMock, listResult, makeTask } from './task-test-utils';
import { TasksPage } from './tasks-page';

vi.mock('@/services/task-service', () => ({
  taskService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), restore: vi.fn(), updateStatus: vi.fn(), complete: vi.fn(), assign: vi.fn(), activities: vi.fn() },
}));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => authMock());

const render = (route = '/app/tasks') => renderWithProviders(<TasksPage />, { route, path: '/app/tasks' });
beforeEach(() => vi.clearAllMocks());

describe('TasksPage', () => {
  it('renders tasks with status, priority, assignee, related link and the due time in the organization timezone', async () => {
    vi.mocked(taskService.list).mockResolvedValue(listResult([makeTask(), makeTask({ _id: 't2', title: 'Send brochure', status: 'COMPLETED', assignee: null, assignedTo: null, related: null, relatedEntityType: null, relatedEntityId: null, dueAt: null })]));
    render();
    expect(await screen.findByRole('button', { name: 'Call buyer' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Call buyer' }).closest('tr')!;
    expect(within(row).getByText('Nov 14, 3:00 PM')).toBeInTheDocument(); // 10:00Z = 15:00 in Karachi
    expect(within(row).getByText('Ayesha Khan')).toBeInTheDocument();
    expect(within(row).getByText('High')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Olivia Bennett' })).toHaveAttribute('href', '/app/leads/lead1');
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows loading, error (with retry) and empty states', async () => {
    vi.mocked(taskService.list).mockReturnValue(new Promise(() => {}));
    const { unmount } = render();
    expect(await screen.findByRole('status', { name: 'Loading tasks' })).toBeInTheDocument();
    unmount();

    vi.mocked(taskService.list).mockRejectedValue(new Error('boom'));
    const second = render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    vi.mocked(taskService.list).mockResolvedValue(listResult([]));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
    second.unmount();

    render('/app/tasks?status=COMPLETED');
    expect(await screen.findByText('No tasks match your filters')).toBeInTheDocument();
  });

  it('completes a task from the checkbox', async () => {
    vi.mocked(taskService.list).mockResolvedValue(listResult([makeTask()]));
    vi.mocked(taskService.complete).mockResolvedValue(makeTask({ status: 'COMPLETED' }));
    render();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Call buyer' }));
    await waitFor(() => expect(taskService.complete).toHaveBeenCalledWith('t1', undefined));
  });

  it('sends filters and pagination to the API', async () => {
    vi.mocked(taskService.list).mockResolvedValue(listResult([makeTask()], { total: 40, totalPages: 2 }));
    render('/app/tasks?priority=URGENT&overdue=true');
    await waitFor(() => expect(taskService.list).toHaveBeenCalledWith(expect.objectContaining({ priority: 'URGENT', overdue: 'true', page: 1, sortBy: 'dueAt', view: 'active' }), expect.anything()));

    await userEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(taskService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, priority: 'URGENT' }), expect.anything()));

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'brochure');
    await waitFor(() => expect(taskService.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'brochure', page: 1 }), expect.anything()));
  });

  it('lists archived tasks and restores one', async () => {
    vi.mocked(taskService.list).mockResolvedValue(listResult([makeTask({ deletedAt: '2026-11-10T00:00:00.000Z' })]));
    vi.mocked(taskService.restore).mockResolvedValue(makeTask());
    render('/app/tasks?view=archived');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Call buyer' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(taskService.restore).toHaveBeenCalledWith('t1'));
  });

  it('hides write actions without permission', async () => {
    vi.resetModules();
    vi.mocked(taskService.list).mockResolvedValue(listResult([makeTask()]));
    const mod = await import('@/providers/auth-provider');
    vi.spyOn(mod, 'useAuth').mockReturnValue({ can: (p: string) => p === 'tasks:read', activeMembership: { organization: { timezone: 'Asia/Karachi' } } } as never);
    render();
    await screen.findByRole('button', { name: 'Call buyer' });
    expect(screen.queryByRole('button', { name: /add task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});