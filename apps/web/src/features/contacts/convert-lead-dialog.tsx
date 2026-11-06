import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { humanize } from '@/lib/labels';
import type { LeadDto } from '@/types/leads';
import type { ContactDto, DuplicateContactMatch } from '@/types/contacts';
import { useConvertLeadToContact } from './use-contacts';

type View =
  | { kind: 'confirm' }
  | { kind: 'duplicate'; matches: DuplicateContactMatch[]; hidden: number }
  | { kind: 'done'; contact: ContactDto; linked: boolean }
  | { kind: 'blocked'; message: string; contactId?: string };

function ConvertBody({ lead, onClose }: { lead: LeadDto; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'confirm' });
  const convert = useConvertLeadToContact();
  const name = `${lead.firstName} ${lead.lastName}`.trim();

  const run = async (existingContactId?: string) => {
    if (convert.isPending) return; // no double submits
    try {
      const result = await convert.mutateAsync({ leadId: lead._id, existingContactId });
      toast.success(result.linkedExisting ? 'Lead linked to the existing contact' : 'Lead converted to a contact');
      setView({ kind: 'done', contact: result.contact, linked: result.linkedExisting });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONTACT_DUPLICATE') {
        const d = err.details as { matches?: DuplicateContactMatch[]; hiddenMatches?: number } | undefined;
        setView({ kind: 'duplicate', matches: d?.matches ?? [], hidden: d?.hiddenMatches ?? 0 });
      } else if (err instanceof ApiError && err.code === 'LEAD_ALREADY_CONVERTED') {
        const d = err.details as { contact?: { _id: string } | null } | undefined;
        setView({ kind: 'blocked', message: err.message, contactId: d?.contact?._id });
      } else if (err instanceof ApiError && err.code === 'LEAD_NOT_CONVERTIBLE') {
        setView({ kind: 'blocked', message: err.message });
      } else {
        toast.error(errorMessage(err, 'Could not convert the lead'));
      }
    }
  };

  if (view.kind === 'done') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{view.linked ? 'Lead linked' : 'Lead converted'}</DialogTitle>
          <DialogDescription>
            {name} is now linked to the contact <strong>{view.contact.fullName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button asChild><Link to={`/app/contacts/${view.contact._id}`}>View contact</Link></Button>
        </DialogFooter>
      </>
    );
  }

  if (view.kind === 'blocked') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Can’t convert this lead</DialogTitle>
          <DialogDescription role="alert">{view.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {view.contactId && <Button asChild><Link to={`/app/contacts/${view.contactId}`}>View contact</Link></Button>}
        </DialogFooter>
      </>
    );
  }

  if (view.kind === 'duplicate') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>A matching contact already exists</DialogTitle>
          <DialogDescription>
            To avoid a duplicate, nothing was created. Review the contact below, then link this lead to it.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {view.matches.map((m) => (
            <li key={m._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="font-medium">{m.fullName}</p>
                <p className="text-caption">{[m.email, m.phone].filter(Boolean).join(' · ')}</p>
                <p className="text-caption">Matched on {m.matchedOn.join(' and ')} · {humanize(m.contactType)}</p>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm"><Link to={`/app/contacts/${m._id}`}>Review</Link></Button>
                <LoadingButton size="sm" loading={convert.isPending} onClick={() => run(m._id)}>Link to this contact</LoadingButton>
              </div>
            </li>
          ))}
        </ul>
        {view.hidden > 0 && (
          <p className="text-caption">{view.hidden} matching contact{view.hidden > 1 ? 's' : ''} belong to other team members. Ask a manager to review.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Convert to contact</DialogTitle>
        <DialogDescription>
          This creates a contact from <strong>{name}</strong> and links it to this lead. The lead keeps its status and full history, and you can open the contact right after.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={convert.isPending}>Cancel</Button>
        <LoadingButton onClick={() => run()} loading={convert.isPending}>Convert to contact</LoadingButton>
      </DialogFooter>
    </>
  );
}

export function ConvertLeadDialog({ lead, open, onOpenChange }: { lead: LeadDto; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ConvertBody lead={lead} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}