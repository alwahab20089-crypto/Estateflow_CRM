import { apiRequest, apiRequestPaged } from '@/lib/api-client';
import type { LeadActivityDto, PageMeta } from '@/types/leads';
import type { ContactDetailDto, ContactDto, ContactListParams, ContactPayload, ConvertLeadResult } from '@/types/contacts';
import { endOfDay, startOfDay, toQuery } from './lead-service';

export const contactService = {
  list: (params: ContactListParams, signal?: AbortSignal) =>
    apiRequestPaged<ContactDto[], PageMeta>(
      `/contacts${toQuery({
        ...params,
        createdFrom: params.createdFrom ? startOfDay(params.createdFrom) : undefined,
        createdTo: params.createdTo ? endOfDay(params.createdTo) : undefined,
      })}`,
      { signal },
    ),
  get: (id: string) => apiRequest<ContactDetailDto>(`/contacts/${id}`),
  create: (body: ContactPayload) => apiRequestPaged<ContactDto, { duplicates: Array<{ _id: string; name: string }> }>('/contacts', { method: 'POST', body }),
  update: (id: string, body: ContactPayload) => apiRequest<ContactDto>(`/contacts/${id}`, { method: 'PATCH', body }),
  archive: (id: string) => apiRequest<ContactDto>(`/contacts/${id}`, { method: 'DELETE' }),
  restore: (id: string) => apiRequest<ContactDto>(`/contacts/${id}/restore`, { method: 'POST' }),
  assign: (id: string, assignedTo: string | null) => apiRequest<ContactDto>(`/contacts/${id}/assign`, { method: 'PATCH', body: { assignedTo } }),
  tags: () => apiRequest<string[]>('/contacts/tags'),
  activities: (id: string, params: { type?: string; limit: number }) =>
    apiRequestPaged<LeadActivityDto[], PageMeta>(`/contacts/${id}/activities${toQuery({ ...params, page: 1 })}`),
  addNote: (id: string, body: string) => apiRequest<LeadActivityDto>(`/contacts/${id}/notes`, { method: 'POST', body: { body } }),
  convertLead: (leadId: string, existingContactId?: string) =>
    apiRequest<ConvertLeadResult>(`/leads/${leadId}/convert-to-contact`, { method: 'POST', body: existingContactId ? { existingContactId } : {} }),
};