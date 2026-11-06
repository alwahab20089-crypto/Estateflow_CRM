import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadKeys } from '@/features/leads/use-leads';
import { ApiError } from '@/lib/api-client';
import { contactService } from '@/services/contact-service';
import type { ContactListParams, ContactPayload } from '@/types/contacts';

const root = ['api', 'contacts'] as const;
export const contactKeys = {
  all: root,
  list: (params: ContactListParams) => [...root, 'list', params] as const,
  detail: (id: string) => [...root, 'detail', id] as const,
  activities: (id: string, type: string | undefined, limit: number) => [...root, 'activities', id, type ?? 'all', limit] as const,
  tags: [...root, 'tags'] as const,
};

const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && count < 1;

export function useContacts(params: ContactListParams) {
  return useQuery({
    queryKey: contactKeys.list(params),
    queryFn: ({ signal }) => contactService.list(params, signal),
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useContact(id: string | undefined) {
  return useQuery({ queryKey: contactKeys.detail(id ?? ''), queryFn: () => contactService.get(id as string), enabled: Boolean(id), retry });
}

export function useContactActivities(id: string, type: string | undefined, limit: number) {
  return useQuery({ queryKey: contactKeys.activities(id, type, limit), queryFn: () => contactService.activities(id, { type, limit }), placeholderData: keepPreviousData, retry });
}

export function useContactTags(enabled = true) {
  return useQuery({ queryKey: contactKeys.tags, queryFn: () => contactService.tags(), enabled, staleTime: 60_000, retry });
}

function useInvalidating<TVars, TData>(fn: (vars: TVars) => Promise<TData>, alsoLeads = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contactKeys.all });
      if (alsoLeads) await queryClient.invalidateQueries({ queryKey: leadKeys.all }); // conversion changes the lead too
    },
  });
}

export const useCreateContact = () => useInvalidating((payload: ContactPayload) => contactService.create(payload));
export const useUpdateContact = () => useInvalidating((v: { id: string; payload: ContactPayload }) => contactService.update(v.id, v.payload));
export const useArchiveContact = () => useInvalidating((id: string) => contactService.archive(id));
export const useRestoreContact = () => useInvalidating((id: string) => contactService.restore(id));
export const useAssignContact = () => useInvalidating((v: { id: string; assignedTo: string | null }) => contactService.assign(v.id, v.assignedTo));
export const useAddContactNote = () => useInvalidating((v: { id: string; body: string }) => contactService.addNote(v.id, v.body));
export const useConvertLeadToContact = () =>
  useInvalidating((v: { leadId: string; existingContactId?: string }) => contactService.convertLead(v.leadId, v.existingContactId), true);