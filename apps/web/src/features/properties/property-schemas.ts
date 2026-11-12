// src/features/properties/property-schemas.ts
import { z } from 'zod';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';
import type { PropertyDto, PropertyPayload, RentPeriod } from '@/types/properties';
import { AREA_UNITS, FURNISHINGS, LISTING_TYPES, PROPERTY_TYPES, RENT_PERIODS } from './property-constants';

const tuple = <T extends string>(a: readonly T[]) => a as unknown as [T, ...T[]];
const whole = (label: string, max: number) =>
  z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max), `${label}: whole number, at most ${max}`);
const money = (label: string) => z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), `${label}: use a number like 1500 or 1500.50`);
const text = (max: number) => z.string().trim().max(max, 'Too long');
const currentYear = new Date().getFullYear();

export const propertyFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Too long'),
    description: z.string().max(10000, 'At most 10000 characters'),
    propertyType: z.enum(tuple(PROPERTY_TYPES)),
    listingType: z.enum(tuple(LISTING_TYPES)),
    rentPeriod: z.union([z.literal(''), z.enum(tuple(RENT_PERIODS))]),
    furnishingStatus: z.enum(tuple(FURNISHINGS)),
    price: z.string().trim(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
    securityDeposit: money('Deposit'),
    maintenance: money('Maintenance'),
    bedrooms: whole('Bedrooms', 50),
    bathrooms: whole('Bathrooms', 50),
    area: z.string().trim().refine((v) => v === '' || (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0), 'Area must be greater than 0'),
    areaUnit: z.enum(tuple(AREA_UNITS)),
    floors: whole('Floors', 200),
    parkingSpaces: whole('Parking', 100),
    yearBuilt: whole('Year built', 9999),
    address: text(300), city: text(100), state: text(100), country: text(100), postalCode: text(20),
    latitude: z.string().trim(), longitude: z.string().trim(),
    locationDescription: text(500),
    ownerContactId: z.string(), // '' = none
    assignedTo: z.string(), // '' = unassigned
    amenities: z.string().max(1500, 'Too long'),
  })
  .superRefine((v, ctx) => {
    const issue = (path: keyof typeof v, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.price === '' || !/^\d+(\.\d{1,2})?$/.test(v.price) || !(Number(v.price) > 0)) issue('price', 'Enter a price greater than 0');
    if (v.listingType === 'RENT' && !v.rentPeriod) issue('rentPeriod', 'Rent period is required for rentals');
    if (v.yearBuilt && (Number(v.yearBuilt) < 1800 || Number(v.yearBuilt) > currentYear + 5)) issue('yearBuilt', `Year must be between 1800 and ${currentYear + 5}`);
    if ((v.latitude === '') !== (v.longitude === '')) issue('latitude', 'Provide both latitude and longitude');
    if (v.latitude !== '' && !(Number.isFinite(Number(v.latitude)) && Math.abs(Number(v.latitude)) <= 90)) issue('latitude', 'Latitude must be between -90 and 90');
    if (v.longitude !== '' && !(Number.isFinite(Number(v.longitude)) && Math.abs(Number(v.longitude)) <= 180)) issue('longitude', 'Longitude must be between -180 and 180');
    if (v.amenities.split(',').map((a) => a.trim()).filter(Boolean).length > 50) issue('amenities', 'At most 50 amenities');
  });

export type PropertyFormValues = z.infer<typeof propertyFormSchema>;

export const defaultPropertyValues = (currency: string): PropertyFormValues => ({
  title: '', description: '', propertyType: 'HOUSE', listingType: 'SALE', rentPeriod: '', furnishingStatus: 'NOT_APPLICABLE',
  price: '', currency, securityDeposit: '', maintenance: '', bedrooms: '', bathrooms: '', area: '', areaUnit: 'SQFT',
  floors: '', parkingSpaces: '', yearBuilt: '', address: '', city: '', state: '', country: '', postalCode: '',
  latitude: '', longitude: '', locationDescription: '', ownerContactId: '', assignedTo: '', amenities: '',
});

