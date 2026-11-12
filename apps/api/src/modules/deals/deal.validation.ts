import { z } from 'zod';
import { DEAL_STAGES, DEAL_TYPES } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import { isoDate, optionalText } from '../leads/lead.validation';
import { currencySchema, minorUnits } from '../properties/property.validation';

const title = z.string().trim().min(1, 'Title is required').max(200);
const probability = z.number().int().min(0).max(100);

// Unknown keys (organizationId, createdBy, stage, actualClosingDate, lostReason...) are stripped.
export const createDealSchema = z.object({
  title,
  description: optionalText(5000),
  contactId: objectIdSchema,
  leadId: objectIdSchema.nullable().optional(),
  propertyId: objectIdSchema,
  dealType: z.enum(DEAL_TYPES),
  valueAmount: minorUnits(1),
  currency: currencySchema.optional(), // defaults to the property's currency
  probability: probability.optional(),
  expectedClosingDate: isoDate.nullable().optional(),
  notes: optionalText(5000),
  assignedTo: objectIdSchema.nullable().optional(),
});

export const updateDealSchema = z
  .object({
    title: title.optional(),
    description: optionalText(5000),
    contactId: objectIdSchema.optional(),
    leadId: objectIdSchema.nullable().optional(),
    propertyId: objectIdSchema.optional(),
    dealType: z.enum(DEAL_TYPES).optional(),
    valueAmount: minorUnits(1).optional(),
    currency: currencySchema.optional(),
    probability: probability.optional(),
    expectedClosingDate: isoDate.nullable().optional(),
    notes: optionalText(5000),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const dealStageSchema = z.object({ stage: z.enum(DEAL_STAGES), probability: probability.optional() });
export const closeWonSchema = z
  .object({ actualClosingDate: isoDate.optional(), valueAmount: minorUnits(1).optional(), notes: optionalText(5000) })
  .optional()
  .transform((v) => v ?? {});
export const closeLostSchema = z.object({ lostReason: z.string().trim().min(1, 'A lost reason is required').max(1000) });
export const reopenSchema = z.object({ reason: z.string().trim().min(1, 'A reason is required to reopen a deal').max(1000) });

export const listDealsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    stage: z.enum(DEAL_STAGES).optional(),
    dealType: z.enum(DEAL_TYPES).optional(),
    assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
    contactId: objectIdSchema.optional(),
    propertyId: objectIdSchema.optional(),
    leadId: objectIdSchema.optional(),
    expectedClosingFrom: isoDate.optional(),
    expectedClosingTo: isoDate.optional(),
    minValue: z.coerce.number().int().min(0).optional(),
    maxValue: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(['createdAt', 'value', 'expectedClosingDate', 'title']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  .refine((v) => v.minValue === undefined || v.maxValue === undefined || v.minValue <= v.maxValue, { message: 'minValue must not exceed maxValue', path: ['minValue'] });

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealStageInput = z.infer<typeof dealStageSchema>;
export type CloseWonInput = z.infer<typeof closeWonSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;