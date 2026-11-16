import { FileText, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/providers/auth-provider';
import { useReportCatalog } from './use-reports';

export function ReportsPage() {
  const { can } = useAuth();
  const allowed = can('reports:read');
  const q = useReportCatalog(allowed);

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Predefined reports with filters, sorting and CSV export. Deal values are agreed values, not collected revenue." />
      {!allowed ? (
        <Card><EmptyState icon={Lock} title="You don't have access to reports" description="Ask an organization admin to grant the reports permission." /></Card>
      ) : q.isError ? (
        <Card><ErrorState onRetry={() => void q.refetch()} /></Card>
      ) : !q.data ? (
        <div role="status" aria-label="Loading reports" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : q.data.length === 0 ? (
        <Card><EmptyState icon={FileText} title="No reports available" description="Your role does not include any reports." /></Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((r) => (
            <li key={r.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-section-title">
                    <Link to={`/app/reports/${r.id}`} className="hover:underline">{r.title}</Link>
                  </CardTitle>
                  <CardDescription>{r.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{r.usesDateRange ? 'Date range' : 'Snapshot'}</Badge>
                  {r.canExport && <Badge variant="outline">CSV export</Badge>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}