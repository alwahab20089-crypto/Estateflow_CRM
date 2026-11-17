import type { Condition } from './automation.validation';

type Payload = Record<string, unknown>;
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) =>
  typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a).toLowerCase() === String(b).toLowerCase();

/** Pure and total: unknown operators or bad types evaluate to false; nothing is ever sent to the database. */
export function evaluateCondition(c: Condition, payload: Payload): boolean {
  const actual = Object.prototype.hasOwnProperty.call(payload, c.field) ? payload[c.field] : undefined;
  const contains = () => typeof actual === 'string' && typeof c.value === 'string' && actual.toLowerCase().includes(c.value.toLowerCase());
  const num = (cmp: (a: number, b: number) => boolean) => {
    const a = Number(actual);
    const b = Number(c.value);
    return !isEmpty(actual) && Number.isFinite(a) && Number.isFinite(b) && cmp(a, b);
  };
  switch (c.operator) {
    case 'IS_EMPTY': return isEmpty(actual);
    case 'IS_NOT_EMPTY': return !isEmpty(actual);
    case 'EQUALS': return !isEmpty(actual) && same(actual, c.value);
    case 'NOT_EQUALS': return isEmpty(actual) || !same(actual, c.value);
    case 'CONTAINS': return contains();
    case 'NOT_CONTAINS': return !contains();
    case 'GREATER_THAN': return num((a, b) => a > b);
    case 'GREATER_THAN_OR_EQUAL': return num((a, b) => a >= b);
    case 'LESS_THAN': return num((a, b) => a < b);
    case 'LESS_THAN_OR_EQUAL': return num((a, b) => a <= b);
    default: return false;
  }
}

export const evaluateEach = (conditions: Condition[], payload: Payload) =>
  conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value ?? null, passed: evaluateCondition(c, payload) }));

/** No conditions = match everything. */
export function evaluateConditions(conditions: Condition[] | undefined, mode: 'ALL' | 'ANY' | string | undefined, payload: Payload): boolean {
  if (!conditions?.length) return true;
  return mode === 'ANY' ? conditions.some((c) => evaluateCondition(c, payload)) : conditions.every((c) => evaluateCondition(c, payload));
}