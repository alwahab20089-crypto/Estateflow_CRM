import { describe, expect, it } from 'vitest';
import { ACTIONS, actionsFor, describeAction, describeCondition, describeTrigger, fieldsFor, operatorsFor, TRIGGER_MAP, TRIGGERS } from './automation-catalog';

describe('automation catalog', () => {
  it('offers task/lead/deal actions only for matching triggers', () => {
    const types = (t: Parameters<typeof actionsFor>[0]) => actionsFor(t).map((a) => a.value);
    expect(types('LEAD')).toContain('ASSIGN_LEAD');
    expect(types('LEAD')).not.toContain('UPDATE_TASK_STATUS');
    expect(types('TASK')).toContain('UPDATE_TASK_STATUS');
    expect(types('DEAL')).toContain('ASSIGN_DEAL');
    expect(types('CONTACT')).toEqual(['CREATE_TASK', 'CREATE_IN_APP_NOTIFICATION', 'SEND_EMAIL_NOTIFICATION']);
    expect(ACTIONS.some((a) => /delete|payment|invoice/i.test(a.value))).toBe(false);
  });
  it('exposes previous/new value only on change triggers, and numeric operators only on numeric fields', () => {
    expect(fieldsFor(TRIGGER_MAP.LEAD_STATUS_CHANGED).map((f) => f.value)).toEqual(expect.arrayContaining(['from', 'to']));
    expect(fieldsFor(TRIGGER_MAP.LEAD_CREATED).map((f) => f.value)).not.toContain('to');
    const value = fieldsFor(TRIGGER_MAP.DEAL_CREATED).find((f) => f.value === 'valueAmount')!;
    expect(operatorsFor(value)).toContain('GREATER_THAN');
    const status = fieldsFor(TRIGGER_MAP.LEAD_CREATED).find((f) => f.value === 'status')!;
    expect(operatorsFor(status)).not.toContain('GREATER_THAN');
    expect(operatorsFor(fieldsFor(TRIGGER_MAP.LEAD_CREATED).find((f) => f.value === 'assignedTo')!)).toEqual(['IS_EMPTY', 'IS_NOT_EMPTY']);
  });
  it('writes human-readable summaries', () => {
    expect(describeCondition({ field: 'priority', operator: 'EQUALS', value: 'HIGH' }, TRIGGER_MAP.LEAD_CREATED)).toBe('Priority equals HIGH');
    expect(describeCondition({ field: 'assignedTo', operator: 'IS_EMPTY' }, TRIGGER_MAP.LEAD_CREATED)).toBe('Assignee is empty');
    expect(describeAction({ type: 'CREATE_TASK', title: 'Call {{name}}', dueInHours: 24, assignTo: { mode: 'USER', userId: 'u1' } }, (id) => (id === 'u1' ? 'Ayesha' : '')))
      .toBe('Create task "Call {{name}}" for Ayesha, due in 24 hours');
    expect(describeTrigger('TASK_DUE_SOON', { withinMinutes: 90 })).toContain('90 minutes');
    expect(TRIGGERS).toHaveLength(21);
  });
});