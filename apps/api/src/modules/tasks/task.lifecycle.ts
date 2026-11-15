import { OPEN_TASK_STATUSES } from '../../constants';

export const TASK_PRIORITY_RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };
export const isOpenTask = (status: string) => (OPEN_TASK_STATUSES as readonly string[]).includes(status);
export const FAR_FUTURE = new Date('9999-12-31T00:00:00.000Z'); // sort key for tasks with no due date