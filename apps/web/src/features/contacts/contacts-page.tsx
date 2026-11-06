import { Contact, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PAGE_SIZES } from '@/features/leads/lead-constants';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import type { ContactDto, ContactSortField } from '@/types/contacts';
import { ContactAssignDialog } from './contact-assign-dialog';
import { ContactFiltersBar } from './contact-filters-bar';
import { ContactFormDialog } from './contact-form-dialog';
import { ContactsTable, type ContactRowAction } from './contacts-table';
import { useContactFilters } from './use-contact-filters';
import { useArchiveContact, useContacts, useRestoreContact } from './use-contacts';

export function ContactsPage() {
  const { can } = useAuth();
  const { filters, update, clear, hasActiveFilters } = useContactFilters();
  const query = useContacts(filters);
  const archive = useArchiveContact();
  const restore = useRestoreContact();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [assigning, setAssigning] = useState<ContactDto | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ContactDto | null>(null);

  const contacts = query.data?.data ?? [];
  const meta = query.data?.meta;
  const canDelete = can('contacts:delete');
  const archivedView = filters.view === 'archived';
  const openCreate = () => { setEditing(null); setFormOpen(true); };

  const onSort = (field: ContactSortField) =>
    update({
      sortBy: field,
      sortOrder: filters.sortBy === field && filters.sortOrder === 'asc' ? 'desc' : field === 'createdAt' ? 'desc' : 'asc',
    });

  const onAction = async (action: ContactRowAction, contact: ContactDto) => {
    if (action === 'edit') { setEditing(contact); setFormOpen(true); }
    else if (action === 'assign') setAssigning(contact);
    else if (action === 'archive') setArchiveTarget(contact);
    else {
      try {
        await restore.mutateAsync(contact._id);
        toast.success('Contact restored');
      } catch (err) {
        toast.error(errorMessage(err, 'Could not restore the contact'));
      }
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget._id);
      toast.success('Contact archived');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not archive the contact'));
    } finally {
      setArchiveTarget(null);
    }
  };

  const showError = query.isError && !query.data;
  const showEmpty = !query.isLoading && !showError && contacts.length === 0;

  return (
    <>
      <PageHeader
        title={archivedView ? 'Archived contacts' : 'Contacts'}
        description={query.isLoading ? 'Loading contacts…' : `${meta?.total ?? 0} ${meta?.total === 1 ? 'contact' : 'contacts'} · clients, owners and partners in one place`}
        actions={
          <>
            {canDelete && (
              <div className="mr-2 flex items-center gap-2">
                <Switch id="show-archived-contacts" checked={archivedView} onCheckedChange={(on) => update({ view: on ? 'archived' : undefined })} />
                <Label htmlFor="show-archived-contacts" className="font-normal">Show archived</Label>
              </div>
            )}
            {can('contacts:create') && <Button onClick={openCreate}><Plus /> Add contact</Button>}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <ContactFiltersBar filters={filters} hasActiveFilters={hasActiveFilters} onChange={update} onClear={clear} />

        {showError ? (
  <ErrorState
    message={errorMessage(query.error, 'We could not load your contacts.')}
    onRetry={() => query.refetch()}
  />
) : showEmpty ? (
          hasActiveFilters ? (
            <EmptyState icon={Contact} title="No contacts match your filters" description="Try a different search or clear the filters." action={<Button variant="outline" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={Contact}
              title={archivedView ? 'No archived contacts' : 'No contacts yet'}
              description={archivedView ? 'Archived contacts appear here and can be restored.' : 'Add a contact, or convert a qualified lead.'}
              action={!archivedView && can('contacts:create') ? <Button onClick={openCreate}><Plus /> Add contact</Button> : undefined}
            />
          )
        ) : (
          <div role={query.isLoading ? 'status' : undefined} aria-label={query.isLoading ? 'Loading contacts' : undefined} aria-busy={query.isFetching} className={cn(query.isPlaceholderData && 'opacity-60 transition-opacity')}>
            <ContactsTable
              contacts={contacts}
              isLoading={query.isLoading}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={onSort}
              canUpdate={can('contacts:update')}
              canAssign={can('contacts:assign')}
              canDelete={canDelete}
              onAction={onAction}
            />
          </div>
        )}

        {meta && meta.total > 0 && (
          <Pagination
            page={meta.page}
            pageCount={meta.totalPages}
            total={meta.total}
            pageSize={meta.limit}
            onPageChange={(page) => update({ page })}
            pageSizeOptions={PAGE_SIZES}
            onPageSizeChange={(limit) => update({ limit })}
          />
        )}
      </Card>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <ContactAssignDialog contact={assigning} onOpenChange={(open) => !open && setAssigning(null)} />
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Archive this contact?"
        description="The contact is archived, not erased. Its history stays intact and an administrator can restore it."
        confirmLabel="Archive contact"
        destructive
        onConfirm={confirmArchive}
      />
    </>
  );
}