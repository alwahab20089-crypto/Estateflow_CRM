import { z } from 'zod';
import { AREA_UNITS, FURNISHING_STATUSES, LISTING_TYPES, MAX_MINOR_UNITS, PROPERTY_STATUSES, PROPERTY_TYPES, RENT_PERIODS } from '../../constants';
import { objectIdSchema } from '../../utils/object-id';
import { isoDate, optionalText } from '../leads/lead.validation';

export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
/** Money is always an integer count of minor units (e.g. cents). Floats are rejected. */
export const minorUnits = (min = 0) => z.number().int('Use whole minor units').min(min).max(MAX_MINOR_UNITS);

const count = (max: number) => z.number().int().min(0).max(max).nullable().optional();
const thisYear = new Date().getFullYear();

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: optionalText(10000),
  propertyType: z.enum(PROPERTY_TYPES),
  listingType: z.enum(LISTING_TYPES),
  priceAmount: minorUnits(1), // BR-21: price must be > 0
  currency: currencySchema.optional(), // defaults to the organization currency
  rentPeriod: z.enum(RENT_PERIODS).nullable().optional(),
  securityDepositAmount: minorUnits().nullable().optional(),
  maintenanceChargesAmount: minorUnits().nullable().optional(),
  bedrooms: count(50),
  bathrooms: count(50),
  area: z.number().positive('Area must be greater than 0').max(1e9).nullable().optional(),
  areaUnit: z.enum(AREA_UNITS).nullable().optional(),
  floors: count(200),
  furnishingStatus: z.enum(FURNISHING_STATUSES).optional(),
  parkingSpaces: count(100),
  yearBuilt: z.number().int().min(1800).max(thisYear + 5).nullable().optional(),
  amenities: z
    .array(z.string().trim().min(1).max(60))
    .max(50, 'At most 50 amenities')
    .transform((l) => [...new Set(l)])
    .optional(),
  address: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  postalCode: optionalText(20),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationDescription: optionalText(500),
  ownerContactId: objectIdSchema.nullable().optional(),
  assignedTo: objectIdSchema.nullable().optional(),
};

// Unknown keys (organizationId, createdBy, images, closedByDealId, deletedAt...) are stripped: no mass assignment.
const coordsPaired = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude == null) === (v.longitude == null);
const rentNeedsPeriod = (v: { listingType?: string; rentPeriod?: string | null }) =>
  v.listingType !== 'RENT' || Boolean(v.rentPeriod);

export const createPropertySchema = z
  .object(fields)
  .refine(coordsPaired, { message: 'Provide both latitude and longitude', path: ['latitude'] })
  .refine(rentNeedsPeriod, { message: 'Rent period is required for rentals', path: ['rentPeriod'] });

// assignedTo has its own endpoint/permission; status has its own endpoint.
const { assignedTo: _a, ...updatable } = fields;
export const updatePropertySchema = z
  .object(Object.fromEntries(Object.entries(updatable).map(([k, v]) => [k, (v as z.ZodType).optional()])) as {
    [K in keyof typeof updatable]: z.ZodOptional<(typeof updatable)[K]>;
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update')
  .refine(coordsPaired, { message: 'Provide both latitude and longitude', path: ['latitude'] });

export const propertyStatusSchema = z.object({ propertyStatus: z.enum(PROPERTY_STATUSES) });

export const listPropertiesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    listingType: z.enum(LISTING_TYPES).optional(),
    propertyStatus: z.enum(PROPERTY_STATUSES).optional(),
    assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
    ownerContactId: objectIdSchema.optional(),
    city: z.string().trim().max(100).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    minArea: z.coerce.number().positive().optional(),
    maxArea: z.coerce.number().positive().optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    includeClosed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    sortBy: z.enum(['createdAt', 'price', 'title', 'area']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    view: z.enum(['active', 'archived']).default('active'),
  })
  .strict()
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, { message: 'minPrice must not exceed maxPrice', path: ['minPrice'] })
  .refine((v) => v.minArea === undefined || v.maxArea === undefined || v.minArea <= v.maxArea, { message: 'minArea must not exceed maxArea', path: ['minArea'] });

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;