import { AsyncLocalStorage } from 'node:async_hooks';

/** Set while an execution runs its actions, so events raised by those actions inherit depth and chain. */
export interface AutomationContext { depth: number; chain: string[]; executionId: string }
export const automationContext = new AsyncLocalStorage<AutomationContext>();