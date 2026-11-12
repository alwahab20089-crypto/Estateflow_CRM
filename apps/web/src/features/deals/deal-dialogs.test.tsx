// src/features/deals/deal-dialogs.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dealService } from '@/services/deal-service';
import { renderWithProviders } from '@/test/utils';
import { CloseLostDialog, CloseWonDialog, ReopenDealDialog } from './deal-dialogs';
import { dealFormSchema, defaultDealValues, toDealPayload } from './deal-schemas';
import { makeDeal } from './deal-test-utils';

vi.mock('@/services/deal-service', () => ({ dealService: { list: vi.fn(), closeWon: vi.fn(), closeLost: vi.fn(), reopen: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: { organization: { currency: 'USD' } } }) }));
vi.mock('./pipeline-page', async (orig) => orig()); // pipeline-page.test registers its own service mock; we only need makeDeal

beforeEach(() => vi.clearAllMocks());
const deal = makeDeal({ stage: 'NEGOTIATION', valueAmount: 24_000_000 });

describe('close dialogs', () => {
  it('lost: a reason is required and nothing is sent without one', async () => {
    renderWithProviders(<CloseLostDialog deal={deal} onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close as lost' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A lost reason is required.');
    expect(dealService.closeLost).not.toHaveBeenCalled();

    vi.mocked(dealService.closeLost).mockResolvedValue(makeDeal({ stage: 'LOST' }));
    await userEvent.type(screen.getByLabelText('Lost reason *'), '  Bought elsewhere ');
    await userEvent.click(screen.getByRole('button', { name: 'Close as lost' }));
    await waitFor(() => expect(dealService.closeLost).toHaveBeenCalledWith('d1', 'Bought elsewhere'));
  });

  it('won: sends the final value in minor units and a closing date, and rejects a bad value', async () => {
    renderWithProviders(<CloseWonDialog deal={deal} onOpenChange={() => {}} />);
    const value = screen.getByLabelText(/Final value/);
    await userEvent.clear(value);
    await userEvent.type(value, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Close as won' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the final value');
    expect(dealService.closeWon).not.toHaveBeenCalled();

    vi.mocked(dealService.closeWon).mockResolvedValue(makeDeal({ stage: 'WON' }));
    await userEvent.clear(value);
    await userEvent.type(value, '235000');
    await userEvent.click(screen.getByRole('button', { name: 'Close as won' }));
    await waitFor(() => expect(dealService.closeWon).toHaveBeenCalledWith('d1', expect.objectContaining({ valueAmount: 23_500_000, actualClosingDate: expect.any(String) })));
  });

  it('reopen: requires a reason', async () => {
    renderWithProviders(<ReopenDealDialog deal={makeDeal({ stage: 'WON' })} onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen deal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A reason is required');
    expect(dealService.reopen).not.toHaveBeenCalled();
  });
});

describe('deal form rules', () => {
  const valid = { ...defaultDealValues('USD'), title: 'Deal', contactId: 'c1', propertyId: 'p1', value: '2500.50' };

  it('accepts a valid deal and converts money to integer minor units', () => {
    expect(dealFormSchema.safeParse(valid).success).toBe(true);
    expect(toDealPayload(valid, false)).toMatchObject({ title: 'Deal', contactId: 'c1', propertyId: 'p1', valueAmount: 250_050, currency: 'USD', dealType: 'SALE' });
  });

  it.each([
    ['no contact', { contactId: '' }],
    ['no property', { propertyId: '' }],
    ['zero value', { value: '0' }],
    ['fractional cents', { value: '10.999' }],
    ['bad currency', { currency: 'US' }],
    ['no title', { title: '  ' }],
  ])('rejects %s', (_name, patch) => {
    expect(dealFormSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});