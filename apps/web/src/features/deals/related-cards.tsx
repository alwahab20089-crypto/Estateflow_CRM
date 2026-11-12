// src/features/deals/related-cards.tsx
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPrice } from '@/features/properties/property-constants';
import { useProperties } from '@/features/properties/use-properties';
import { formatMinor } from '@/lib/money';
import { useAuth } from '@/providers/auth-provider';
import type { PropertyType } from '@/types';
import { DealFormDialog, type DealDefaults } from './deal-form-dialog';
import { useDeals } from './use-deals';

/** Deals tied to a contact, lead or property. Shown only to people who may read deals; the API filters per user. */
export function RelatedDealsCard({ filter, defaults, title = 'Deals' }: { filter: { contactId?: string; leadId?: string; propertyId?: string }; defaults?: DealDefaults; title?: string }) {
  const { can } = useAuth();
  const allowed = can('deals:read');
  const query = useDeals({ ...filter, page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }, allowed);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  const deals = query.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-section-title">{title}</CardTitle>
        {can('deals:create') && defaults && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> New deal</Button>}
      </CardHeader>
      <CardContent>
        {query.isLoading ? <Skeleton className="h-12" /> : query.isError ? <p role="alert" className="text-sm text-destructive">Could not load deals.</p> : deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals yet.</p>
        ) : (
          <ul className="space-y-2">
            {deals.map((d) => (
              <li key={d._id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/app/pipeline/${d._id}`} className="min-w-0 truncate hover:underline">{d.title}</Link>
                <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums text-muted-foreground">{formatMinor(d.valueAmount, d.currency, true)}</span><StatusBadge status={d.stage} /></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {defaults && <DealFormDialog open={open} onOpenChange={setOpen} defaults={defaults} />}
    </Card>
  );
}

/** Properties a contact owns. */
export function RelatedPropertiesCard({ ownerContactId }: { ownerContactId: string }) {
  const { can } = useAuth();
  const allowed = can('properties:read');
  const query = useProperties({ ownerContactId, page: 1, limit: 10, includeClosed: true, sortBy: 'createdAt', sortOrder: 'desc', view: 'active' }, allowed);
  if (!allowed) return null;
  const items = query.data?.data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-section-title">Properties owned</CardTitle></CardHeader>
      <CardContent>
        {query.isLoading ? <Skeleton className="h-12" /> : query.isError ? <p role="alert" className="text-sm text-destructive">Could not load properties.</p> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No properties linked to this contact.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/app/properties/${p._id}`} className="min-w-0 truncate hover:underline">{p.title}</Link>
                <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums text-muted-foreground">{formatPrice(p, true)}</span><StatusBadge status={p.propertyStatus} /></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Suggested inventory for a lead, based on its interested type and preferred location (search match, not a guarantee). */
export function RelevantPropertiesCard({ propertyTypes, locations }: { propertyTypes: PropertyType[]; locations: string[] }) {
  const { can } = useAuth();
  const allowed = can('properties:read') && (propertyTypes.length > 0 || locations.length > 0);
  const query = useProperties(
    { page: 1, limit: 5, propertyType: (propertyTypes[0] ?? undefined) as never, search: locations[0], sortBy: 'createdAt', sortOrder: 'desc', view: 'active' },
    allowed,
  );
  if (!allowed) return null;
  const items = query.data?.data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-section-title">Relevant properties</CardTitle></CardHeader>
      <CardContent>
        {query.isLoading ? <Skeleton className="h-12" /> : query.isError ? <p role="alert" className="text-sm text-destructive">Could not load properties.</p> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No available properties match this lead’s interests yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/app/properties/${p._id}`} className="min-w-0 truncate hover:underline">{p.title}</Link>
                <span className="tabular-nums text-muted-foreground">{formatPrice(p, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}