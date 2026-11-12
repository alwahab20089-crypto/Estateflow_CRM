// src/features/deals/pipeline-page.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dealService } from '@/services/deal-service';
import { pageMeta, renderWithProviders } from '@/test/utils';
import type { DealDto } from '@/types/deals';
import { PipelinePage } from './pipeline-page';
import { makeDeal, summary } from './deal-test-utils';

vi.mock('@/services/deal-service', () => ({ dealService: { list: vi.fn(), updateStage: vi.fn(), create: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: { organization: { currency: 'USD' } } }) }));


const meta = (over = {}) => ({ ...pageMeta({ limit: 100 }), summary: summary([['NEW', 1, 24_000_000], ['NEGOTIATION', 1, 10_000_000]]), ...over });
const list = vi.mocked(dealService.list);
const render = () => renderWithProviders(<PipelinePage />, { route: '/app/pipeline', path: '/app/pipeline' });
const column = (name: string) => screen.getByRole('region', { name });

beforeEach(() => { vi.clearAllMocks(); list.mockReset(); });

describe('PipelinePage', () => {
  it('shows loading, then every column with counts, active value and card details', async () => {
    list.mockReturnValue(new Promise(() => {}));
    const first = render();
    expect(screen.getByRole('status', { name: 'Loading pipeline' })).toBeInTheDocument();
    first.unmount();

    list.mockResolvedValue({ data: [makeDeal(), makeDeal({ _id: 'd2', title: 'Office deal', stage: 'NEGOTIATION' })], meta: meta() });
    render();
    expect(await screen.findByText('Villa for Lucas')).toBeInTheDocument();
    for (const name of ['New', 'Qualification', 'Property Matched', 'Viewing Scheduled', 'Negotiation', 'Contract', 'Won', 'Lost']) expect(column(name)).toBeInTheDocument();
    expect(within(column('New')).getByText('Villa for Lucas')).toBeInTheDocument();
    expect(within(column('Negotiation')).getByText('Office deal')).toBeInTheDocument();
    expect(within(column('New')).getByText('Lucas Meyer')).toBeInTheDocument();
    expect(within(column('New')).getByText('Garden Villa')).toBeInTheDocument();
    expect(within(column('New')).getByText('$240,000.00')).toBeInTheDocument();
    expect(screen.getByText(/2 active deals/)).toBeInTheDocument();
  });

  it('shows empty and error states', async () => {
    list.mockResolvedValueOnce({ data: [], meta: meta({ total: 0, summary: [] }) });
    const a = render();
    expect(await screen.findByText('No deals yet')).toBeInTheDocument();
    a.unmount();
    list.mockRejectedValue(new Error('boom'));
    render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('moves a card optimistically and calls the backend with the new stage', async () => {
    list.mockResolvedValue({ data: [makeDeal()], meta: meta() });
    let resolveMove!: (d: DealDto) => void;
    vi.mocked(dealService.updateStage).mockReturnValue(new Promise((r) => { resolveMove = r; }));
    render();
    await screen.findByText('Villa for Lucas');

    await userEvent.click(screen.getByRole('combobox', { name: 'Move Villa for Lucas' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Qualification' }));
    expect(dealService.updateStage).toHaveBeenCalledWith('d1', 'QUALIFICATION');
    await waitFor(() => expect(within(column('Qualification')).getByText('Villa for Lucas')).toBeInTheDocument()); // before the server answers
    resolveMove(makeDeal({ stage: 'QUALIFICATION' }));
  });

  it('rolls the card back when the server refuses the move', async () => {
    list.mockResolvedValue({ data: [makeDeal()], meta: meta() });
    vi.mocked(dealService.updateStage).mockRejectedValue(new Error('refused'));
    render();
    await screen.findByText('Villa for Lucas');
    await userEvent.click(screen.getByRole('combobox', { name: 'Move Villa for Lucas' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Qualification' }));
    await waitFor(() => expect(within(column('New')).getByText('Villa for Lucas')).toBeInTheDocument());
    expect(within(column('Qualification')).queryByText('Villa for Lucas')).not.toBeInTheDocument();
  });

  it('opens the won and lost dialogs instead of moving the card directly', async () => {
    list.mockResolvedValue({ data: [makeDeal({ stage: 'NEGOTIATION' })], meta: meta() });
    render();
    await screen.findByText('Villa for Lucas');
    await userEvent.click(screen.getByRole('combobox', { name: 'Move Villa for Lucas' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Won' }));
    expect(await screen.findByRole('heading', { name: 'Close deal as won' })).toBeInTheDocument();
    expect(dealService.updateStage).not.toHaveBeenCalled();
  });

  it('only offers moves the rules allow (no skipping ahead)', async () => {
    list.mockResolvedValue({ data: [makeDeal({ stage: 'NEW' })], meta: meta() });
    render();
    await screen.findByText('Villa for Lucas');
    await userEvent.click(screen.getByRole('combobox', { name: 'Move Villa for Lucas' }));
    expect(await screen.findByRole('option', { name: 'Qualification' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Negotiation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Won' })).not.toBeInTheDocument(); // not closable from NEW
  });
});