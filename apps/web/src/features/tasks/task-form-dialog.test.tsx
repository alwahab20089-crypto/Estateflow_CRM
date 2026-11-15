import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskService } from '@/services/task-service';
import { renderWithProviders } from '@/test/utils';
import { TaskFormDialog } from './task-form-dialog';
import { makeTask } from './task-test-utils';

vi.mock('@/services/task-service', () => ({ taskService: { create: vi.fn(), update: vi.fn(), list: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]), list: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    can: () => true,
    activeMembership: {
      organization: {
        timezone: 'Asia/Karachi',
        currency: 'USD',
      },
    },
  }),
}));
const render = (props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) =>
  renderWithProviders(<TaskFormDialog open onOpenChange={() => {}} {...props} />);
beforeEach(() => vi.clearAllMocks());

describe('TaskFormDialog', () => {
  it('requires a title and sends nothing until the form is valid', async () => {
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(taskService.create).not.toHaveBeenCalled();
  });

  it('rejects a reminder after the due date and a reminder in the past', async () => {
    render();
    await userEvent.type(screen.getByLabelText('Title *'), 'Call buyer');
    fireEvent.change(screen.getByLabelText('Due date and time'), { target: { value: '2099-12-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: '2099-12-02T10:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('The reminder must not be after the due date')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: '2001-01-01T10:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('The reminder must be in the future')).toBeInTheDocument();
    expect(taskService.create).not.toHaveBeenCalled();
  });

  it('creates a task with organization-timezone dates converted to UTC', async () => {
    vi.mocked(taskService.create).mockResolvedValue(makeTask());
    const onCreated = vi.fn();
    render({ onCreated });
    await userEvent.type(screen.getByLabelText('Title *'), '  Call buyer ');
    fireEvent.change(screen.getByLabelText('Due date and time'), { target: { value: '2099-12-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: '2099-12-01T09:00' } });
    await userEvent.type(screen.getByLabelText('Tags'), 'Hot, hot, vip');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(taskService.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Call buyer', taskType: 'GENERAL', priority: 'MEDIUM',
      dueAt: '2099-12-01T05:00:00.000Z', reminderAt: '2099-12-01T04:00:00.000Z', tags: ['hot', 'vip'],
    })));
    const sent = vi.mocked(taskService.create).mock.calls[0]![0];
    expect(sent).not.toHaveProperty('relatedEntityType'); // empty fields are omitted on create
    expect(onCreated).toHaveBeenCalled();
  });

  it('preselects the related record when opened from a detail page', async () => {
    vi.mocked(taskService.create).mockResolvedValue(makeTask());
    render({ defaults: { related: { type: 'LEAD', id: 'lead1', label: 'Olivia Bennett' } } });
    expect(screen.getByRole('combobox', { name: 'Related record' })).toHaveTextContent('Olivia Bennett');
    await userEvent.type(screen.getByLabelText('Title *'), 'Follow up');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(taskService.create).toHaveBeenCalledWith(expect.objectContaining({ relatedEntityType: 'LEAD', relatedEntityId: 'lead1' })));
  });

  it('pre-fills an existing task and does not resend untouched dates', async () => {
    vi.mocked(taskService.update).mockResolvedValue(makeTask({ title: 'New title' }));
    render({ task: makeTask({ reminderAt: '2001-01-01T05:00:00.000Z' }) });
    expect(screen.getByLabelText('Title *')).toHaveValue('Call buyer');
    expect(screen.getByLabelText('Due date and time')).toHaveValue('2026-11-14T15:00');
    const title = screen.getByLabelText('Title *');
    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' })); // a stored past reminder is not rejected
    await waitFor(() => expect(taskService.update).toHaveBeenCalled());
    const [id, payload] = vi.mocked(taskService.update).mock.calls[0]!;
    expect(id).toBe('t1');
    expect(payload).toMatchObject({ title: 'New title', relatedEntityType: 'LEAD', relatedEntityId: 'lead1' });
    expect(payload).not.toHaveProperty('dueAt');
    expect(payload).not.toHaveProperty('reminderAt');
  });
});