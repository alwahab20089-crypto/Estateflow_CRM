// src/types/properties.ts
import type { PageMeta } from '@/types/leads';

export type PropertyCategory = 'HOUSE' | 'APARTMENT' | 'PLOT' | 'COMMERCIAL' | 'OFFICE' | 'FARMHOUSE' | 'OTHER';
export type ListingKind = 'SALE' | 'RENT' | 'LEASE';
export type PropertyStatusValue = 'DRAFT' | 'AVAILABLE' | 'UNDER_OFFER' | 'RESERVED' | 'SOLD' | 'RENTED' | 'LEASED' | 'INACTIVE';
export type AreaUnit = 'SQFT' | 'SQM' | 'MARLA' | 'KANAL' | 'ACRE';
export type Furnishing = 'FURNISHED' | 'SEMI_FURNISHED' | 'UNFURNISHED' | 'NOT_APPLICABLE';
export type RentPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface PropertyImageDto { _id: string; url: string; mimeType: string; size: number; originalName: string | null; uploadedAt: string | null }

export interface PropertyDto {
  _id: string; title: string; description: string | null;
  propertyType: PropertyCategory; listingType: ListingKind; propertyStatus: PropertyStatusValue;
  bedrooms: number | null; bathrooms: number | null; area: number | null; areaUnit: AreaUnit | null;
  floors: number | null; furnishingStatus: Furnishing; parkingSpaces: number | null; yearBuilt: number | null;
  amenities: string[]; address: string | null; city: string | null; state: string | null; country: string | null; postalCode: string | null;
  latitude: number | null; longitude: number | null; locationDescription: string | null;
  priceAmount: number; currency: string; rentPeriod: RentPeriod | null; // minor units
  securityDepositAmount: number | null; maintenanceChargesAmount: number | null;
  ownerContactId: string | null; owner: { _id: string; fullName: string } | null;
  assignedTo: string | null; assignee: { _id: string; name: string; email: string; avatar?: string } | null;
  images: PropertyImageDto[]; primaryImageId: string | null; primaryImageUrl: string | null;
  createdBy: string; deletedAt: string | null; createdAt: string; updatedAt: string;
}

export interface PropertyDetailDto extends PropertyDto {
  relatedDeals: Array<{ _id: string; title: string; stage: string; dealType: ListingKind; valueAmount: number; currency: string }>;
  relatedContacts: Array<{ _id: string; fullName: string }>;
  relatedLeads: Array<{ _id: string; name: string; status: string }>;
}

export type PropertySortField = 'createdAt' | 'price' | 'title' | 'area';

/** minPrice/maxPrice are MINOR units here (what the API takes). */
export interface PropertyListParams {
  page: number; limit: number; search?: string;
  propertyType?: PropertyCategory; listingType?: ListingKind; propertyStatus?: PropertyStatusValue;
  assignedTo?: string; ownerContactId?: string; city?: string;
  minPrice?: number; maxPrice?: number; minArea?: number; maxArea?: number;
  createdFrom?: string; createdTo?: string; includeClosed?: boolean;
  sortBy: PropertySortField; sortOrder: 'asc' | 'desc'; view: 'active' | 'archived';
}
export type PropertyListMeta = PageMeta & { statusCounts: Record<string, number> };

export interface PropertyPayload {
  title?: string; description?: string | null; propertyType?: PropertyCategory; listingType?: ListingKind;
  priceAmount?: number; currency?: string; rentPeriod?: RentPeriod | null;
  securityDepositAmount?: number | null; maintenanceChargesAmount?: number | null;
  bedrooms?: number | null; bathrooms?: number | null; area?: number | null; areaUnit?: AreaUnit | null;
  floors?: number | null; furnishingStatus?: Furnishing; parkingSpaces?: number | null; yearBuilt?: number | null;
  amenities?: string[]; address?: string | null; city?: string | null; state?: string | null; country?: string | null;
  postalCode?: string | null; latitude?: number | null; longitude?: number | null; locationDescription?: string | null;
  ownerContactId?: string | null; assignedTo?: string | null;
}