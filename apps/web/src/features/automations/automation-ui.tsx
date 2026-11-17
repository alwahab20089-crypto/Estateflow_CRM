import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from 'lucide-react';
import type { ChangeEvent, ComponentProps } from 'react';
import { useFormContext, type Path } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { humanize } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { ActionResult, ExecutionStatus, WorkflowStatus } from '@/types/automations';
import type { FormValues } from './automation-schemas';

const tone = {
  neutral: 'bg-muted text-muted-foreground', info: 'bg-info/10 text-info', success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning', danger: 'bg-destructive/10 text-destructive',
};
const WORKFLOW_TONE: Record<WorkflowStatus, keyof typeof tone> = { DRAFT: 'neutral', ACTIVE: 'success', PAUSED: 'warning', ARCHIVED: 'neutral' };
const EXEC_TONE: Record<ExecutionStatus, keyof typeof tone> = { PENDING: 'info', RUNNING: 'info', COMPLETED: 'success', PARTIALLY_FAILED: 'warning', FAILED: 'danger', CANCELLED: 'neutral' };

export const WorkflowStatusBadge = ({ status }: { status: WorkflowStatus }) => (
  <Badge variant="secondary" className={tone[WORKFLOW_TONE[status]]}>{humanize(status)}</Badge>
);
export const ExecutionStatusBadge = ({ status }: { status: ExecutionStatus }) => (
  <Badge variant="secondary" className={tone[EXEC_TONE[status]]}>{humanize(status)}</Badge>
);

export function ResultIcon({ status }: { status: ActionResult['status'] }) {
  const common = { className: 'size-4 shrink-0', 'aria-hidden': true } as const;
  if (status === 'SUCCESS') return <CheckCircle2 {...common} className="size-4 shrink-0 text-success" />;
  if (status === 'FAILED') return <XCircle {...common} className="size-4 shrink-0 text-destructive" />;
  if (status === 'SKIPPED') return <MinusCircle {...common} className="size-4 shrink-0 text-muted-foreground" />;
  return <CircleDashed {...common} className="size-4 shrink-0 text-muted-foreground" />;
}

/** Native <select>: accessible, keyboard-friendly and simple to test. */
export const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-[invalid=true]:border-destructive';
export function Pick({ options, placeholder, className, ...props }: ComponentProps<'select'> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select className={cn(selectClass, className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Binds a native input/select/textarea to a react-hook-form path (works inside useFieldArray rows). */
export function useBind() {
  const { watch, setValue, formState } = useFormContext<FormValues>();
  return (name: Path<FormValues>) => ({
    value: String(watch(name) ?? ''),
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setValue(name, e.target.value as never, { shouldDirty: true, shouldValidate: formState.isSubmitted || Boolean(getErr(formState.errors, name)) }),
  });
}
export function getErr(errors: unknown, path: string): string | undefined {
  const node = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), errors);
  return node && typeof node === 'object' && 'message' in node ? String((node as { message: unknown }).message) : undefined;
}