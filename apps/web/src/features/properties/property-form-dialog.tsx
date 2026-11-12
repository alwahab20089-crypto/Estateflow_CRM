// src/features/properties/property-form-dialog.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { EntityPicker } from '@/components/common/entity-picker';
import { fieldA11y } from '@/components/common/field-a11y';
import { FormField } from '@/components/common/form-field';
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
import { contactService } from '@/services/contact-service';
import type { ContactListParams } from '@/types/contacts';
import type { PropertyDto } from '@/types/properties';
import { AREA_UNITS, AREA_UNIT_LABELS, FURNISHINGS, LISTING_TYPES, MAX_IMAGES, PROPERTY_TYPES, RENT_PERIODS, validateImageFiles } from './property-constants';
import { defaultPropertyValues, propertyFormSchema, propertyToFormValues, SERVER_FIELD_MAP, toPropertyPayload, type PropertyFormValues } from './property-schemas';
import { useCreateProperty, useUpdateProperty, useUploadPropertyImages } from './use-properties';

const NONE = 'none';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; property?: PropertyDto | null }

export function PropertyFormDialog({ open, onOpenChange, property }: Props) {
  const isEdit = Boolean(property);
  const { can, activeMembership } = useAuth();
  const orgCurrency = activeMembership?.organization.currency ?? 'USD';
  const canAssign = can('properties:assign') && !isEdit; // later reassignment is its own audited action
  const members = useMembers(open && canAssign);
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const upload = useUploadPropertyImages();
  const saving = create.isPending || update.isPending || upload.isPending;
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [ownerLabel, setOwnerLabel] = useState<string>();

  const { register, control, handleSubmit, reset, setError, watch, formState: { errors } } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: property ? propertyToFormValues(property) : defaultPropertyValues(orgCurrency),
  });
  const listingType = watch('listingType');

  useEffect(() => {
    if (!open) return;
    reset(property ? propertyToFormValues(property) : defaultPropertyValues(orgCurrency));
    setOwnerLabel(property?.owner?.fullName);
    setFiles([]);
    setFileError(undefined);
  }, [open, property, reset, orgCurrency]);

  const searchContacts = async (q: string) => {
    const params = { page: 1, limit: 20, search: q || undefined, sortBy: 'name', sortOrder: 'asc', view: 'active' } as unknown as ContactListParams;
    const { data } = await contactService.list(params);
    return data.map((c) => ({ id: c._id, label: c.fullName, description: c.company ?? c.email ?? undefined }));
  };

  const onFiles = (list: FileList | null) => {
    const next = Array.from(list ?? []);
    const problem = validateImageFiles(next);
    setFileError(problem ?? undefined);
    setFiles(problem ? [] : next);
  };

  const onSubmit = async (values: PropertyFormValues) => {
    if (saving) return; // no duplicate submissions
    try {
      if (property) {
        await update.mutateAsync({ id: property._id, payload: toPropertyPayload(values, true) });
        toast.success('Property updated');
      } else {
        const created = await create.mutateAsync({ ...toPropertyPayload(values, false), assignedTo: values.assignedTo || undefined });
        toast.success('Property created');
        if (files.length > 0) {
          try {
            await upload.mutateAsync({ id: created._id, files });
          } catch (err) {
            toast.warning('The property was saved, but the images could not be uploaded', { description: errorMessage(err, 'Add them from the property page.') });
          }
        }
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const d of err.errors) {
          const field = d.path ? SERVER_FIELD_MAP[d.path] : undefined;
          if (field) setError(field, { message: d.message });
        }
      }
      toast.error(errorMessage(err, 'Could not save the property'));
    }
  };

  const text = (name: keyof PropertyFormValues, id: string, label: string, opts: { className?: string; type?: string; inputMode?: 'numeric' | 'decimal'; hint?: string } = {}) => (
    <FormField id={id} label={label} error={errors[name]?.message} hint={opts.hint} className={opts.className}>
      <Input type={opts.type} inputMode={opts.inputMode} autoComplete="off" {...fieldA11y(id, errors[name]?.message)} {...register(name)} />
    </FormField>
  );
  const select = (name: 'propertyType' | 'listingType' | 'furnishingStatus' | 'areaUnit' | 'rentPeriod', id: string, label: string, options: Array<{ value: string; label: string }>, optional = false) => (
    <FormField id={id} label={label} error={errors[name]?.message}>
      <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
          <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {optional && <SelectItem value={NONE}>Not set</SelectItem>}
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )} />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit property' : 'Add property'}</DialogTitle>
            <DialogDescription>{isEdit ? 'Update this listing.' : 'A title, type and price are enough to start. You can add the rest later.'}</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Basic information</legend>
            {text('title', 'prop-title', 'Title *')}
            <FormField id="prop-desc" label="Description" error={errors.description?.message}>
              <Textarea rows={4} {...fieldA11y('prop-desc', errors.description?.message)} {...register('description')} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              {select('propertyType', 'prop-type', 'Property type', PROPERTY_TYPES.map((t) => ({ value: t, label: humanize(t) })))}
              {select('listingType', 'prop-listing', 'Listing type', LISTING_TYPES.map((t) => ({ value: t, label: `For ${t.toLowerCase()}` })))}
              {select('furnishingStatus', 'prop-furn', 'Furnishing', FURNISHINGS.map((t) => ({ value: t, label: humanize(t) })))}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Price</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              {text('price', 'prop-price', 'Price *', { inputMode: 'decimal', hint: 'In major units, e.g. 250000' })}
              {text('currency', 'prop-currency', 'Currency')}
              {listingType === 'RENT' && select('rentPeriod', 'prop-period', 'Rent period *', RENT_PERIODS.map((t) => ({ value: t, label: humanize(t) })), true)}
              {(listingType === 'RENT' || listingType === 'LEASE') && text('securityDeposit', 'prop-deposit', 'Security deposit', { inputMode: 'decimal' })}
              {text('maintenance', 'prop-maint', 'Maintenance charges', { inputMode: 'decimal' })}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Specifications</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              {text('bedrooms', 'prop-beds', 'Bedrooms', { inputMode: 'numeric' })}
              {text('bathrooms', 'prop-baths', 'Bathrooms', { inputMode: 'numeric' })}
              {text('area', 'prop-area', 'Area', { inputMode: 'decimal' })}
              {select('areaUnit', 'prop-unit', 'Area unit', AREA_UNITS.map((u) => ({ value: u, label: AREA_UNIT_LABELS[u] })))}
              {text('floors', 'prop-floors', 'Floors', { inputMode: 'numeric' })}
              {text('parkingSpaces', 'prop-parking', 'Parking spaces', { inputMode: 'numeric' })}
              {text('yearBuilt', 'prop-year', 'Year built', { inputMode: 'numeric' })}
            </div>
            {text('amenities', 'prop-amenities', 'Amenities', { hint: 'Separate with commas, e.g. Garden, Lift, Security' })}
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">Location</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {text('address', 'prop-address', 'Address', { className: 'sm:col-span-2' })}
              {text('city', 'prop-city', 'City')}
              {text('state', 'prop-state', 'State / province')}
              {text('country', 'prop-country', 'Country')}
              {text('postalCode', 'prop-postal', 'Postal code')}
              {text('latitude', 'prop-lat', 'Latitude', { inputMode: 'decimal' })}
              {text('longitude', 'prop-lng', 'Longitude', { inputMode: 'decimal' })}
              {text('locationDescription', 'prop-locdesc', 'Location notes', { className: 'sm:col-span-2' })}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-label mb-2">People</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="prop-owner" label="Owner contact" error={errors.ownerContactId?.message}>
                <Controller control={control} name="ownerContactId" render={({ field }) => (
                  <EntityPicker id="prop-owner" label="Owner contact" value={field.value} valueLabel={ownerLabel} placeholder="Select the owner" search={searchContacts} allowClear
                    onChange={(id, o) => { field.onChange(id); setOwnerLabel(o?.label); }} />
                )} />
              </FormField>
              {canAssign && (
                <FormField id="prop-assignee" label="Assigned agent">
                  <Controller control={control} name="assignedTo" render={({ field }) => (
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                      <SelectTrigger id="prop-assignee" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Unassigned</SelectItem>
                        {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                </FormField>
              )}
            </div>
          </fieldset>

          {!isEdit && (
            <fieldset className="space-y-2">
              <legend className="text-label mb-2">Images</legend>
              <label htmlFor="prop-images" className="text-sm">Choose up to {MAX_IMAGES} JPEG, PNG or WebP images (5 MB each). You can add more later.</label>
              <Input id="prop-images" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => onFiles(e.target.files)} aria-invalid={fileError ? true : undefined} />
              {fileError && <p role="alert" className="text-xs font-medium text-destructive">{fileError}</p>}
              {files.length > 0 && <p className="text-caption">{files.length} image{files.length === 1 ? '' : 's'} selected</p>}
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <LoadingButton type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create property'}</LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
