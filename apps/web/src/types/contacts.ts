import type { ContactType, LeadSource, LeadStatus, LeadType } from '@/types';
import type { LeadAssignee, LeadDto } from '@/types/leads';

export type ContactStatus = 'ACTIVE' | 'INACTIVE';
export type ContactMethod = 'PHONE' | 'EMAIL' | 'WHATSAPP' | 'SMS';

export interface ContactDto {
  _id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  contactType: ContactType;
  status: ContactStatus;
  tags: string[];
  company: string | null;
  jobTitle: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  preferredContactMethod: ContactMethod | null;
  preferredLanguage: string | null;
  source: LeadSource | null;
  notes: string | null;
  assignedTo: string | null;
  assignee: LeadAssignee | null;
  linkedLeadId: string | null;
  createdBy: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedLeadDto {
  _id: string;
  name: string;
  status: LeadStatus;
  leadType: LeadType;
  convertedAt: string | null;
}

export interface ContactDetailDto extends ContactDto {
  linkedLeads: LinkedLeadDto[];
}

export type ContactSortField = 'createdAt' | 'name' | 'contactType' | 'status';

export interface ContactListParams {
  page: number;
  limit: number;
  search?: string;
  contactType?: ContactType;
  status?: ContactStatus;
  assignedTo?: string;
  tag?: string;
  createdFrom?: string; // yyyy-mm-dd (local)
  createdTo?: string;
  sortBy: ContactSortField;
  sortOrder: 'asc' | 'desc';
  view: 'active' | 'archived';
}

/** Create: undefined = omit. Update: null = clear. */
export interface ContactPayload {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  contactType?: ContactType;
  status?: ContactStatus;
  tags?: string[];
  company?: string | null;
  jobTitle?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  preferredContactMethod?: ContactMethod | null;
  preferredLanguage?: string | null;
  notes?: string | null;
  assignedTo?: string | null;
}

export interface DuplicateContactMatch {
  _id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  contactType: ContactType;
  status: ContactStatus;
  matchedOn: Array<'email' | 'phone'>;
}

export interface ConvertLeadResult {
  lead: LeadDto;
  contact: ContactDto;
  linkedExisting: boolean;
}