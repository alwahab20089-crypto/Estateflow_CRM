import type { TaskDto } from '@/types/tasks';

export const makeTask = (over: Partial<TaskDto> = {}): TaskDto => ({
  _id: 't1', title: 'Call buyer', description: null, taskType: 'CALL', status: 'TODO', priority: 'HIGH',
  dueAt: '2026-11-14T10:00:00.000Z', reminderAt: null, reminderStatus: 'NONE', reminderDeliveredAt: null, completedAt: null, isOverdue: false,
  assignedTo: 'u1', assignee: { _id: 'u1', name: 'Ayesha Khan', email: 'a@x.com' }, createdBy: 'u1', creator: { _id: 'u1', name: 'Ayesha Khan', email: 'a@x.com' },
  relatedEntityType: 'LEAD', relatedEntityId: 'lead1', related: { type: 'LEAD', _id: 'lead1', label: 'Olivia Bennett' }, tags: [],
  deletedAt: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...over,
});

export const listResult = (data: TaskDto[], meta = {}) => ({ data, meta: { page: 1, limit: 20, total: data.length, totalPages: 1, ...meta } });
export const authMock = (can: (p: string) => boolean = () => true) => ({
  useAuth: () => ({ can, activeMembership: { organization: { timezone: 'Asia/Karachi', currency: 'USD' } } }),
});