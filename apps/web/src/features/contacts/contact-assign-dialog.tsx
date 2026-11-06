import { useState } from 'react';
import { toast } from 'sonner';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembers } from '@/features/leads/use-leads';
import { errorMessage } from '@/lib/errors';
import type { ContactDto } from '@/types/contacts';
import { useAssignContact } from './use-contacts';

const NONE = 'unassigned';

function AssignForm({ contact, onDone }: { contact: ContactDto; onDone: () => void }) {
  const members = useMembers();
  const mutation = useAssignContact();
  const [value, setValue] = useState(contact.assignedTo ?? NONE);

  const submit = async () => {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync({ id: contact._id, assignedTo: value === NONE ? null : value });
      toast.success('Assignment updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the assignment'));
    }
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="contact-assign-select">Assigned member</Label>
        <Select value={value} onValueChange={setValue} disabled={members.isLoading}>
          <SelectTrigger id="contact-assign-select" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {members.isError && <p role="alert" className="text-xs text-destructive">Could not load team members.</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={mutation.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={mutation.isPending} disabled={members.isLoading}>Save assignment</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function ContactAssignDialog({ contact, onOpenChange }: { contact: ContactDto | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={contact !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign contact</DialogTitle>
          <DialogDescription>Only active members of your organization can be assigned.</DialogDescription>
        </DialogHeader>
        {contact && <AssignForm contact={contact} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}