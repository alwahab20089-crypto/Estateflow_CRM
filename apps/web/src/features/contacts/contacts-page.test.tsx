import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contactService } from '@/services/contact-service';
import { makeContact, pageMeta, renderWithProviders } from '@/test/utils';
import { ContactsPage } from './contacts-page';

vi.mock('@/services/contact-service', () => ({
  contactService: { list: vi.fn(), tags: vi.fn().mockResolvedValue(['vip']), create: vi.fn(), archive: vi.fn(), restore: vi.fn() },
}));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ can: () => true, activeMembership: { organization: { currency: 'USD' } } }),
}));

const list = vi.mocked(contactService.list);
const render = () => renderWithProviders(<ContactsPage />, { route: '/app/contacts', path: '/app/contacts' });

beforeEach(() => {
  vi.clearAllMocks();
  list.mockReset();
});
describe('ContactsPage', () => {
  it('shows loading, then the contacts and the total', async () => {
    list.mockReturnValue(new Promise(() => {}));
    const { unmount } = render();
    expect(screen.getByRole('status', { name: 'Loading contacts' })).toBeInTheDocument();
    unmount();

    list.mockResolvedValue({ data: [makeContact()], meta: pageMeta() });
    render();
    expect(await screen.findByRole('link', { name: 'Lucas Meyer' })).toBeInTheDocument();
    expect(screen.getByText(/1 contact/)).toBeInTheDocument();
    expect(screen.getByText('Meyer GmbH')).toBeInTheDocument();
  });

  it('shows empty and error states (with retry)', async () => {
    list.mockResolvedValueOnce({ data: [], meta: pageMeta({ total: 0 }) });
    const first = render();
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    first.unmount();

list.mockRejectedValue(new Error('boom'));
    render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    list.mockResolvedValueOnce({ data: [makeContact()], meta: pageMeta() });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'Lucas Meyer' })).toBeInTheDocument();
  });

  it('searches with a debounce, filters, paginates and sorts on the server', async () => {
    list.mockResolvedValue({ data: [makeContact()], meta: pageMeta({ total: 45, totalPages: 3 }) });
    render();
    await screen.findByRole('link', { name: 'Lucas Meyer' });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search contacts' }), 'luc');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'luc', page: 1 }), expect.anything()), { timeout: 2000 });

    await userEvent.click(screen.getByRole('combobox', { name: 'Contact type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Seller' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ contactType: 'SELLER' }), expect.anything()));

    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    await userEvent.click(within(nav).getByRole('button', { name: /next/i }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: /^name/i }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'name', sortOrder: 'asc' }), expect.anything()));
  });
});