import type { Types } from 'mongoose';
import type { UserBrief } from '../leads/lead.serializer';

type Id = Types.ObjectId | string;
const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

export interface PropertyLike {
  _id: Id;
  title: string;
  description?: string | null;
  propertyType: string;
  listingType: string;
  propertyStatus: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area?: number | null;
  areaUnit?: string | null;
  floors?: number | null;
  furnishingStatus?: string | null;
  parkingSpaces?: number | null;
  yearBuilt?: number | null;
  amenities?: string[] | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationDescription?: string | null;
  priceAmount: number;
  currency: string;
  rentPeriod?: string | null;
  securityDepositAmount?: number | null;
  maintenanceChargesAmount?: number | null;
  ownerContactId?: Id | null;
  assignedTo?: Id | null;
  createdBy: Id;
  images?: Array<{ _id: Id; url: string; mimeType: string; size: number; originalName?: string | null; uploadedAt?: Date | null }> | null;
  primaryImage?: Id | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Explicit allow-list: organizationId, storage keys, searchKeywords, closedByDealId and deletedBy never leave the API. */
export function toPropertyDto(p: PropertyLike, assignee: UserBrief | null, owner: { _id: string; fullName: string } | null) {
  const images = (p.images ?? []).map((i) => ({
    _id: String(i._id), url: i.url, mimeType: i.mimeType, size: i.size, originalName: i.originalName ?? null, uploadedAt: iso(i.uploadedAt),
  }));
  const primary = images.find((i) => i._id === String(p.primaryImage)) ?? images[0] ?? null;
  return {
    _id: String(p._id),
    title: p.title,
    description: p.description ?? null,
    propertyType: p.propertyType,
    listingType: p.listingType,
    propertyStatus: p.propertyStatus,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    area: p.area ?? null,
    areaUnit: p.areaUnit ?? null,
    floors: p.floors ?? null,
    furnishingStatus: p.furnishingStatus ?? 'NOT_APPLICABLE',
    parkingSpaces: p.parkingSpaces ?? null,
    yearBuilt: p.yearBuilt ?? null,
    amenities: p.amenities ? [...p.amenities] : [],
    address: p.address ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    postalCode: p.postalCode ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    locationDescription: p.locationDescription ?? null,
    priceAmount: p.priceAmount, // integer minor units
    currency: p.currency,
    rentPeriod: p.rentPeriod ?? null,
    securityDepositAmount: p.securityDepositAmount ?? null,
    maintenanceChargesAmount: p.maintenanceChargesAmount ?? null,
    ownerContactId: p.ownerContactId ? String(p.ownerContactId) : null,
    owner,
    assignedTo: p.assignedTo ? String(p.assignedTo) : null,
    assignee: assignee ? { _id: String(assignee._id), name: assignee.name, email: assignee.email, avatar: assignee.avatar ?? undefined } : null,
    images,
    primaryImageId: primary?._id ?? null,
    primaryImageUrl: primary?.url ?? null, // relative for local storage: the web app prefixes the API origin
    createdBy: String(p.createdBy),
    deletedAt: iso(p.deletedAt),
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
  };
}