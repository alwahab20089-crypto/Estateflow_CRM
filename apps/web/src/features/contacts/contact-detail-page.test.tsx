import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { contactService } from '@/services/contact-service';
import { makeContact, pageMeta, renderWithProviders } from '@/test/utils';
import { ContactDetailPage } from './contact-detail-page';

vi.mock('@/services/contact-service', () => ({
    contactService: { get: vi.fn(), activities: vi.fn(), archive: vi.fn(), restore: vi.fn(), update: vi.fn(), addNote: vi.fn(), assign: vi.fn() },
}));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: null }) }));

const svc = vi.mocked(contactService);
const render = () => renderWithProviders(<ContactDetailPage />, { route: '/app/contacts/contact1', path: '/app/contacts/:contactId' });

beforeEach(() => {
    vi.clearAllMocks();
    svc.get.mockResolvedValue(makeContact({ linkedLeads: [{ _id: 'lead1', name: 'Olivia Bennett', status: 'QUALIFIED', leadType: 'BUYER', convertedAt: '2026-11-02T10:00:00.000Z' }] }));
    svc.activities.mockResolvedValue({
        data: [{ _id: 'a1', activityType: 'CREATED', description: 'Contact created from lead Olivia Bennett', user: { _id: 'u1', name: 'Alex' }, createdAt: '2026-11-01T10:00:00.000Z' }],
        meta: pageMeta(),
    });
});

describe('ContactDetailPage', () => {
    it('renders the profile, linked lead and relationship history', async () => {
        render();
        expect(await screen.findByRole('heading', { name: 'Lucas Meyer' })).toBeInTheDocument();
        expect(screen.getByText('lucas@example.com')).toBeInTheDocument();
        expect(screen.getAllByText('Meyer GmbH', { exact: false }).length).toBeGreaterThan(0);
        expect(screen.getByRole('link', { name: 'Olivia Bennett' })).toHaveAttribute('href', '/app/leads/lead1');
        expect(await screen.findByText('Contact created from lead Olivia Bennett')).toBeInTheDocument();
    });

    it('shows a not-found state', async () => {
        svc.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Contact not found'));
        render();
        expect(await screen.findByText('Contact not found')).toBeInTheDocument();
    });

    it('asks for confirmation before archiving', async () => {
        svc.archive.mockResolvedValue(makeContact());
        render();
        await userEvent.click(await screen.findByRole('button', { name: /^archive$/i }));
        const dialog = await screen.findByRole('alertdialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(svc.archive).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));
        await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive contact' }));
        await waitFor(() => expect(svc.archive).toHaveBeenCalledWith('contact1'));
    });
});