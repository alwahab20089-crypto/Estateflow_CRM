// src/features/properties/properties-page.tsx
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCreateGuard } from '@/features/license/use-license';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { CLOSED_STATUSES, PAGE_SIZES } from './property-constants';
import { PropertyCard } from './property-card';
import { PropertyFiltersBar } from './property-filters-bar';
import { PropertyFormDialog } from './property-form-dialog';
import { apiParams, usePropertyFilters } from './use-property-filters';
import { useProperties } from './use-properties';

function Summary({ counts, loading }: { counts?: Record<string, number>; loading: boolean }) {
  const n = (k: string) => counts?.[k] ?? 0;

  const items = [
    { label: 'Available', value: n('AVAILABLE') },
    { label: 'Under offer', value: n('UNDER_OFFER') },
    { label: 'Reserved', value: n('RESERVED') },
    {
      label: 'Sold / rented / leased',
      value: CLOSED_STATUSES.reduce((a, s) => a + n(s), 0),
    },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Inventory summary">
      {items.map((i) => (
        <Card key={i.label} className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-caption">{i.label}</p>
            {loading ? (
              <Skeleton className="mt-1 h-7 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{i.value}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PropertiesPage() {
  const { can, activeMembership } = useAuth();
  const currency = activeMembership?.organization.currency ?? 'USD';
  const { filters, update, clear, hasActiveFilters } = usePropertyFilters();
  const query = useProperties(apiParams(filters, currency));
  const [formOpen, setFormOpen] = useState(false);
  const propertyGuard = useCreateGuard('properties');

  const items = query.data?.data ?? [];
  const meta = query.data?.meta;
  const archivedView = filters.view === 'archived';
  const showError = query.isError && !query.data;
  const showEmpty = !query.isLoading && !showError && items.length === 0;

  return (
    <>
      <PageHeader
        title={archivedView ? 'Archived properties' : 'Properties'}
        description={
          query.isLoading
            ? 'Loading properties…'
            : `${meta?.total ?? 0} ${meta?.total === 1 ? 'property' : 'properties'} · your listings and inventory`
        }
        actions={
          <>
            {can('properties:delete') && (
              <div className="mr-2 flex items-center gap-2">
                <Switch
                  id="show-archived-properties"
                  checked={archivedView}
                  onCheckedChange={(on) => update({ view: on ? 'archived' : undefined })}
                />
                <Label htmlFor="show-archived-properties" className="font-normal">
                  Show archived
                </Label>
              </div>
            )}
            {can('properties:create') && (
              <Button
                disabled={propertyGuard.blocked}
                title={propertyGuard.reason}
                onClick={() => setFormOpen(true)}
              >
                <Plus /> Add property
              </Button>
            )}
          </>
        }
      />

      {!archivedView && <Summary counts={meta?.statusCounts} loading={query.isLoading} />}

      <Card className="gap-0 py-0">
        <PropertyFiltersBar
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onChange={update}
          onClear={clear}
        />

        {showError ? (
          <ErrorState
            message={errorMessage(query.error, 'We could not load your properties.')}
            onRetry={() => query.refetch()}
          />
        ) : showEmpty ? (
          hasActiveFilters ? (
            <EmptyState
              icon={Building2}
              title="No properties match your filters"
              description="Try a different search or clear the filters."
              action={<Button variant="outline" onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={Building2}
              title={archivedView ? 'No archived properties' : 'No properties yet'}
              description={
                archivedView
                  ? 'Archived properties appear here and can be restored.'
                  : 'Add your first listing to start matching it with leads.'
              }
              action={
                !archivedView && can('properties:create') ? (
                  <Button
                    disabled={propertyGuard.blocked}
                    title={propertyGuard.reason}
                    onClick={() => setFormOpen(true)}
                  >
                    <Plus /> Add property
                  </Button>
                ) : undefined
              }
            />
          )
        ) : query.isLoading ? (
          <div
            role="status"
            aria-label="Loading properties"
            className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : (
          <ul
            aria-busy={query.isFetching}
            className={cn(
              'grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3',
              query.isPlaceholderData && 'opacity-60 transition-opacity',
            )}
          >
            {items.map((p) => (
              <li key={p._id} className="relative">
                <PropertyCard property={p} />
              </li>
            ))}
          </ul>
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

      <PropertyFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
