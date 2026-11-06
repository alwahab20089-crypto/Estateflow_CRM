import type { ContactType, LeadStatus } from '@/types';
import type { ContactMethod, ContactStatus } from '@/types/contacts';

export const CONTACT_TYPES: ContactType[] = ['BUYER', 'SELLER', 'TENANT', 'LANDLORD', 'INVESTOR', 'OTHER'];
export const CONTACT_STATUSES: ContactStatus[] = ['ACTIVE', 'INACTIVE'];
export const CONTACT_METHODS: Array<{ value: ContactMethod; label: string }> = [
  { value: 'PHONE', label: 'Phone call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
];
/** Mirrors the server rule (CONVERTIBLE_LEAD_STATUSES). The server remains the authority. */
export const CONVERTIBLE_STATUSES: LeadStatus[] = ['QUALIFIED', 'MEETING_SCHEDULED', 'NEGOTIATION', 'WON'];