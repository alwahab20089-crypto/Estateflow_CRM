import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMPTY_OPERATORS, OPERATOR_LABELS, TRIGGER_MAP, fieldsFor, operatorsFor } from './automation-catalog';
import { Pick, getErr, useBind } from './automation-ui';
import type { FormValues } from './automation-schemas';
import type { ConditionOperator } from '@/types/automations';

export function ConditionsStep() {
  const { control, watch, setValue, formState: { errors } } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'conditions' });
  const bind = useBind();
  const trigger = TRIGGER_MAP[watch('triggerType') as keyof typeof TRIGGER_MAP];
  if (!trigger) return <p className="text-sm text-muted-foreground">Choose a trigger first.</p>;
  const available = fieldsFor(trigger);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Optional. Without conditions the automation runs every time the trigger fires.</p>
      {fields.length > 1 && (
        <FormField id="wf-match" label="Run when">
          <Pick id="wf-match" {...bind('conditionOperator')} options={[{ value: 'ALL', label: 'ALL conditions match' }, { value: 'ANY', label: 'ANY condition matches' }]} />
        </FormField>
      )}
      {fields.map((row, i) => {
        const field = available.find((f) => f.value === watch(`conditions.${i}.field`));
        const operator = watch(`conditions.${i}.operator`) as ConditionOperator | '';
        const needsValue = Boolean(field) && !EMPTY_OPERATORS.includes(operator as ConditionOperator);
        return (
          <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div>
              <Pick aria-label={`Condition ${i + 1} field`} aria-invalid={Boolean(getErr(errors, `conditions.${i}.field`))} placeholder="Field…"
                options={available.map((f) => ({ value: f.value, label: f.label }))} value={watch(`conditions.${i}.field`)}
                onChange={(e) => {
                  const next = available.find((f) => f.value === e.target.value);
                  setValue(`conditions.${i}.field`, e.target.value);
                  setValue(`conditions.${i}.operator`, next ? operatorsFor(next)[0]! : '');
                  setValue(`conditions.${i}.value`, '');
                }} />
              <p role="alert" className="mt-1 text-xs text-destructive">{getErr(errors, `conditions.${i}.field`)}</p>
            </div>
            <div>
              <Pick aria-label={`Condition ${i + 1} operator`} disabled={!field} {...bind(`conditions.${i}.operator`)}
                options={(field ? operatorsFor(field) : []).map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
            </div>
            <div>
              {needsValue && (field?.options ? (
                <Pick aria-label={`Condition ${i + 1} value`} placeholder="Value…" options={field.options.map((o) => ({ value: o, label: o }))} {...bind(`conditions.${i}.value`)} />
              ) : (
                <Input aria-label={`Condition ${i + 1} value`} type={field?.type === 'number' ? 'number' : 'text'} placeholder="Value" {...bind(`conditions.${i}.value`)} />
              ))}
              <p role="alert" className="mt-1 text-xs text-destructive">{getErr(errors, `conditions.${i}.value`)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove condition ${i + 1}`} onClick={() => remove(i)}><Trash2 className="size-4" /></Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" disabled={fields.length >= 10} onClick={() => append({ field: '', operator: '', value: '' })}>
        <Plus className="mr-1 size-4" /> Add condition
      </Button>
    </div>
  );
}