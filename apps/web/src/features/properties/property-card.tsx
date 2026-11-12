// src/features/properties/property-card.tsx
import { Bath, BedDouble, Building2, MapPin, Ruler } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { humanize } from '@/lib/labels';
import { assetUrl } from '@/services/property-service';
import type { PropertyDto } from '@/types/properties';
import { AREA_UNIT_LABELS, formatPrice } from './property-constants';

export function PropertyCard({ property: p }: { property: PropertyDto }) {
  const image = assetUrl(p.primaryImageUrl);
  return (
    <Card className="gap-0 overflow-hidden py-0 transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
      <div className="relative aspect-[16/10] bg-muted">
        {image ? (
          <img src={image} alt={`${p.title} photo`} loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground" aria-hidden><Building2 className="size-10" /></div>
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <StatusBadge status={p.propertyStatus} className="bg-background/90" />
          {p.deletedAt && <Badge variant="secondary">Archived</Badge>}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <Link to={`/app/properties/${p._id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">{p.title}</Link>
        <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{[p.city, p.country].filter(Boolean).join(', ') || 'Location not set'}</span></p>
        <p className="text-lg font-semibold tabular-nums">{formatPrice(p)}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{humanize(p.propertyType)}</Badge>
          <Badge variant="outline">For {p.listingType.toLowerCase()}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {p.bedrooms !== null && <span className="inline-flex items-center gap-1"><BedDouble className="size-3.5" aria-hidden />{p.bedrooms}<span className="sr-only"> bedrooms</span></span>}
          {p.bathrooms !== null && <span className="inline-flex items-center gap-1"><Bath className="size-3.5" aria-hidden />{p.bathrooms}<span className="sr-only"> bathrooms</span></span>}
          {p.area !== null && p.areaUnit && <span className="inline-flex items-center gap-1"><Ruler className="size-3.5" aria-hidden />{p.area} {AREA_UNIT_LABELS[p.areaUnit]}</span>}
        </div>
        <div className="flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
          {p.assignee ? (<><UserAvatar name={p.assignee.name} className="size-5 text-[10px]" /><span className="truncate">{p.assignee.name}</span></>) : <span>Unassigned</span>}
        </div>
      </div>
    </Card>
  );
}