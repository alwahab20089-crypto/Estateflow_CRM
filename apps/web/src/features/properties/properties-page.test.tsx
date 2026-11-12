// src/features/properties/properties-page.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { propertyService } from '@/services/property-service';
import { pageMeta, renderWithProviders } from '@/test/utils';
import { makeProperty } from './property-test-utils';
import { PropertiesPage } from './properties-page';

vi.mock('@/services/property-service', async (orig) => ({ ...(await orig<object>()), propertyService: { list: vi.fn(), create: vi.fn(), uploadImages: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: { organization: { currency: 'USD' } } }) }));


const meta = (over = {}) => ({ ...pageMeta(), statusCounts: { AVAILABLE: 1 }, ...over });
const list = vi.mocked(propertyService.list);
const render = () => renderWithProviders(<PropertiesPage />, { route: '/app/properties', path: '/app/properties' });

beforeEach(() => { vi.clearAllMocks(); list.mockReset(); });

describe('PropertiesPage', () => {
  it('shows a loading state, then cards with price, status, location and agent', async () => {
    list.mockReturnValue(new Promise(() => {}));
    const first = render();
    expect(screen.getByRole('status', { name: 'Loading properties' })).toBeInTheDocument();
    first.unmount();

    list.mockResolvedValue({ data: [makeProperty()], meta: meta() });
    render();
    expect(await screen.findByRole('link', { name: 'Garden Villa' })).toBeInTheDocument();
    expect(screen.getByText('$250,000.00')).toBeInTheDocument();
    expect(screen.getByText('Lahore, PK')).toBeInTheDocument();
    expect(screen.getByText('Ayesha Khan')).toBeInTheDocument();
    expect(screen.getByText('Available', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows empty and error states, and recovers on retry', async () => {
    list.mockResolvedValueOnce({ data: [], meta: meta({ total: 0, statusCounts: {} }) });
    const a = render();
    expect(await screen.findByText('No properties yet')).toBeInTheDocument();
    a.unmount();

    list.mockRejectedValue(new Error('boom'));
    render();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    list.mockResolvedValueOnce({ data: [makeProperty()], meta: meta() });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'Garden Villa' })).toBeInTheDocument();
  });

  it('sends search, filters, sort and pagination to the server', async () => {
    list.mockResolvedValue({ data: [makeProperty()], meta: meta({ total: 45, totalPages: 3 }) });
    render();
    await screen.findByRole('link', { name: 'Garden Villa' });

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search properties' }), 'villa');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'villa', page: 1 }), expect.anything()), { timeout: 2000 });

    await userEvent.click(screen.getByRole('combobox', { name: 'Listing type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'For rent' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ listingType: 'RENT' }), expect.anything()));

    const min = screen.getByLabelText('Min price');
    await userEvent.type(min, '1000{Enter}');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ minPrice: 100_000 }), expect.anything())); // major -> minor units

    await userEvent.click(screen.getByRole('combobox', { name: 'Sort properties' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Price: low to high' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'price', sortOrder: 'asc' }), expect.anything()));

    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    await userEvent.click(within(nav).getByRole('button', { name: /next/i }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything()));
  });
});