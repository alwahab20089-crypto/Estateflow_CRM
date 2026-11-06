import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { contactService } from '@/services/contact-service';
import { makeContact, makeLead, renderWithProviders } from '@/test/utils';
import { ConvertLeadDialog } from './convert-lead-dialog';

vi.mock('@/services/contact-service', () => ({ contactService: { convertLead: vi.fn() } }));

const convert = vi.mocked(contactService.convertLead);
const open = () => renderWithProviders(<ConvertLeadDialog lead={makeLead({ status: 'QUALIFIED' })} open onOpenChange={() => {}} />);

beforeEach(() => vi.clearAllMocks());

describe('ConvertLeadDialog', () => {
  it('explains the action and asks for confirmation before converting', async () => {
    open();
    expect(screen.getByText(/creates a contact from/i)).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();
  });

  it('converts and links to the new contact', async () => {
    convert.mockResolvedValue({ lead: makeLead(), contact: makeContact(), linkedExisting: false });
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    await waitFor(() => expect(convert).toHaveBeenCalledWith('lead1', undefined));
    expect(await screen.findByText('Lead converted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View contact' })).toHaveAttribute('href', '/app/contacts/contact1');
  });

  it('disables the button while converting so it cannot be submitted twice', async () => {
    convert.mockReturnValue(new Promise(() => {}));
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Convert to contact' })).toBeDisabled());
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('shows a duplicate for review and lets the user link to it', async () => {
    const match = { _id: 'existing1', fullName: 'Olivia B.', email: 'olivia@example.com', phone: null, contactType: 'BUYER', status: 'ACTIVE', matchedOn: ['email'] };
    convert.mockRejectedValueOnce(new ApiError(409, 'CONTACT_DUPLICATE', 'A contact with the same email or phone already exists.', [], { matches: [match], hiddenMatches: 0 }));
    convert.mockResolvedValueOnce({ lead: makeLead(), contact: makeContact({ _id: 'existing1', fullName: 'Olivia B.' }), linkedExisting: true });
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    expect(await screen.findByText('A matching contact already exists')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/app/contacts/existing1');
    await userEvent.click(screen.getByRole('button', { name: 'Link to this contact' }));
    await waitFor(() => expect(convert).toHaveBeenLastCalledWith('lead1', 'existing1'));
    expect(await screen.findByText('Lead linked')).toBeInTheDocument();
  });

  it('handles an already-converted lead and a non-convertible lead', async () => {
    convert.mockRejectedValueOnce(new ApiError(409, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted to a contact.', [], { contact: { _id: 'c9' } }));
    const first = open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been converted');
    expect(screen.getByRole('link', { name: 'View contact' })).toHaveAttribute('href', '/app/contacts/c9');
    first.unmount();

    convert.mockRejectedValueOnce(new ApiError(409, 'LEAD_NOT_CONVERTIBLE', 'Lost leads cannot be converted. Reopen the lead first.'));
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reopen the lead first');
  });

  it('keeps the dialog on the confirmation step after an unexpected error', async () => {
    convert.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong'));
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to contact' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Convert to contact' })).toBeEnabled());
    expect(screen.queryByText('Lead converted')).not.toBeInTheDocument();
  });
});