import { describe, expect, it } from 'vitest';
import { defaultValues, formSchema, newAction, toPayload, workflowToForm, type FormValues } from './automation-schemas';

const valid = (over: Partial<FormValues> = {}): FormValues => ({
  ...defaultValues(), name: 'Follow up', triggerType: 'LEAD_CREATED',
  conditions: [{ field: 'priority', operator: 'EQUALS', value: 'HIGH' }],
  actions: [{ ...newAction('CREATE_TASK'), title: 'Call {{name}}', target: { mode: 'USER', userId: 'u1' } }], ...over,
});
const messages = (v: FormValues) => { const r = formSchema.safeParse(v); return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`); };

describe('automation form validation', () => {
  it('accepts a complete definition', () => expect(messages(valid())).toEqual([]));
  it('requires a name, a trigger and at least one action', () => {
    expect(messages(valid({ name: ' ' }))).toContain('name: Name is required');
    expect(messages(valid({ triggerType: '' }))).toContain('triggerType: Choose a trigger');
    expect(messages(valid({ actions: [] }))).toContain('actions: Add at least one action');
  });
  it('validates conditions against the trigger: unknown field, missing value, non-numeric value', () => {
    expect(messages(valid({ conditions: [{ field: 'to', operator: 'EQUALS', value: 'x' }] }))).toContain('conditions.0.field: Choose a field'); // "to" needs a change trigger
    expect(messages(valid({ conditions: [{ field: 'priority', operator: 'EQUALS', value: '' }] }))).toContain('conditions.0.value: Enter a value');
    expect(messages(valid({ triggerType: 'DEAL_CREATED', conditions: [{ field: 'valueAmount', operator: 'GREATER_THAN', value: 'lots' }] }))).toContain('conditions.0.value: Enter a number');
    expect(messages(valid({ conditions: [{ field: 'assignedTo', operator: 'IS_EMPTY', value: '' }] }))).toEqual([]);
  });
  it('validates each action and its recipient', () => {
    expect(messages(valid({ actions: [{ ...newAction('CREATE_TASK'), title: '' }] }))).toContain('actions.0.title: Task title is required');
    expect(messages(valid({ actions: [{ ...newAction('CREATE_TASK'), title: 'x', target: { mode: 'USER', userId: '' } }] }))).toContain('actions.0.target: Choose a team member');
    expect(messages(valid({ actions: [{ ...newAction('CREATE_TASK'), title: 'x', dueInHours: '-3' }] }))).toContain('actions.0.dueInHours: Enter whole hours from 0 to 8760');
    expect(messages(valid({ actions: [{ ...newAction('SEND_EMAIL_NOTIFICATION'), subject: '', body: '' }] }))).toEqual(expect.arrayContaining(['actions.0.subject: Subject is required', 'actions.0.body: Email body is required']));
  });
  it('rejects actions that do not fit the trigger', () => {
    expect(messages(valid({ actions: [{ ...newAction('UPDATE_TASK_STATUS') }] })).join()).toContain('only works with task triggers');
  });
  it('validates time-trigger options', () => {
    expect(messages(valid({ triggerType: 'TASK_DUE_SOON', conditions: [], triggerConfig: { withinMinutes: '2', inactiveDays: '', withinDays: '' } }))).toContain('triggerConfig.withinMinutes: Enter a whole number from 5 to 10080');
    expect(messages(valid({ triggerType: 'TASK_DUE_SOON', conditions: [], triggerConfig: { withinMinutes: '', inactiveDays: '', withinDays: '' } }))).toEqual([]); // default applies
  });
});

describe('payload mapping', () => {
  it('builds the exact API shape: numbers as numbers, no raw queries, defaults for time triggers', () => {
    const p = toPayload(valid({ triggerType: 'DEAL_CREATED', conditions: [{ field: 'valueAmount', operator: 'GREATER_THAN', value: '5000000' }, { field: 'assignedTo', operator: 'IS_EMPTY', value: '' }],
      actions: [{ ...newAction('ASSIGN_DEAL'), target: { mode: 'WORKFLOW_OWNER', userId: '' } }] }));
    expect(p.conditions).toEqual([{ field: 'valueAmount', operator: 'GREATER_THAN', value: 5_000_000 }, { field: 'assignedTo', operator: 'IS_EMPTY' }]);
    expect(p.actions).toEqual([{ type: 'ASSIGN_DEAL', assignTo: { mode: 'WORKFLOW_OWNER' } }]);
    expect(toPayload(valid({ triggerType: 'LEAD_WITHOUT_ACTIVITY', conditions: [] })).triggerConfig).toEqual({ inactiveDays: 3 });
  });
  it('round-trips an existing workflow into the form and back', () => {
    const payload = toPayload(valid({ description: 'desc', notifyOnCompletion: true }));
    const form = workflowToForm({ _id: 'w1', status: 'DRAFT', version: 1, createdBy: 'u1', updatedBy: null, lastExecutedAt: null, createdAt: '', updatedAt: '',
      executionSettings: { maxAttempts: 3, notifyOnCompletion: true, maxExecutionsPerHour: 100 }, triggerConfig: {}, ...payload, description: 'desc' } as never);
    expect(toPayload(form)).toEqual(payload);
  });
});