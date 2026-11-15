import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LoadingButton } from '@/components/common/loading-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembers } from '@/features/leads/use-leads';
import { errorMessage } from '@/lib/errors';
import type { TaskDto } from '@/types/tasks';
import { TaskFormDialog } from './task-form-dialog';
import { useAssignTask, useCompleteTask, useDeleteTask, useRestoreTask, useUpdateTaskStatus } from './use-tasks';

const NONE = 'unassigned';

function AssignForm({ task, onDone }: { task: TaskDto; onDone: () => void }) {
  const members = useMembers();
  const assign = useAssignTask();
  const [value, setValue] = useState(task.assignedTo ?? NONE);
  const submit = async () => {
    if (assign.isPending) return;
    try {
      await assign.mutateAsync({ id: task._id, assignedTo: value === NONE ? null : value });
      toast.success('Assignment updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the assignment'));
    }
  };
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="task-assign-select">Assigned member</Label>
        <Select value={value} onValueChange={setValue} disabled={members.isLoading}>
          <SelectTrigger id="task-assign-select" className="w-full"><SelectValue placeholder={members.isLoading ? 'Loading members…' : undefined} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {(members.data ?? []).map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {members.isError && <p role="alert" className="text-xs text-destructive">Could not load team members.</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onDone} disabled={assign.isPending}>Cancel</Button>
        <LoadingButton onClick={submit} loading={assign.isPending} disabled={members.isLoading}>Save assignment</LoadingButton>
      </DialogFooter>
    </>
  );
}

export interface TaskActions {
  edit: (t: TaskDto) => void;
  assign: (t: TaskDto) => void;
  archive: (t: TaskDto) => void;
  cancel: (t: TaskDto) => void;
  complete: (t: TaskDto) => Promise<void>;
  reopen: (t: TaskDto) => Promise<void>;
  restore: (t: TaskDto) => Promise<void>;
  /** Render once per page: it hosts the edit/assign/confirm dialogs the actions above open. */
  dialogs: ReactNode;
}

export function useTaskActions(): TaskActions {
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'assign' | 'archive' | 'cancel'; task: TaskDto } | null>(null);
  const completeM = useCompleteTask();
  const statusM = useUpdateTaskStatus();
  const deleteM = useDeleteTask();
  const restoreM = useRestoreTask();
  const close = () => setDialog(null);

  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, fail));
    }
  };

  return {
    edit: (task) => setDialog({ kind: 'edit', task }),
    assign: (task) => setDialog({ kind: 'assign', task }),
    archive: (task) => setDialog({ kind: 'archive', task }),
    cancel: (task) => setDialog({ kind: 'cancel', task }),
    complete: (t) => run(() => completeM.mutateAsync({ id: t._id }), 'Task completed', 'Could not complete the task'),
    reopen: (t) => run(() => statusM.mutateAsync({ id: t._id, status: 'TODO' }), 'Task reopened', 'Could not reopen the task'),
    restore: (t) => run(() => restoreM.mutateAsync(t._id), 'Task restored', 'Could not restore the task'),
    dialogs: (
      <>
        <TaskFormDialog open={dialog?.kind === 'edit'} onOpenChange={(o) => !o && close()} task={dialog?.kind === 'edit' ? dialog.task : null} />
        <Dialog open={dialog?.kind === 'assign'} onOpenChange={(o) => !o && close()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Assign task</DialogTitle>
              <DialogDescription>Only active members of your organization can be assigned.</DialogDescription>
            </DialogHeader>
            {dialog?.kind === 'assign' && <AssignForm task={dialog.task} onDone={close} />}
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={dialog?.kind === 'cancel'} onOpenChange={(o) => !o && close()} title="Cancel this task?"
          description="Cancelled tasks stop sending reminders. You can reopen the task later." confirmLabel="Cancel task" destructive
          onConfirm={() => dialog && run(() => statusM.mutateAsync({ id: dialog.task._id, status: 'CANCELLED' }), 'Task cancelled', 'Could not cancel the task')}
        />
        <ConfirmDialog
          open={dialog?.kind === 'archive'} onOpenChange={(o) => !o && close()} title="Archive this task?"
          description="The task is archived, not erased, and its reminder is cancelled. An administrator can restore it." confirmLabel="Archive task" destructive
          onConfirm={() => dialog && run(() => deleteM.mutateAsync(dialog.task._id), 'Task archived', 'Could not archive the task')}
        />
      </>
    ),
  };
}