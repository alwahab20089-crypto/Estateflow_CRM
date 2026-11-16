import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function ChartCard({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-section-title">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Dims the previous data while a new date range loads, so numbers of two ranges are never mixed up silently. */
export function Fade({ fetching, children }: { fetching: boolean; children: ReactNode }) {
  return (
    <div aria-busy={fetching} className={cn('space-y-6 transition-opacity', fetching && 'opacity-60')}>
      {children}
    </div>
  );
}

export function SectionSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading analytics" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
          <Card key={i} className="py-5">
            <CardContent className="space-y-3 px-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function Notes({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-1.5 py-4 text-sm">
        <p className="font-medium">{title}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export interface TableColumn<T> { header: string; cell: (row: T) => ReactNode; className?: string }

export function SimpleTable<T>({ caption, columns, rows, getKey }: { caption: string; columns: TableColumn<T>[]; rows: T[]; getKey: (row: T, index: number) => string }) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={c.className}>{c.header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={getKey(r, i)}>
            {columns.map((c) => (
              <TableCell key={c.header} className={c.className}>{c.cell(r)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const NUM = 'text-right tabular-nums';