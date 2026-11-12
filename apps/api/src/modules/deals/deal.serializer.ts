import type { Types } from 'mongoose';
import type { UserBrief } from '../leads/lead.serializer';

type Id = Types.ObjectId | string;
const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

export interface DealLike {
  _id: Id; title: string; description?: string | null; contactId: Id; leadId?: Id | null; propertyId: Id;
  dealType: string; stage: string; valueAmount: number; currency: string; probability: number;
  expectedClosingDate?: Date | null; actualClosingDate?: Date | null; assignedTo?: Id | null;
  lostReason?: string | null; notes?: string | null; stageChangedAt?: Date | null; createdBy: Id;
  deletedAt?: Date | null; createdAt: Date; updatedAt: Date;
}

export interface DealBriefs {
  assignee: UserBrief | null;
  contact: { _id: string; fullName: string } | null;
  lead: { _id: string; name: string } | null;
  property: { _id: string; title: string; city: string | null; propertyStatus: string } | null;
}

/** Explicit allow-list: organizationId, searchKeywords and deletedBy never leave the API. */
export function toDealDto(d: DealLike, b: DealBriefs) {
  return {
    _id: String(d._id),
    title: d.title,
    description: d.description ?? null,
    contactId: String(d.contactId),
    contact: b.contact,
    leadId: d.leadId ? String(d.leadId) : null,
    lead: b.lead,
    propertyId: String(d.propertyId),
    property: b.property,
    dealType: d.dealType,
    stage: d.stage,
    valueAmount: d.valueAmount, // integer minor units
    currency: d.currency,
    probability: d.probability,
    expectedClosingDate: iso(d.expectedClosingDate),
    actualClosingDate: iso(d.actualClosingDate),
    assignedTo: d.assignedTo ? String(d.assignedTo) : null,
    assignee: b.assignee ? { _id: String(b.assignee._id), name: b.assignee.name, email: b.assignee.email, avatar: b.assignee.avatar ?? undefined } : null,
    lostReason: d.lostReason ?? null,
    notes: d.notes ?? null,
    stageChangedAt: iso(d.stageChangedAt),
    createdBy: String(d.createdBy),
    deletedAt: iso(d.deletedAt),
    createdAt: iso(d.createdAt)!,
    updatedAt: iso(d.updatedAt)!,
  };
}