import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, makeTask } from '@/features/tasks/task-test-utils';
import { taskService } from '@/services/task-service';
import { renderWithProviders } from '@/test/utils';
import { CalendarPage } from './calendar-page';

vi.mock('@/services/task-service', () => ({ taskService: { calendar: vi.fn(), get: vi.fn(), activities: vi.fn(), create: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => authMock());

const meta = { from: '', to: '', total: 1, truncated: false };
const render = (query = 'date=2026-11-14') => renderWithProviders(<CalendarPage />, { route: `/app/calendar?${query}`, path: '/app/calendar' });
const lastParams = () => vi.mocked(taskService.calendar).mock.lastCall![0];
beforeEach(() => { vi.clearAllMocks(); vi.mocked(taskService.calendar).mockResolvedValue({ data: [makeTask()], meta }); });

describe('CalendarPage', () => {
  it('requests the six-week month grid in the organization timezone and shows the task on its local day', async () => {
    render();
    // Nov 2026 grid = Mon Oct 26 .. Mon Dec 7, midnight in Karachi (UTC+5)
    await waitFor(() => expect(taskService.calendar).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-25T19:00:00.000Z', to: '2026-12-06T19:00:00.000Z' }), expect.anything()));
    expect((await screen.findAllByText('Call buyer')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeInTheDocument();
    const selected = screen.getByRole('region', { name: 'Selected day' });
    expect(within(selected).getByText('Call buyer')).toBeInTheDocument();
    expect(within(selected).getByText('3:00 PM')).toBeInTheDocument();
    expect(
      within(selected).getByText(/Ayesha Khan/),
    ).toBeInTheDocument();
  });

  it('navigates next/previous and switches between month, week and day views', async () => {
    render();
    await screen.findAllByText('Call buyer');

    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'December 2026' })).toBeInTheDocument();
    await waitFor(() => expect(lastParams().from).toBe('2026-11-29T19:00:00.000Z')); // grid starts Mon Nov 30
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'November 2026' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ from: '2026-11-08T19:00:00.000Z', to: '2026-11-15T19:00:00.000Z' })); // Mon Nov 9 - Sun Nov 15
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nov 9 – Nov 15, 2026');

    await userEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ from: '2026-11-13T19:00:00.000Z', to: '2026-11-14T19:00:00.000Z' }));
    expect(await screen.findByText('Call buyer')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(taskService.calendar).toHaveBeenCalledTimes(6));
  });

  it('passes filters to the API', async () => {
    render('date=2026-11-14&status=TODO&priority=HIGH&taskType=CALL&assignedTo=me');
    await waitFor(() => expect(taskService.calendar).toHaveBeenCalledWith(expect.objectContaining({ status: 'TODO', priority: 'HIGH', taskType: 'CALL', assignedTo: 'me' }), expect.anything()));
  });

  it('opens task details when an entry is selected', async () => {
    vi.mocked(taskService.get).mockResolvedValue(makeTask());
    vi.mocked(taskService.activities).mockResolvedValue({ data: [], meta: { page: 1, limit: 30, total: 0, totalPages: 1 } });
    render();
    const selected = await screen.findByRole('region', { name: 'Selected day' });
    await userEvent.click(within(selected).getByRole('button', { name: /Call buyer/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Call buyer');
    await waitFor(() => expect(taskService.get).toHaveBeenCalledWith('t1'));
  });

  it('creates a task from a selected date, defaulting to 9:00 that day', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Add task on this day' }));
    expect(await screen.findByLabelText('Due date and time')).toHaveValue('2026-11-14T09:00');
  });

  it('shows loading, error and empty states', async () => {
    vi.mocked(taskService.calendar).mockReturnValue(new Promise(() => { }));
    const first = render();
    expect(await screen.findByRole('status', { name: 'Loading calendar' })).toBeInTheDocument();
    first.unmount();

    vi.mocked(taskService.calendar).mockRejectedValue(new Error('boom'));
    const second = render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    vi.mocked(taskService.calendar).mockResolvedValue({ data: [], meta: { ...meta, total: 0 } });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No tasks are scheduled in this period.')).toBeInTheDocument();
    second.unmount();
  });
});