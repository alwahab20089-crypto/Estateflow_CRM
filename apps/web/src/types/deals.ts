// src/types/deals.ts
import type { PageMeta } from '@/types/leads';
import type { ListingKind, PropertyStatusValue } from './properties';

export type DealStage = 'NEW' | 'QUALIFICATION' | 'PROPERTY_MATCHED' | 'VIEWING_SCHEDULED' | 'NEGOTIATION' | 'CONTRACT' | 'WON' | 'LOST';

export interface DealDto {
  _id: string; title: string; description: string | null;
  contactId: string; contact: { _id: string; fullName: string } | null;
  leadId: string | null; lead: { _id: string; name: string } | null;
  propertyId: string; property: { _id: string; title: string; city: string | null; propertyStatus: PropertyStatusValue } | null;
  dealType: ListingKind; stage: DealStage; valueAmount: number; currency: string; probability: number; // minor units
  expectedClosingDate: string | null; actualClosingDate: string | null;
  assignedTo: string | null; assignee: { _id: string; name: string; email: string; avatar?: string } | null;
  lostReason: string | null; notes: string | null; stageChangedAt: string | null;
  createdBy: string; deletedAt: string | null; createdAt: string; updatedAt: string;
}

export interface DealListParams {
  page: number; limit: number; search?: string; stage?: DealStage; dealType?: ListingKind;
  assignedTo?: string; contactId?: string; propertyId?: string; leadId?: string;
  expectedClosingFrom?: string; expectedClosingTo?: string; minValue?: number; maxValue?: number;
  sortBy: 'createdAt' | 'value' | 'expectedClosingDate' | 'title'; sortOrder: 'asc' | 'desc';
}
export type DealListMeta = PageMeta & { summary: Array<{ stage: DealStage; currency: string; count: number; totalAmount: number }> };
export type DealListResult = { data: DealDto[]; meta: DealListMeta };

export interface DealPayload {
  title?: string; description?: string | null; contactId?: string; leadId?: string | null; propertyId?: string;
  dealType?: ListingKind; valueAmount?: number; currency?: string; probability?: number;
  expectedClosingDate?: string | null; notes?: string | null; assignedTo?: string | null;
}
export interface CloseWonPayload { actualClosingDate?: string; valueAmount?: number; notes?: string }