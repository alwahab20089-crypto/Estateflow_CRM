import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/providers/auth-provider';
import type { FeatureKey } from '@/types/license';
import { useFeature } from './use-license';

interface FeatureGateProps {
  feature: FeatureKey;
  /** Page title shown above the locked message. */
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Renders a page only when the license includes the feature. The children (and their data requests) are not mounted
 * otherwise, so a locked feature never produces a 403. The API still enforces the feature on every request.
 */
export function FeatureGate({ feature, title, description, children }: FeatureGateProps) {
  const { can } = useAuth();
  const gate = useFeature(feature);

  if (gate.loading) return <Skeleton className="h-64 w-full" aria-busy="true" />;
  if (gate.allowed) return <>{children}</>;

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState
          icon={Lock}
          title={`${title} isn't available`}
          description={gate.reason}
          action={
            can('license:manage') ? (
              <Button asChild>
                <Link to="/app/settings?tab=license">Manage license</Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Ask the workspace owner to update the license.</p>
            )
          }
        />
      </Card>
    </div>
  );
}