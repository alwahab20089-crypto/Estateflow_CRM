// src/features/deals/deal-schemas.ts
import { z } from 'zod';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';
import type { DealDto, DealPayload } from '@/types/deals';
import type { ListingKind } from '@/types/properties';

export const dealFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Too long'),
  dealType: z.enum(['SALE', 'RENT', 'LEASE']),
  contactId: z.string().min(1, 'Select a contact'),
  leadId: z.string(), // '' = none
  propertyId: z.string().min(1, 'Select a property'),
  value: z.string().trim().refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Enter a value greater than 0'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  expectedClosingDate: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date'),
  assignedTo: z.string(),
  notes: z.string().max(5000, 'At most 5000 characters'),
});
export type DealFormValues = z.infer<typeof dealFormSchema>;

export const defaultDealValues = (currency: string, over: Partial<DealFormValues> = {}): DealFormValues => ({
  title: '', dealType: 'SALE', contactId: '', leadId: '', propertyId: '', value: '', currency, expectedClosingDate: '', assignedTo: '', notes: '', ...over,
});

export const dealToFormValues = (d: DealDto): DealFormValues => ({
  title: d.title, dealType: d.dealType, contactId: d.contactId, leadId: d.leadId ?? '', propertyId: d.propertyId,
  value: String(fromMinorUnits(d.valueAmount, d.currency)), currency: d.currency,
  expectedClosingDate: d.expectedClosingDate ? d.expectedClosingDate.slice(0, 10) : '', assignedTo: d.assignedTo ?? '', notes: d.notes ?? '',
});

/** A date-only input becomes local noon, so it never shifts a day across time zones. */
export const dateToIso = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).toISOString();
};

/** clear=true (edit) sends null for emptied fields. Money leaves as integer minor units. */
export function toDealPayload(v: DealFormValues, clear: boolean): DealPayload {
  const empty = clear ? null : undefined;
  const cur = v.currency.trim().toUpperCase();
  return {
    title: v.title.trim(), contactId: v.contactId, leadId: v.leadId || empty, propertyId: v.propertyId,
    dealType: v.dealType as ListingKind, valueAmount: toMinorUnits(Number(v.value), cur), currency: cur,
    expectedClosingDate: v.expectedClosingDate ? dateToIso(v.expectedClosingDate) : empty, notes: v.notes.trim() || empty,
  };
}

export const SERVER_FIELD_MAP: Record<string, keyof DealFormValues> = {
  title: 'title', dealType: 'dealType', contactId: 'contactId', leadId: 'leadId', propertyId: 'propertyId', valueAmount: 'value',
  currency: 'currency', expectedClosingDate: 'expectedClosingDate', assignedTo: 'assignedTo', notes: 'notes',
};