// src/features/deals/deal-form-dialog.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EntityPicker, type PickerOption } from '@/components/common/entity-picker';
import { fieldA11y } from '@/components/common/field-a11y';
import { FormField } from '@/components/common/form-field';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import { formatMinor, fromMinorUnits } from '@/lib/money';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/auth-provider';
import { contactService } from '@/services/contact-service';
import { leadService } from '@/services/lead-service';
import { propertyService } from '@/services/property-service';
import type { ContactListParams } from '@/types/contacts';
import type { DealDto } from '@/types/deals';
import type { LeadListParams } from '@/types/leads';
import type { PropertyDto } from '@/types/properties';
import { dealFormSchema, dealToFormValues, defaultDealValues, SERVER_FIELD_MAP, toDealPayload, type DealFormValues } from './deal-schemas';
import { useCreateDeal, useUpdateDeal } from './use-deals';

const NONE = 'none';
export interface DealDefaults { contact?: { id: string; label: string }; lead?: { id: string; label: string }; property?: PropertyDto }
interface Props { open: boolean; onOpenChange: (open: boolean) => void; deal?: DealDto | null; defaults?: DealDefaults; onCreated?: (deal: DealDto) => void }

export function DealFormDialog({ open, onOpenChange, deal, defaults, onCreated }: Props) {
  const isEdit = Boolean(deal);
  const { can, activeMembership } = useAuth();
  const orgCurrency = activeMembership?.organization.currency ?? 'USD';
  const canAssign = can('deals:assign') && !isEdit;
  const members = useMembers(open && canAssign);
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const saving = create.isPending || update.isPending;
  const [labels, setLabels] = useState<{ contact?: string; lead?: string; property?: string }>({});

  const initial = () => deal ? dealToFormValues(deal) : defaultDealValues(defaults?.property?.currency ?? orgCurrency, {
    contactId: defaults?.contact?.id ?? '', leadId: defaults?.lead?.id ?? '', propertyId: defaults?.property?._id ?? '',
    dealType: defaults?.property?.listingType ?? 'SALE',
    value: defaults?.property ? String(fromMinorUnits(defaults.property.priceAmount, defaults.property.currency)) : '',
  });
  const { register, control, handleSubmit, reset, setError, setValue, getValues, formState: { errors } } = useForm<DealFormValues>({ resolver: zodResolver(dealFormSchema), defaultValues: initial() });

  useEffect(() => {
    if (!open) return;
    reset(initial());
    setLabels({
      contact: deal?.contact?.fullName ?? defaults?.contact?.label, lead: deal?.lead?.name ?? defaults?.lead?.label,
      property: deal?.property?.title ?? defaults?.property?.title,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal, defaults, reset]);

  const searchContacts = async (q: string): Promise<PickerOption[]> => {
    const { data } = await contactService.list({ page: 1, limit: 20, search: q || undefined, sortBy: 'name', sortOrder: 'asc', view: 'active' } as unknown as ContactListParams);
    return data.map((c) => ({ id: c._id, label: c.fullName, description: c.company ?? c.email ?? undefined }));
  };
  const searchLeads = async (q: string): Promise<PickerOption[]> => {
    const { data } = await leadService.list({ page: 1, limit: 20, search: q || undefined, sortBy: 'createdAt', sortOrder: 'desc' } as unknown as LeadListParams);
    return data.map((l) => ({ id: l._id, label: `${l.firstName} ${l.lastName}`.trim(), description: l.status }));
  };
  const searchProperties = async (q: string): Promise<PickerOption[]> => {
    const { data } = await propertyService.list({ page: 1, limit: 20, search: q || undefined, listingType: getValues('dealType'), sortBy: 'title', sortOrder: 'asc', view: 'active' });
    return data.map((p) => ({ id: p._id, label: p.title, description: formatMinor(p.priceAmount, p.currency, true), data: p }));
  };

  const onSubmit = async (values: DealFormValues) => {
    if (saving) return;
    try {
      if (deal) {
        await update.mutateAsync({ id: deal._id, payload: toDealPayload(values, true) });
        toast.success('Deal updated');
      } else {
        const created = await create.mutateAsync({ ...toDealPayload(values, false), assignedTo: values.assignedTo || undefined });
        toast.success('Deal created');
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const d of err.errors) {
          const field = d.path ? SERVER_FIELD_MAP[d.path] : undefined;
          if (field) setError(field, { message: d.message });
        }
      }
      toast.error(errorMessage(err, 'Could not save the deal'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit deal' : 'New deal'}</DialogTitle>
            <DialogDescription>{isEdit ? 'Update the deal details. Use the pipeline to change its stage.' : 'Connect a contact to a property. New deals start in the New stage.'}</DialogDescription>
          </DialogHeader>

          <FormField id="deal-title" label="Title *" error={errors.title?.message}>
            <Input autoComplete="off" {...fieldA11y('deal-title', errors.title?.message)} {...register('title')} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="deal-type" label="Deal type">
              <Controller control={control} name="dealType" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); setValue('propertyId', ''); setLabels((l) => ({ ...l, property: undefined })); }}>
                  <SelectTrigger id="deal-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{['SALE', 'RENT', 'LEASE'].map((t) => <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField id="deal-property" label="Property *" error={errors.propertyId?.message}>
              <Controller control={control} name="propertyId" render={({ field }) => (
                <EntityPicker id="deal-property" label="Property" value={field.value} valueLabel={labels.property} placeholder="Select a property" search={searchProperties} invalid={Boolean(errors.propertyId)}
                  onChange={(id, o) => {
                    field.onChange(id);
                    setLabels((l) => ({ ...l, property: o?.label }));
                    const p = o?.data as PropertyDto | undefined;
                    if (p) { setValue('currency', p.currency); if (!getValues('value')) setValue('value', String(fromMinorUnits(p.priceAmount, p.currency))); }
                  }} />
              )} />
            </FormField>
            <FormField id="deal-contact" label="Contact *" error={errors.contactId?.message}>
              <Controller control={control} name="contactId" render={({ field }) => (
                <EntityPicker id="deal-contact" label="Contact" value={field.value} valueLabel={labels.contact} placeholder="Select a contact" search={searchContacts} invalid={Boolean(errors.contactId)}
                  onChange={(id, o) => { field.onChange(id); setLabels((l) => ({ ...l, contact: o?.label })); }} />
              )} />
            </FormField>
            <FormField id="deal-lead" label="Lead (optional)" error={errors.leadId?.message}>
              <Controller control={control} name="leadId" render={({ field }) => (
                <EntityPicker id="deal-lead" label="Lead" value={field.value} valueLabel={labels.lead} placeholder="Link a lead" search={searchLeads} allowClear
                  onChange={(id, o) => { field.onChange(id); setLabels((l) => ({ ...l, lead: o?.label })); }} />
              )} />
            </FormField>
            <FormField id="deal-value" label="Deal value *" error={errors.value?.message} hint="In major units, e.g. 250000">
              <Input inputMode="decimal" {...fieldA11y('deal-value', errors.value?.message)} {...register('value')} />
            </FormField>
            <FormField id="deal-currency" label="Currency" error={errors.currency?.message}>
              <Input {...fieldA11y('deal-currency', errors.currency?.message)} {...register('currency')} />
            </FormField>
            <FormField id="deal-close" label="Expected closing date" error={errors.expectedClosingDate?.message}>
              <Input type="date" {...fieldA11y('deal-close', errors.expectedClosingDate?.message)} {...register('expectedClosingDate')} />
            </FormField>
            {canAssign && (
              <FormField id="deal-assignee" label="Assigned agent">
                <Controller control={control} name="assignedTo" render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                    <SelectTrigger id="deal-assignee" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>Unassigned</SelectItem>{(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </FormField>
            )}
          </div>
          <FormField id="deal-notes" label="Notes" error={errors.notes?.message}>
            <Textarea rows={3} {...fieldA11y('deal-notes', errors.notes?.message)} {...register('notes')} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <LoadingButton type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create deal'}</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}