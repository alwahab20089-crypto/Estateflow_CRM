// src/features/properties/property-dialogs.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembers } from '@/features/leads/use-leads';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import type { PropertyDto } from '@/types/properties';
import { CLOSED_STATUSES, PROPERTY_STATUSES } from './property-constants';
import { useAssignProperty, useUpdatePropertyStatus } from './use-properties';

const NONE = 'unassigned';

function AssignForm({ property, onDone }: { property: PropertyDto; onDone: () => void }) {
  const members = useMembers();
  const assign = useAssignProperty();
  const [value, setValue] = useState(property.assignedTo ?? NONE);
  const submit = async () => {
    if (assign.isPending) return;
    try {
      await assign.mutateAsync({ id: property._id, assignedTo: value === NONE ? null : value });
      toast.success('Assignment updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the assignment'));
    }
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="property-assign-select">Assigned agent</Label>
        <Select value={value} onValueChange={setValue} disabled={members.isLoading}>
          <SelectTrigger id="property-assign-select" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {members.isError && <p role="alert" className="text-xs text-destructive">Could not load team members.</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={assign.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={assign.isPending} disabled={members.isLoading}>Save assignment</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function PropertyAssignDialog({ property, onOpenChange }: { property: PropertyDto | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={property !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign property</DialogTitle><DialogDescription>Only active members of your organization can be assigned.</DialogDescription></DialogHeader>
        {property && <AssignForm property={property} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({ property, onDone }: { property: PropertyDto; onDone: () => void }) {
  const mutation = useUpdatePropertyStatus();
  const [value, setValue] = useState<string>(property.propertyStatus);
  const closedForThisListing = { SALE: 'SOLD', RENT: 'RENTED', LEASE: 'LEASED' }[property.listingType];
  const options = PROPERTY_STATUSES.filter((s) => !CLOSED_STATUSES.includes(s) || s === closedForThisListing); // the server enforces this too
  const submit = async () => {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync({ id: property._id, propertyStatus: value });
      toast.success('Status updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the status'));
    }
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="property-status-select">Status</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="property-status-select" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-caption">Closing a deal as won sets Sold, Rented or Leased automatically.</p>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={mutation.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={mutation.isPending} disabled={value === property.propertyStatus}>Update status</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function PropertyStatusDialog({ property, onOpenChange }: { property: PropertyDto | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={property !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Change status</DialogTitle><DialogDescription>Update how this listing is marketed.</DialogDescription></DialogHeader>
        {property && <StatusForm property={property} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}