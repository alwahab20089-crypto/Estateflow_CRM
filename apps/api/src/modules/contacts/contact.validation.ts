import { z } from 'zod';
import { CONTACT_METHODS, CONTACT_STATUSES, CONTACT_TYPES, LEAD_SOURCES } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import { isoDate, optionalEmail, optionalPhone, optionalText } from '../leads/lead.validation';

const firstName = z.string().trim().min(1, 'First name is required').max(100);
const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(20, 'At most 20 tags')
  .transform((list) => [...new Set(list)]);

// No .default(): defaults are applied in the service so PATCH can never overwrite fields by accident.
// Unknown keys (organizationId, createdBy, linkedLeadId, deletedAt...) are stripped: no mass assignment.
const optionalFields = {
  lastName: z.string().trim().max(100).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  alternatePhone: optionalPhone,
  contactType: z.enum(CONTACT_TYPES).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  tags: tags.optional(),
  company: optionalText(150),
  jobTitle: optionalText(100),
  address: optionalText(300),
  city: optionalText(100),
  country: optionalText(100),
  preferredContactMethod: z.enum(CONTACT_METHODS).nullable().optional(),
  preferredLanguage: optionalText(40),
  source: z.enum(LEAD_SOURCES).nullable().optional(),
  notes: optionalText(5000),
};

export const createContactSchema = z
  .object({ firstName, assignedTo: objectIdSchema.nullable().optional(), ...optionalFields })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), { message: 'Provide a phone number or an email', path: ['phone'] });

// Assignment has its own endpoint and permission.
export const updateContactSchema = z
  .object({ firstName: firstName.optional(), ...optionalFields })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const convertLeadSchema = z
  .object({ existingContactId: objectIdSchema.optional() })
  .optional()
  .transform((v) => v ?? {});

export const listContactsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    contactType: z.enum(CONTACT_TYPES).optional(),
    status: z.enum(CONTACT_STATUSES).optional(),
    assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
    tag: z.string().trim().toLowerCase().max(40).optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    sortBy: z.enum(['createdAt', 'name', 'contactType', 'status']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    view: z.enum(['active', 'archived']).default('active'),
  })
  .strict(); // unknown filters -> 422

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;