const s = (n: number | null) => (n === null ? '' : String(n));
export const propertyToFormValues = (p: PropertyDto): PropertyFormValues => ({
  title: p.title, description: p.description ?? '', propertyType: p.propertyType, listingType: p.listingType, rentPeriod: p.rentPeriod ?? '',
  furnishingStatus: p.furnishingStatus, price: String(fromMinorUnits(p.priceAmount, p.currency)), currency: p.currency,
  securityDeposit: p.securityDepositAmount === null ? '' : String(fromMinorUnits(p.securityDepositAmount, p.currency)),
  maintenance: p.maintenanceChargesAmount === null ? '' : String(fromMinorUnits(p.maintenanceChargesAmount, p.currency)),
  bedrooms: s(p.bedrooms), bathrooms: s(p.bathrooms), area: s(p.area), areaUnit: p.areaUnit ?? 'SQFT', floors: s(p.floors),
  parkingSpaces: s(p.parkingSpaces), yearBuilt: s(p.yearBuilt), address: p.address ?? '', city: p.city ?? '', state: p.state ?? '',
  country: p.country ?? '', postalCode: p.postalCode ?? '', latitude: s(p.latitude), longitude: s(p.longitude),
  locationDescription: p.locationDescription ?? '', ownerContactId: p.ownerContactId ?? '', assignedTo: p.assignedTo ?? '',
  amenities: p.amenities.join(', '),
});

/** clear=true (edit) sends null for emptied fields; clear=false (create) omits them. Money leaves as integer minor units. */
export function toPropertyPayload(v: PropertyFormValues, clear: boolean): PropertyPayload {
  const empty = clear ? null : undefined;
  const cur = v.currency.trim().toUpperCase();
  const int = (x: string) => (x.trim() === '' ? empty : Number(x));
  const str = (x: string) => x.trim() || empty;
  const minor = (x: string) => (x.trim() === '' ? empty : toMinorUnits(Number(x), cur));
  return {
    title: v.title.trim(), description: str(v.description), propertyType: v.propertyType, listingType: v.listingType,
    priceAmount: toMinorUnits(Number(v.price), cur), currency: cur,
    rentPeriod: v.listingType === 'RENT' ? (v.rentPeriod as RentPeriod) : empty,
    securityDepositAmount: minor(v.securityDeposit), maintenanceChargesAmount: minor(v.maintenance),
    bedrooms: int(v.bedrooms), bathrooms: int(v.bathrooms), area: int(v.area), areaUnit: v.area.trim() ? v.areaUnit : empty,
    floors: int(v.floors), furnishingStatus: v.furnishingStatus, parkingSpaces: int(v.parkingSpaces), yearBuilt: int(v.yearBuilt),
    amenities: [...new Set(v.amenities.split(',').map((a) => a.trim()).filter(Boolean))],
    address: str(v.address), city: str(v.city), state: str(v.state), country: str(v.country), postalCode: str(v.postalCode),
    latitude: int(v.latitude), longitude: int(v.longitude), locationDescription: str(v.locationDescription),
    ownerContactId: v.ownerContactId || empty,
  };
}

export const SERVER_FIELD_MAP: Record<string, keyof PropertyFormValues> = {
  title: 'title', description: 'description', propertyType: 'propertyType', listingType: 'listingType', priceAmount: 'price',
  currency: 'currency', rentPeriod: 'rentPeriod', securityDepositAmount: 'securityDeposit', maintenanceChargesAmount: 'maintenance',
  bedrooms: 'bedrooms', bathrooms: 'bathrooms', area: 'area', areaUnit: 'areaUnit', floors: 'floors', parkingSpaces: 'parkingSpaces',
  yearBuilt: 'yearBuilt', address: 'address', city: 'city', state: 'state', country: 'country', postalCode: 'postalCode',
  latitude: 'latitude', longitude: 'longitude', ownerContactId: 'ownerContactId', assignedTo: 'assignedTo', amenities: 'amenities',
};