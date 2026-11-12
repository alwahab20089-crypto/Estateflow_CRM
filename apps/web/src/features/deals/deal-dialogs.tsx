// src/features/deals/deal-dialogs.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMembers } from '@/features/leads/use-leads';
import { errorMessage } from '@/lib/errors';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';
import type { DealDto } from '@/types/deals';
import { dateToIso } from './deal-schemas';
import { useAssignDeal, useCloseDealLost, useCloseDealWon, useReopenDeal } from './use-deals';

const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
type DialogProps = { deal: DealDto | null; onOpenChange: (open: boolean) => void };

function WonForm({ deal, onDone }: { deal: DealDto; onDone: () => void }) {
  const mutation = useCloseDealWon();
  const [date, setDate] = useState(todayYmd());
  const [value, setValue] = useState(String(fromMinorUnits(deal.valueAmount, deal.currency)));
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (mutation.isPending) return;
    if (!/^\d+(\.\d{1,2})?$/.test(value.trim()) || Number(value) <= 0) return setError('Enter the final value (greater than 0).');
    if (!date || date > todayYmd()) return setError('Choose a closing date that is not in the future.');
    setError(undefined);
    try {
      await mutation.mutateAsync({ id: deal._id, payload: { valueAmount: toMinorUnits(Number(value), deal.currency), actualClosingDate: dateToIso(date) } });
      toast.success('Deal closed as won. The property status was updated.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not close the deal'));
    }
  };
  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="won-date">Closing date</Label><Input id="won-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="won-value">Final value ({deal.currency})</Label><Input id="won-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
        <p className="text-caption">The linked property will be marked {{ SALE: 'Sold', RENT: 'Rented', LEASE: 'Leased' }[deal.dealType]}. Other deals on it are left untouched.</p>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={mutation.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={mutation.isPending}>Close as won</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function CloseWonDialog({ deal, onOpenChange }: DialogProps) {
  return (
    <Dialog open={deal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Close deal as won</DialogTitle><DialogDescription>Confirm the closing details for “{deal?.title}”.</DialogDescription></DialogHeader>
        {deal && <WonForm deal={deal} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({ label, submitLabel, requiredMessage, successMessage, errorFallback, run, onDone }: {
  label: string; submitLabel: string; requiredMessage: string; successMessage: string; errorFallback: string;
  run: (reason: string) => Promise<unknown>; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async () => {
    if (pending) return;
    if (!reason.trim()) return setError(requiredMessage);
    setError(undefined);
    setPending(true);
    try {
      await run(reason.trim());
      toast.success(successMessage);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, errorFallback));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="deal-reason">{label}</Label>
        <Textarea id="deal-reason" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'deal-reason-error' : undefined} />
        {error && <p id="deal-reason-error" role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={pending}>{submitLabel}</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function CloseLostDialog({ deal, onOpenChange }: DialogProps) {
  const mutation = useCloseDealLost();
  return (
    <Dialog open={deal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Close deal as lost</DialogTitle><DialogDescription>Record why “{deal?.title}” did not go ahead. This keeps your history useful.</DialogDescription></DialogHeader>
        {deal && <ReasonForm label="Lost reason *" submitLabel="Close as lost" requiredMessage="A lost reason is required." successMessage="Deal closed as lost" errorFallback="Could not close the deal"
          run={(lostReason) => mutation.mutateAsync({ id: deal._id, lostReason })} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function ReopenDealDialog({ deal, onOpenChange }: DialogProps) {
  const mutation = useReopenDeal();
  return (
    <Dialog open={deal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Reopen deal</DialogTitle><DialogDescription>The deal returns to Negotiation. If it was won, the property becomes available again. This is recorded in the audit log.</DialogDescription></DialogHeader>
        {deal && <ReasonForm label="Reason for reopening *" submitLabel="Reopen deal" requiredMessage="A reason is required to reopen a deal." successMessage="Deal reopened" errorFallback="Could not reopen the deal"
          run={(reason) => mutation.mutateAsync({ id: deal._id, reason })} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const NONE = 'unassigned';
function AssignForm({ deal, onDone }: { deal: DealDto; onDone: () => void }) {
  const members = useMembers();
  const mutation = useAssignDeal();
  const [value, setValue] = useState(deal.assignedTo ?? NONE);
  const submit = async () => {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync({ id: deal._id, assignedTo: value === NONE ? null : value });
      toast.success('Assignment updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the assignment'));
    }
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="deal-assign-select">Assigned agent</Label>
        <Select value={value} onValueChange={setValue} disabled={members.isLoading}>
          <SelectTrigger id="deal-assign-select" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>Unassigned</SelectItem>{(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={mutation.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={mutation.isPending} disabled={members.isLoading}>Save assignment</LoadingButton>
      </DialogFooter>
    </>
  );
}
export function AssignDealDialog({ deal, onOpenChange }: DialogProps) {
  return (
    <Dialog open={deal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign deal</DialogTitle><DialogDescription>Only active members of your organization can be assigned.</DialogDescription></DialogHeader>
        {deal && <AssignForm deal={deal} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}