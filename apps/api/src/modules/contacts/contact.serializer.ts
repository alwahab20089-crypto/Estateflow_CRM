import type { Types } from 'mongoose';
import type { UserBrief } from '../leads/lead.serializer';

type Id = Types.ObjectId | string;

export interface ContactLike {
  _id: Id;
  assignedTo?: Id | null;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  contactType: string;
  status: string;
  tags?: string[] | null;
  company?: string | null;
  jobTitle?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  preferredContactMethod?: string | null;
  preferredLanguage?: string | null;
  source?: string | null;
  notes?: string | null;
  linkedLeadId?: Id | null;
  createdBy: Id;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
export const fullName = (c: { firstName: string; lastName?: string | null }) => `${c.firstName} ${c.lastName ?? ''}`.trim();

/** Explicit allow-list: organizationId, nameSort, searchKeywords and deletedBy never leave the API. */
export function toContactDto(c: ContactLike, assignee: UserBrief | null) {
  return {
    _id: String(c._id),
    firstName: c.firstName,
    lastName: c.lastName ?? '',
    fullName: fullName(c), // computed, not stored
    email: c.email ?? null,
    phone: c.phone ?? null,
    alternatePhone: c.alternatePhone ?? null,
    contactType: c.contactType,
    status: c.status,
    tags: c.tags ? [...c.tags] : [],
    company: c.company ?? null,
    jobTitle: c.jobTitle ?? null,
    address: c.address ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    preferredContactMethod: c.preferredContactMethod ?? null,
    preferredLanguage: c.preferredLanguage ?? null,
    source: c.source ?? null,
    notes: c.notes ?? null,
    assignedTo: c.assignedTo ? String(c.assignedTo) : null,
    assignee: assignee
      ? { _id: String(assignee._id), name: assignee.name, email: assignee.email, avatar: assignee.avatar ?? undefined }
      : null,
    linkedLeadId: c.linkedLeadId ? String(c.linkedLeadId) : null,
    createdBy: String(c.createdBy),
    deletedAt: iso(c.deletedAt),
    createdAt: iso(c.createdAt)!,
    updatedAt: iso(c.updatedAt)!,
  };
}