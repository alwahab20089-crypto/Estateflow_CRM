import { Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { bannerFor } from './license-utils';
import { useLicenseStatus } from './use-license';

const tones = {
  info: { box: 'border-primary/30 bg-primary/10', icon: Info, iconClass: 'text-primary' },
  warning: { box: 'border-warning/40 bg-warning/10', icon: TriangleAlert, iconClass: 'text-warning' },
  destructive: { box: 'border-destructive/40 bg-destructive/10', icon: ShieldAlert, iconClass: 'text-destructive' },
} as const;

/**
 * Tells every member when the license is missing, ending or lapsed. Hiding things is never the restriction (the API
 * enforces it); this only explains why Add buttons are disabled. Only the owner is offered the way to fix it.
 */
export function LicenseBanner() {
  const { can } = useAuth();
  const { data } = useLicenseStatus();
  const content = bannerFor(data, can('license:manage'), new Date(), formatDate);
  if (!content) return null;

  const { box, icon: Icon, iconClass } = tones[content.tone];

  return (
    <div role="status" className={cn('mb-6 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center', box)}>
      <Icon className={cn('size-5 shrink-0', iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{content.title}</p>
        <p className="text-sm text-muted-foreground">{content.message}</p>
      </div>
      {content.showManageLink && (
        <Button asChild size="sm" variant="outline">
          <Link to="/app/settings?tab=license">Manage license</Link>
        </Button>
      )}
    </div>
  );
}