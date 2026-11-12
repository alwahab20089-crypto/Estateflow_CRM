// src/features/properties/property-constants.ts
import { PAGE_SIZES } from '@/features/leads/lead-constants';
import { formatMinor } from '@/lib/money';
import { humanize } from '@/lib/labels';
import type { AreaUnit, Furnishing, ListingKind, PropertyCategory, PropertyDto, PropertyStatusValue, RentPeriod } from '@/types/properties';

export { PAGE_SIZES };
export const PROPERTY_TYPES: PropertyCategory[] = ['HOUSE', 'APARTMENT', 'PLOT', 'COMMERCIAL', 'OFFICE', 'FARMHOUSE', 'OTHER'];
export const LISTING_TYPES: ListingKind[] = ['SALE', 'RENT', 'LEASE'];
export const PROPERTY_STATUSES: PropertyStatusValue[] = ['DRAFT', 'AVAILABLE', 'UNDER_OFFER', 'RESERVED', 'SOLD', 'RENTED', 'LEASED', 'INACTIVE'];
export const CLOSED_STATUSES: PropertyStatusValue[] = ['SOLD', 'RENTED', 'LEASED'];
export const AREA_UNITS: AreaUnit[] = ['SQFT', 'SQM', 'MARLA', 'KANAL', 'ACRE'];
export const AREA_UNIT_LABELS: Record<AreaUnit, string> = { SQFT: 'sq ft', SQM: 'sq m', MARLA: 'marla', KANAL: 'kanal', ACRE: 'acre' };
export const FURNISHINGS: Furnishing[] = ['FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED', 'NOT_APPLICABLE'];
export const RENT_PERIODS: RentPeriod[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
export const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'price:asc', label: 'Price: low to high' },
  { value: 'price:desc', label: 'Price: high to low' },
  { value: 'area:desc', label: 'Largest area' },
  { value: 'title:asc', label: 'Title A–Z' },
] as const;

export const MAX_IMAGES = 20;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Client-side pre-check for a better message. The server validates again (type, extension, real file content). */
export function validateImageFiles(files: File[], existing = 0): string | null {
  if (existing + files.length > MAX_IMAGES) return `A property can have at most ${MAX_IMAGES} images.`;
  const bad = files.find((f) => !IMAGE_TYPES.includes(f.type));
  if (bad) return `“${bad.name}” is not a JPEG, PNG or WebP image.`;
  const big = files.find((f) => f.size > MAX_IMAGE_BYTES);
  if (big) return `“${big.name}” is larger than 5 MB.`;
  return null;
}

export function formatPrice(p: Pick<PropertyDto, 'priceAmount' | 'currency' | 'listingType' | 'rentPeriod'>, compact = false) {
  const base = formatMinor(p.priceAmount, p.currency, compact);
  return p.listingType === 'RENT' && p.rentPeriod ? `${base} / ${humanize(p.rentPeriod).toLowerCase()}` : base;
}