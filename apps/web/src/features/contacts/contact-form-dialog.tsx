import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormField } from '@/components/common/form-field';
import { fieldA11y } from '@/components/common/field-a11y';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import type { ContactDto } from '@/types/contacts';
import { CONTACT_METHODS, CONTACT_STATUSES, CONTACT_TYPES } from './contact-constants';
import {
  contactFormSchema, contactToFormValues, defaultContactValues, SERVER_FIELD_MAP, toContactPayload, type ContactFormValues,
} from './contact-schemas';
import { useCreateContact, useUpdateContact } from './use-contacts';

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ContactDto | null; // present = edit mode
}

const NONE = 'none';

export function ContactFormDialog({ open, onOpenChange, contact }: ContactFormDialogProps) {
  const isEdit = Boolean(contact);
  const { can } = useAuth();
  const canAssign = can('contacts:assign') && !isEdit; // later reassignment has its own audited action
  const members = useMembers(open && canAssign);
  const create = useCreateContact();
  const update = useUpdateContact();
  const saving = create.isPending || update.isPending;

  const {
    register, control, handleSubmit, reset, setError,
    formState: { errors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: contact ? contactToFormValues(contact) : defaultContactValues(),
  });

  useEffect(() => {
    if (open) reset(contact ? contactToFormValues(contact) : defaultContactValues());
  }, [open, contact, reset]);

  const onSubmit = async (values: ContactFormValues) => {
    if (saving) return; // prevents duplicate submissions
    try {
      if (contact) {
        await update.mutateAsync({ id: contact._id, payload: toContactPayload(values, true) });
        toast.success('Contact updated');
      } else {
        const payload = { ...toContactPayload(values, false), assignedTo: values.assignedTo || undefined };
        const { meta } = await create.mutateAsync(payload);
        toast.success('Contact created');
        if (meta.duplicates?.length) {
          toast.warning('Possible duplicate contact', { description: `Same phone as ${meta.duplicates.map((d) => d.name).join(', ')}.` });
        }
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const detail of err.errors) {
          const field = detail.path ? SERVER_FIELD_MAP[detail.path] : undefined;
          if (field) setError(field, { message: detail.message });
        }
      }
      toast.error(errorMessage(err, 'Could not save the contact'));
    }
  };

  const text = (name: 'company' | 'jobTitle' | 'address' | 'city' | 'country' | 'preferredLanguage', id: string, label: string, className?: string) => (
    <FormField id={id} label={label} error={errors[name]?.message} className={className}>
      <Input {...fieldA11y(id, errors[name]?.message)} {...register(name)} />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit contact' : 'Add contact'}</DialogTitle>
            <DialogDescription>{isEdit ? 'Update this contact’s details.' : 'Name plus a phone number or an email is enough to start.'}</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Identity</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="contact-first" label="First name *" error={errors.firstName?.message}>
                <Input autoComplete="off" {...fieldA11y('contact-first', errors.firstName?.message)} {...register('firstName')} />
              </FormField>
              <FormField id="contact-last" label="Last name" error={errors.lastName?.message}>
                <Input autoComplete="off" {...fieldA11y('contact-last', errors.lastName?.message)} {...register('lastName')} />
              </FormField>
              <FormField id="contact-email" label="Email" error={errors.email?.message}>
                <Input type="email" {...fieldA11y('contact-email', errors.email?.message)} {...register('email')} />
              </FormField>
              <FormField id="contact-phone" label="Phone" error={errors.phone?.message}>
                <Input type="tel" {...fieldA11y('contact-phone', errors.phone?.message)} {...register('phone')} />
              </FormField>
              <FormField id="contact-alt" label="Alternate phone" error={errors.alternatePhone?.message}>
                <Input type="tel" {...fieldA11y('contact-alt', errors.alternatePhone?.message)} {...register('alternatePhone')} />
              </FormField>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Classification</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="contact-type" label="Contact type">
                <Controller
                  control={control}
                  name="contactType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="contact-type" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTACT_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              {isEdit && (
                <FormField id="contact-status" label="Status">
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="contact-status" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONTACT_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              )}
              <FormField id="contact-tags" label="Tags" hint="Separate with commas" error={errors.tags?.message} className="sm:col-span-2">
                <Input placeholder="vip, investor" {...fieldA11y('contact-tags', errors.tags?.message)} {...register('tags')} />
              </FormField>
              {canAssign && (
                <FormField id="contact-assignee" label="Assigned member" className="sm:col-span-2">
                  <Controller
                    control={control}
                    name="assignedTo"
                    render={({ field }) => (
                      <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                        <SelectTrigger id="contact-assignee" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Unassigned</SelectItem>
                          {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Company and address</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {text('company', 'contact-company', 'Company')}
              {text('jobTitle', 'contact-job', 'Job title')}
              {text('address', 'contact-address', 'Address', 'sm:col-span-2')}
              {text('city', 'contact-city', 'City')}
              {text('country', 'contact-country', 'Country')}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Preferences and notes</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="contact-method" label="Preferred contact method">
                <Controller
                  control={control}
                  name="preferredContactMethod"
                  render={({ field }) => (
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <SelectTrigger id="contact-method" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No preference</SelectItem>
                        {CONTACT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              {text('preferredLanguage', 'contact-language', 'Preferred language')}
            </div>
            <FormField id="contact-notes" label="Notes" error={errors.notes?.message}>
              <Textarea rows={3} {...fieldA11y('contact-notes', errors.notes?.message)} {...register('notes')} />
            </FormField>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <LoadingButton type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create contact'}</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}