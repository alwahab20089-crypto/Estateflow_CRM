
import { ArrowLeft, History } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { TRIGGER_MAP } from './automation-catalog';
import {
  ExecutionStatusBadge,
  Pick,
  WorkflowStatusBadge,
} from './automation-ui';
import { ExecutionDetail } from './execution-detail';
import { useExecutions, useWorkflow } from './use-automations';

const STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
].map((status) => ({
  value: status,
  label: status
    .replace('_', ' ')
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase()),
}));

export function ExecutionHistoryPage() {
  const { workflowId = '' } = useParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const workflow = useWorkflow(workflowId);
  const list = useExecutions(workflowId, {
    page,
    limit: 20,
    status: status || undefined,
  });

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <>
      <PageHeader
        title={
          workflow.data
            ? `${workflow.data.name}: history`
            : 'Execution history'
        }
        description={
          workflow.data
            ? TRIGGER_MAP[workflow.data.triggerType].label
            : undefined
        }
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/automations">
              <ArrowLeft className="mr-1 size-4" />
              All automations
            </Link>
          </Button>
        }
      />

      {workflow.data && (
        <div className="mb-3">
          <WorkflowStatusBadge status={workflow.data.status} />
        </div>
      )}

      <div className="mb-4">
        <Pick
          aria-label="Filter by execution status"
          className="w-auto"
          placeholder="All statuses"
          options={STATUSES}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <Card>
        {list.isLoading ? (
          <div
            className="space-y-2 p-4"
            role="status"
            aria-label="Loading executions"
          >
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState
            message={errorMessage(list.error)}
            onRetry={() => list.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title={
              status
                ? 'No executions with this status'
                : 'No executions yet'
            }
            description={
              status
                ? undefined
                : 'When this automation runs, every run shows up here with its results.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {items.map((execution) => (
                <TableRow
                  key={execution._id}
                  className="cursor-pointer"
                  onClick={() => setSelected(execution._id)}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      aria-label={`View execution details for ${execution._id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(execution._id);
                      }}
                    >
                      {formatDateTime(
                        execution.startedAt ?? execution.createdAt,
                      )}
                    </button>
                  </TableCell>

                  <TableCell>
                    <ExecutionStatusBadge status={execution.status} />
                  </TableCell>

                  <TableCell>
                    {execution.attemptCount}/{execution.maxAttempts}
                  </TableCell>

                  <TableCell className="max-w-sm truncate text-sm text-muted-foreground">
                    {execution.errorSummary ??
                      `${
                        execution.actionResults.filter(
                          (result) => result.status === 'SUCCESS',
                        ).length
                      } of ${execution.actionResults.length} actions succeeded`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {meta && meta.total > 0 && (
        <div className="mt-4">
          <Pagination
            page={meta.page}
            pageCount={meta.totalPages}
            total={meta.total}
            pageSize={meta.limit}
            onPageChange={setPage}
          />
        </div>
      )}

      <ExecutionDetail
        workflowId={workflowId}
        executionId={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
