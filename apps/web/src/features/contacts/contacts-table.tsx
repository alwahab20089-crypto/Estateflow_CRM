import { ArrowDown, ArrowUp, ArrowUpDown, Ellipsis } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { humanize } from '@/lib/labels';
import type { ContactDto, ContactListParams, ContactSortField } from '@/types/contacts';

export type ContactRowAction = 'edit' | 'assign' | 'archive' | 'restore';

interface ContactsTableProps {
  contacts: ContactDto[];
  isLoading: boolean;
  sortBy: ContactListParams['sortBy'];
  sortOrder: ContactListParams['sortOrder'];
  onSort: (field: ContactSortField) => void;
  canUpdate: boolean;
  canAssign: boolean;
  canDelete: boolean;
  onAction: (action: ContactRowAction, contact: ContactDto) => void;
}

function SortHead({ label, field, sortBy, sortOrder, onSort }: { label: string; field: ContactSortField } & Pick<ContactsTableProps, 'sortBy' | 'sortOrder' | 'onSort'>) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="-mx-1 inline-flex items-center gap-1 rounded px-1 font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {label}
        <Icon className="size-3.5" aria-hidden />
      </button>
    </TableHead>
  );
}

export function ContactsTable({ contacts, isLoading, sortBy, sortOrder, onSort, canUpdate, canAssign, canDelete, onAction }: ContactsTableProps) {
  const sort = { sortBy, sortOrder, onSort };
  return (
    <Table>
      <caption className="sr-only">Contacts</caption>
      <TableHeader>
        <TableRow>
          <SortHead label="Name" field="name" {...sort} />
          <SortHead label="Type" field="contactType" {...sort} />
          <TableHead>Email</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Assigned to</TableHead>
          <SortHead label="Status" field="status" {...sort} />
          <SortHead label="Created" field="createdAt" {...sort} />
          <TableHead className="w-12 text-right"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 9 }).map((__, j) => (
                  <TableCell key={j}><Skeleton className="h-5 w-full max-w-28" /></TableCell>
                ))}
              </TableRow>
            ))
          : contacts.map((contact) => {
              const archived = contact.deletedAt !== null;
              return (
                <TableRow key={contact._id}>
                  <TableCell className="min-w-52">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={contact.fullName} className="size-8" />
                      <div className="min-w-0">
                        <Link to={`/app/contacts/${contact._id}`} className="block truncate font-medium hover:underline focus-visible:underline">{contact.fullName}</Link>
                        {contact.jobTitle && <p className="truncate text-xs text-muted-foreground">{contact.jobTitle}</p>}
                      </div>
                      {archived && <Badge variant="secondary">Archived</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{humanize(contact.contactType)}</Badge></TableCell>
                  <TableCell>{contact.email ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{contact.phone ?? '—'}</TableCell>
                  <TableCell>{contact.company ?? '—'}</TableCell>
                  <TableCell>
                    {contact.assignee ? (
                      <span className="flex items-center gap-2"><UserAvatar name={contact.assignee.name} className="size-6" /><span className="truncate">{contact.assignee.name}</span></span>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge status={contact.status} /></TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(contact.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${contact.fullName}`}><Ellipsis className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link to={`/app/contacts/${contact._id}`}>View details</Link></DropdownMenuItem>
                        {!archived && canUpdate && <DropdownMenuItem onSelect={() => onAction('edit', contact)}>Edit</DropdownMenuItem>}
                        {!archived && canAssign && <DropdownMenuItem onSelect={() => onAction('assign', contact)}>Assign</DropdownMenuItem>}
                        {canDelete && <DropdownMenuSeparator />}
                        {canDelete && !archived && <DropdownMenuItem variant="destructive" onSelect={() => onAction('archive', contact)}>Archive</DropdownMenuItem>}
                        {canDelete && archived && <DropdownMenuItem onSelect={() => onAction('restore', contact)}>Restore</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}