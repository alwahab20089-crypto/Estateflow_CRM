import { z } from 'zod';
import type { ContactType } from '@/types';
import type { ContactDto, ContactMethod, ContactPayload, ContactStatus } from '@/types/contacts';
import { isValidPhone } from '@/features/leads/lead-schemas';
import { CONTACT_METHODS, CONTACT_STATUSES, CONTACT_TYPES } from './contact-constants';

const optionalPhone = z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number (6–15 digits)');
const methods = CONTACT_METHODS.map((m) => m.value) as [ContactMethod, ...ContactMethod[]];

export const contactFormSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(100, 'Too long'),
    lastName: z.string().trim().max(100, 'Too long'),
    email: z.string().trim().max(254).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address'),
    phone: optionalPhone,
    alternatePhone: optionalPhone,
    contactType: z.enum(CONTACT_TYPES as [ContactType, ...ContactType[]]),
    status: z.enum(CONTACT_STATUSES as [ContactStatus, ...ContactStatus[]]),
    company: z.string().trim().max(150, 'Too long'),
    jobTitle: z.string().trim().max(100, 'Too long'),
    address: z.string().trim().max(300, 'Too long'),
    city: z.string().trim().max(100, 'Too long'),
    country: z.string().trim().max(100, 'Too long'),
    preferredContactMethod: z.union([z.literal(''), z.enum(methods)]),
    preferredLanguage: z.string().trim().max(40, 'Too long'),
    tags: z.string().max(400, 'Too long'),
    assignedTo: z.string(), // '' = unassigned
    notes: z.string().max(5000, 'Notes can be at most 5000 characters'),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Provide a phone number or an email' });
    const tags = v.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length > 20) ctx.addIssue({ code: 'custom', path: ['tags'], message: 'At most 20 tags' });
    if (tags.some((t) => t.length > 40)) ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Each tag can be at most 40 characters' });
  });

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export const defaultContactValues = (): ContactFormValues => ({
  firstName: '', lastName: '', email: '', phone: '', alternatePhone: '', contactType: 'BUYER', status: 'ACTIVE',
  company: '', jobTitle: '', address: '', city: '', country: '', preferredContactMethod: '', preferredLanguage: '',
  tags: '', assignedTo: '', notes: '',
});

export const contactToFormValues = (c: ContactDto): ContactFormValues => ({
  firstName: c.firstName, lastName: c.lastName, email: c.email ?? '', phone: c.phone ?? '', alternatePhone: c.alternatePhone ?? '',
  contactType: c.contactType, status: c.status, company: c.company ?? '', jobTitle: c.jobTitle ?? '', address: c.address ?? '',
  city: c.city ?? '', country: c.country ?? '', preferredContactMethod: c.preferredContactMethod ?? '',
  preferredLanguage: c.preferredLanguage ?? '', tags: c.tags.join(', '), assignedTo: c.assignedTo ?? '', notes: c.notes ?? '',
});

/** clear=true (edit) sends null for emptied fields; clear=false (create) omits them. */
export function toContactPayload(v: ContactFormValues, clear: boolean): ContactPayload {
  const empty = clear ? null : undefined;
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: v.email.trim() || empty,
    phone: v.phone.trim() || empty,
    alternatePhone: v.alternatePhone.trim() || empty,
    contactType: v.contactType,
    status: v.status,
    company: v.company.trim() || empty,
    jobTitle: v.jobTitle.trim() || empty,
    address: v.address.trim() || empty,
    city: v.city.trim() || empty,
    country: v.country.trim() || empty,
    preferredContactMethod: v.preferredContactMethod || empty,
    preferredLanguage: v.preferredLanguage.trim() || empty,
    tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
    notes: v.notes.trim() || empty,
  };
}

/** Maps backend field paths onto form fields. */
export const SERVER_FIELD_MAP: Record<string, keyof ContactFormValues> = {
  firstName: 'firstName', lastName: 'lastName', email: 'email', phone: 'phone', alternatePhone: 'alternatePhone',
  contactType: 'contactType', company: 'company', jobTitle: 'jobTitle', address: 'address', city: 'city', country: 'country',
  preferredContactMethod: 'preferredContactMethod', preferredLanguage: 'preferredLanguage', tags: 'tags', notes: 'notes', assignedTo: 'assignedTo',
};