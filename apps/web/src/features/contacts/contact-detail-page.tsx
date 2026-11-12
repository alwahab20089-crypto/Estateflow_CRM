import { ArchiveRestore, ArrowLeft, MessageSquarePlus, Pencil, Trash2, UserCheck } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { humanize, leadSourceLabels } from '@/lib/labels';
import { useAuth } from '@/providers/auth-provider';
import { CONTACT_METHODS } from './contact-constants';
import { ContactActivityTimeline } from './contact-activity-timeline';
import { ContactAssignDialog } from './contact-assign-dialog';
import { ContactFormDialog } from './contact-form-dialog';
import { useArchiveContact, useContact, useRestoreContact } from './use-contacts';
import { RelatedDealsCard, RelatedPropertiesCard } from '@/features/deals/related-cards';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-caption">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || '—'}</dd>
    </div>
  );
}

export function ContactDetailPage() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: contact, isLoading, isError, error, refetch } = useContact(contactId);
  const archive = useArchiveContact();
  const restore = useRestoreContact();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [dialog, setDialog] = useState<'edit' | 'assign' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading contact" className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96" /><Skeleton className="h-96 lg:col-span-2" /></div>
      </div>
    );
  }
  if (isError || !contact) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <EmptyState title="Contact not found" description="It may have been archived, or you may not have access to it." action={<Button asChild variant="outline"><Link to="/app/contacts">Back to contacts</Link></Button>} />
    ) : (
      <ErrorState message={errorMessage(error, 'We could not load this contact.')} onRetry={() => refetch()} />
    );
  }

  const archived = contact.deletedAt !== null;
  const canUpdate = can('contacts:update') && !archived;
  const method = CONTACT_METHODS.find((m) => m.value === contact.preferredContactMethod)?.label;

  const onArchive = async () => {
    try {
      await archive.mutateAsync(contact._id);
      toast.success('Contact archived');
      navigate('/app/contacts', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not archive the contact'));
    }
  };
  const onRestore = async () => {
    try {
      await restore.mutateAsync(contact._id);
      toast.success('Contact restored');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not restore the contact'));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/app/contacts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contacts
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar name={contact.fullName} className="size-14 text-lg" />
          <div>
            <h1 className="text-page-title">{contact.fullName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{humanize(contact.contactType)}</Badge>
              <StatusBadge status={contact.status} />
              {contact.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
            </div>
            {(contact.jobTitle || contact.company) && (
              <p className="mt-1 text-sm text-muted-foreground">{[contact.jobTitle, contact.company].filter(Boolean).join(' · ')}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && <Button variant="outline" onClick={() => setDialog('edit')}><Pencil /> Edit</Button>}
          {canUpdate && can('contacts:assign') && <Button variant="outline" onClick={() => setDialog('assign')}><UserCheck /> Reassign</Button>}
          {canUpdate && <Button variant="outline" onClick={() => noteRef.current?.focus()}><MessageSquarePlus /> Add note</Button>}
          {can('contacts:delete') && !archived && <Button variant="outline" className="text-destructive" onClick={() => setConfirmArchive(true)}><Trash2 /> Archive</Button>}
          {can('contacts:delete') && archived && <Button onClick={onRestore}><ArchiveRestore /> Restore</Button>}
        </div>
      </div>

      {archived && <div role="status" className="rounded-md bg-warning/15 px-4 py-3 text-sm text-warning">This contact is archived. Restore it to make changes.</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-section-title">Contact details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Field label="Email">{contact.email && <a className="hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>}</Field>
                <Field label="Phone">{contact.phone && <a className="hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a>}</Field>
                <Field label="Alternate phone">{contact.alternatePhone}</Field>
                <Field label="Preferred method">{method}</Field>
                <Field label="Preferred language">{contact.preferredLanguage}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-section-title">Company and address</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Field label="Company">{contact.company}</Field>
                <Field label="Job title">{contact.jobTitle}</Field>
                <Field label="Address">{[contact.address, contact.city, contact.country].filter(Boolean).join(', ')}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-section-title">Relationship</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Field label="Assigned member">{contact.assignee?.name ?? 'Unassigned'}</Field>
                <Field label="Source">{contact.source && leadSourceLabels[contact.source]}</Field>
                <Field label="Created">{formatDate(contact.createdAt)}</Field>
                <Field label="Linked leads">
                  {contact.linkedLeads.length > 0 && (
                    <ul className="space-y-1.5">
                      {contact.linkedLeads.map((l) => (
                        <li key={l._id} className="flex items-center justify-between gap-2">
                          <Link to={`/app/leads/${l._id}`} className="truncate hover:underline">{l.name}</Link>
                          <StatusBadge status={l.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Field>
                <Field label="Notes"><span className="whitespace-pre-wrap">{contact.notes}</span></Field>
              </dl>
            </CardContent>
          </Card>

          {/* Related properties */}
          <RelatedPropertiesCard ownerContactId={contact._id} />

          {/* Related deals */}
          <RelatedDealsCard
            filter={{ contactId: contact._id }}
            defaults={{
              contact: {
                id: contact._id,
                label: contact.fullName,
              },
            }}
          />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-section-title">Relationship history</CardTitle></CardHeader>
          <CardContent>
            <ContactActivityTimeline contactId={contact._id} canNote={canUpdate && can('activities:create')} noteRef={noteRef} />
          </CardContent>
        </Card>
      </div>

      <ContactFormDialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)} contact={contact} />
      <ContactAssignDialog contact={dialog === 'assign' ? contact : null} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this contact?"
        description="The contact is archived, not erased. Its history stays intact and an administrator can restore it."
        confirmLabel="Archive contact"
        destructive
        onConfirm={onArchive}
      />
    </div>
  );
}