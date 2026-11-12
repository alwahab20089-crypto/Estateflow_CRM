// src/features/properties/property-form-dialog.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { propertyService } from '@/services/property-service';
import { renderWithProviders } from '@/test/utils';
import { PropertyFormDialog } from './property-form-dialog';
import { makeProperty } from './property-test-utils';

vi.mock('@/services/property-service', async (orig) => ({ ...(await orig<object>()), propertyService: { create: vi.fn(), update: vi.fn(), uploadImages: vi.fn(), list: vi.fn() } }));
vi.mock('@/services/lead-service', async (orig) => ({ ...(await orig<object>()), leadService: { members: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/services/contact-service', () => ({ contactService: { list: vi.fn().mockResolvedValue({ data: [], meta: {} }) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ can: () => true, activeMembership: { organization: { currency: 'USD' } } }) }));

const renderDialog = (props = {}) => renderWithProviders(<PropertyFormDialog open onOpenChange={() => {}} {...props} />);
beforeEach(() => vi.clearAllMocks());

describe('PropertyFormDialog', () => {
  it('requires a title and a price greater than zero, and sends nothing while invalid', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Create property' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a price greater than 0')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Title *'), 'Villa');
    await userEvent.type(screen.getByLabelText(/^Price/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Create property' }));
    expect(await screen.findByText('Enter a price greater than 0')).toBeInTheDocument();
    expect(propertyService.create).not.toHaveBeenCalled();
  });

  it('creates a property with the price converted to integer minor units', async () => {
    vi.mocked(propertyService.create).mockResolvedValue(makeProperty());
    renderDialog();
    await userEvent.type(screen.getByLabelText('Title *'), '  Garden Villa ');
    await userEvent.type(screen.getByLabelText(/^Price/), '2500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Create property' }));
    await waitFor(() => expect(propertyService.create).toHaveBeenCalledTimes(1));
    expect(propertyService.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Garden Villa', priceAmount: 250_050, currency: 'USD', propertyType: 'HOUSE', listingType: 'SALE' }));
  });

  it('requires a rent period for rentals and rejects non-image files', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('combobox', { name: /listing type/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'For rent' }));
    await userEvent.type(screen.getByLabelText('Title *'), 'Flat');
    await userEvent.type(screen.getByLabelText(/^Price/), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Create property' }));
    expect(await screen.findByText('Rent period is required for rentals')).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText(/Choose up to/), new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    expect(await screen.findByText(/not a JPEG, PNG or WebP image/)).toBeInTheDocument();
  });
});