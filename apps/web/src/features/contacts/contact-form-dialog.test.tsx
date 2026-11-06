import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { contactService } from '@/services/contact-service';
import { makeContact, renderWithProviders } from '@/test/utils';
import { ContactFormDialog } from './contact-form-dialog';

vi.mock('@/services/contact-service', () => ({ contactService: { create: vi.fn(), update: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: null }) }));

const create = vi.mocked(contactService.create);
const update = vi.mocked(contactService.update);
const open = (contact?: ReturnType<typeof makeContact>) => renderWithProviders(<ContactFormDialog open onOpenChange={() => {}} contact={contact} />);

beforeEach(() => vi.clearAllMocks());

describe('ContactFormDialog', () => {
  it('requires a name and a phone or email, and validates formats', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Provide a phone number or an email')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('First name *'), 'Ali');
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Phone'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number (6–15 digits)')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a contact with parsed tags (no email needed)', async () => {
    create.mockResolvedValue({ data: makeContact(), meta: { duplicates: [] } });
    open();
    await userEvent.type(screen.getByLabelText('First name *'), 'Ali');
    await userEvent.type(screen.getByLabelText('Phone'), '+92 300 1234567');
    await userEvent.type(screen.getByLabelText('Tags'), 'vip, Investor');
    await userEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ firstName: 'Ali', phone: '+92 300 1234567', contactType: 'BUYER', tags: ['vip', 'Investor'] });
    expect(create.mock.calls[0]![0].email).toBeUndefined();
  });

  it('disables submission while saving and shows server field errors', async () => {
    create.mockReturnValueOnce(new Promise(() => {}));
    const first = open();
    await userEvent.type(screen.getByLabelText('First name *'), 'Ali');
    await userEvent.type(screen.getByLabelText('Phone'), '03001234567');
    await userEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create contact' })).toBeDisabled());
    expect(create).toHaveBeenCalledTimes(1);
    first.unmount();

    create.mockRejectedValueOnce(new ApiError(409, 'EMAIL_IN_USE', 'A contact with this email already exists.', [{ path: 'email', message: 'A contact with this email already exists' }]));
    open();
    await userEvent.type(screen.getByLabelText('First name *'), 'Ali');
    await userEvent.type(screen.getByLabelText('Email'), 'dup@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    expect(await screen.findByText('A contact with this email already exists')).toBeInTheDocument();
  });

  it('edits and sends null for cleared fields', async () => {
    update.mockResolvedValue(makeContact());
    open(makeContact());
    await userEvent.clear(screen.getByLabelText('Company'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toBe('contact1');
    expect(update.mock.calls[0]![1]).toMatchObject({ company: null, email: 'lucas@example.com' });
  });
});