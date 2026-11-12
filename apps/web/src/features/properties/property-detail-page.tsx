// src/features/properties/property-detail-page.tsx
import { ArchiveRestore, ArrowLeft, ImagePlus, Pencil, Trash2, UserCheck, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RelatedDealsCard } from '@/features/deals/related-cards';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDate, } from '@/lib/format';
import { formatMinor } from '@/lib/money';
import { humanize } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { assetUrl } from '@/services/property-service';
import type { PropertyDetailDto } from '@/types/properties';
import { ActivityList } from './activity-list';
import { AREA_UNIT_LABELS, formatPrice, validateImageFiles } from './property-constants';
import { PropertyAssignDialog, PropertyStatusDialog } from './property-dialogs';
import { PropertyFormDialog } from './property-form-dialog';
import { useDeleteProperty, useDeletePropertyImage, useProperty, usePropertyActivities, useRestoreProperty, useUploadPropertyImages } from './use-properties';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-caption">{label}</dt><dd className="mt-0.5 break-words text-sm">{children || '—'}</dd></div>;
}

function Gallery({ property, canEdit }: { property: PropertyDetailDto; canEdit: boolean }) {
  const upload = useUploadPropertyImages();
  const remove = useDeletePropertyImage();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const current = property.images.find((i) => i._id === (selected ?? property.primaryImageId)) ?? property.images[0];

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const problem = validateImageFiles(files, property.images.length);
    if (problem) return void toast.error(problem);
    try {
      await upload.mutateAsync({ id: property._id, files });
      toast.success(`${files.length} image${files.length === 1 ? '' : 's'} uploaded`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not upload the images'));
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync({ id: property._id, imageId: removing });
      setSelected(null);
      toast.success('Image removed');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove the image'));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-section-title">Photos ({property.images.length})</CardTitle>
        {canEdit && (
          <>
            <input ref={input} id="property-image-upload" type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => onFiles(e.target.files)} />
            <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}><ImagePlus /> {upload.isPending ? 'Uploading…' : 'Add photos'}</Button>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {current ? (
          <>
            <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-muted">
              <img src={assetUrl(current.url) ?? ''} alt={`${property.title} – main photo`} className="size-full object-contain" />
              {canEdit && (
                <Button type="button" size="icon" variant="secondary" className="absolute top-2 right-2" aria-label="Remove this photo" onClick={() => setRemoving(current._id)}><X /></Button>
              )}
            </div>
            {property.images.length > 1 && (
              <ul className="flex gap-2 overflow-x-auto" aria-label="Photo thumbnails">
                {property.images.map((img, i) => (
                  <li key={img._id}>
                    <button type="button" onClick={() => setSelected(img._id)} aria-label={`Show photo ${i + 1}`} aria-current={img._id === current._id}
                      className="block h-16 w-24 overflow-hidden rounded-md border-2 border-transparent focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:border-primary">
                      <img src={assetUrl(img.url) ?? ''} alt="" className="size-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <EmptyState title="No photos yet" description={canEdit ? 'Add photos to make this listing stand out.' : undefined} />
        )}
      </CardContent>
      <ConfirmDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} title="Remove this photo?" description="The photo is deleted from this property." confirmLabel="Remove photo" destructive onConfirm={confirmRemove} />
    </Card>
  );
}

export function PropertyDetailPage() {
  const { propertyId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: property, isLoading, isError, error, refetch } = useProperty(propertyId);
  const activities = usePropertyActivities(propertyId ?? '', 30);
  const archive = useDeleteProperty();
  const restore = useRestoreProperty();
  const [dialog, setDialog] = useState<'edit' | 'assign' | 'status' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading property" className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div>
      </div>
    );
  }
  if (isError || !property) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <EmptyState title="Property not found" description="It may have been archived, or you may not have access to it." action={<Button asChild variant="outline"><Link to="/app/properties">Back to properties</Link></Button>} />
    ) : (
      <ErrorState message={errorMessage(error, 'We could not load this property.')} onRetry={() => refetch()} />
    );
  }

  const archived = property.deletedAt !== null;
  const canUpdate = can('properties:update') && !archived;
  const onArchive = async () => {
    try {
      await archive.mutateAsync(property._id);
      toast.success('Property archived');
      navigate('/app/properties', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not archive the property'));
    }
  };
  const onRestore = async () => {
    try {
      await restore.mutateAsync(property._id);
      toast.success('Property restored');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not restore the property'));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/app/properties" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Properties</Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-page-title">{property.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={property.propertyStatus} />
            <Badge variant="secondary">{humanize(property.propertyType)}</Badge>
            <Badge variant="outline">For {property.listingType.toLowerCase()}</Badge>
            {archived && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatPrice(property)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && <Button variant="outline" onClick={() => setDialog('edit')}><Pencil /> Edit</Button>}
          {canUpdate && <Button variant="outline" onClick={() => setDialog('status')}>Change status</Button>}
          {canUpdate && can('properties:assign') && <Button variant="outline" onClick={() => setDialog('assign')}><UserCheck /> Reassign</Button>}
          {canUpdate && <Button variant="outline" className="text-destructive" onClick={() => setConfirmArchive(true)}><Trash2 /> Archive</Button>}
          {archived && can('properties:delete') && <Button onClick={onRestore}><ArchiveRestore /> Restore</Button>}
        </div>
      </div>

      {archived && <div role="status" className="rounded-md bg-warning/15 px-4 py-3 text-sm text-warning">This property is archived. Restore it to make changes.</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Gallery property={property} canEdit={canUpdate} />
          <Card>
            <CardHeader><CardTitle className="text-section-title">Description</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm">{property.description ?? 'No description yet.'}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-section-title">Activity</CardTitle></CardHeader>
            <CardContent><ActivityList items={activities.data?.data} isLoading={activities.isLoading} isError={activities.isError} onRetry={() => activities.refetch()} /></CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-section-title">Specifications</CardTitle></CardHeader>
            <CardContent><dl className="grid grid-cols-2 gap-3">
              <Field label="Bedrooms">{property.bedrooms}</Field>
              <Field label="Bathrooms">{property.bathrooms}</Field>
              <Field label="Area">{property.area !== null && property.areaUnit ? `${property.area} ${AREA_UNIT_LABELS[property.areaUnit]}` : null}</Field>
              <Field label="Floors">{property.floors}</Field>
              <Field label="Parking">{property.parkingSpaces}</Field>
              <Field label="Year built">{property.yearBuilt}</Field>
              <Field label="Furnishing">{humanize(property.furnishingStatus)}</Field>
              <Field label="Deposit">{property.securityDepositAmount !== null ? formatMinor(property.securityDepositAmount, property.currency) : null}</Field>
              <Field label="Maintenance">{property.maintenanceChargesAmount !== null ? formatMinor(property.maintenanceChargesAmount, property.currency) : null}</Field>
            </dl></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-section-title">Amenities</CardTitle></CardHeader>
            <CardContent>{property.amenities.length ? <ul className="flex flex-wrap gap-1.5">{property.amenities.map((a) => <li key={a}><Badge variant="outline">{a}</Badge></li>)}</ul> : <p className="text-sm text-muted-foreground">None listed.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-section-title">Location</CardTitle></CardHeader>
            <CardContent><dl className="space-y-3">
              <Field label="Address">{[property.address, property.city, property.state, property.postalCode, property.country].filter(Boolean).join(', ')}</Field>
              <Field label="Coordinates">{property.latitude !== null && property.longitude !== null ? `${property.latitude}, ${property.longitude}` : null}</Field>
              <Field label="Notes">{property.locationDescription}</Field>
            </dl></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-section-title">People</CardTitle></CardHeader>
            <CardContent><dl className="space-y-3">
              <Field label="Owner">{property.owner && <Link className="hover:underline" to={`/app/contacts/${property.owner._id}`}>{property.owner.fullName}</Link>}</Field>
              <Field label="Assigned agent">{property.assignee?.name ?? 'Unassigned'}</Field>
              <Field label="Listed">{formatDate(property.createdAt)}</Field>
              <Field label="Related contacts">{property.relatedContacts.length > 0 && <ul className="space-y-1">{property.relatedContacts.map((c) => <li key={c._id}><Link className="hover:underline" to={`/app/contacts/${c._id}`}>{c.fullName}</Link></li>)}</ul>}</Field>
              <Field label="Related leads">{property.relatedLeads.length > 0 && <ul className="space-y-1">{property.relatedLeads.map((l) => <li key={l._id} className="flex items-center justify-between gap-2"><Link className="truncate hover:underline" to={`/app/leads/${l._id}`}>{l.name}</Link><StatusBadge status={l.status} /></li>)}</ul>}</Field>
            </dl></CardContent>
          </Card>
          <RelatedDealsCard filter={{ propertyId: property._id }} />
        </div>
      </div>

      <PropertyFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} property={property} />
      <PropertyAssignDialog property={dialog === 'assign' ? property : null} onOpenChange={(o) => !o && setDialog(null)} />
      <PropertyStatusDialog property={dialog === 'status' ? property : null} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog open={confirmArchive} onOpenChange={setConfirmArchive} title="Archive this property?" description="The listing is archived, not erased. Its history stays intact and it can be restored. Properties with open deals cannot be archived." confirmLabel="Archive property" destructive onConfirm={onArchive} />
    </div>
  );
}