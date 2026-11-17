import { useState } from 'react';
import { LoadingButton } from '@/components/common/loading-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';
import type { WorkflowDto } from '@/types/automations';
import { ACTION_MAP, OPERATOR_LABELS } from './automation-catalog';
import { useTestWorkflow } from './use-automations';

export function TestWorkflowDialog({ workflow, onClose }: { workflow: WorkflowDto | null; onClose: () => void }) {
  const [entityId, setEntityId] = useState('');
  const test = useTestWorkflow();
  const close = () => { setEntityId(''); test.reset(); onClose(); };
  const r = test.data;

  return (
    <Dialog open={Boolean(workflow)} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test "{workflow?.name}"</DialogTitle>
          <DialogDescription>A dry run: it checks the conditions against a real record and lists what would happen. Nothing is created, changed or sent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="test-entity">Record ID (optional)</Label>
          <Input id="test-entity" value={entityId} onChange={(e) => setEntityId(e.target.value.trim())} placeholder="Paste the record's ID" />
        </div>
        <LoadingButton loading={test.isPending} onClick={() => workflow && test.mutate({ id: workflow._id, entityId: entityId || undefined })}>Run test</LoadingButton>
        {test.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(test.error)}</p>}
        {r && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p className="font-medium">{r.matched ? 'Conditions match: the automation would run.' : 'Conditions do not match: the automation would not run.'}</p>
            <ul className="space-y-1">
              {r.conditions.map((c, i) => <li key={i}>{c.passed ? '✓' : '✗'} {c.field} {OPERATOR_LABELS[c.operator]} {c.value === null ? '' : String(c.value)}</li>)}
            </ul>
            {r.matched && <ol className="list-decimal pl-5">{r.plannedActions.map((a) => <li key={a.index}>{ACTION_MAP[a.type].label}</li>)}</ol>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}