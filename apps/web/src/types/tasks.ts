import type { PageMeta } from '@/types/leads';

export type TaskKind = 'CALL' | 'MEETING' | 'PROPERTY_VIEWING' | 'FOLLOW_UP' | 'EMAIL' | 'DOCUMENTATION' | 'GENERAL';
export type TaskState = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskPriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskRelatedType = 'LEAD' | 'CONTACT' | 'PROPERTY' | 'DEAL';

export interface TaskPerson { _id: string; name: string; email: string; avatar?: string }

export interface TaskDto {
  _id: string;
  title: string;
  description: string | null;
  taskType: TaskKind;
  status: TaskState;
  priority: TaskPriorityValue;
  dueAt: string | null; // UTC ISO
  reminderAt: string | null;
  reminderStatus: 'NONE' | 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'CANCELLED' | 'FAILED';
  reminderDeliveredAt: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  assignedTo: string | null;
  assignee: TaskPerson | null;
  createdBy: string;
  creator: TaskPerson | null;
  relatedEntityType: TaskRelatedType | null;
  relatedEntityId: string | null;
  related: { type: TaskRelatedType; _id: string; label: string } | null;
  tags: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskListParams {
  page: number;
  limit: number;
  search?: string;
  status?: TaskState;
  priority?: TaskPriorityValue;
  taskType?: TaskKind;
  assignedTo?: string; // member id | 'me' | 'unassigned'
  dueFrom?: string; // UTC ISO
  dueTo?: string;
  overdue?: 'true';
  relatedEntityType?: TaskRelatedType;
  relatedEntityId?: string;
  sortBy: 'createdAt' | 'dueAt' | 'priority' | 'status' | 'title';
  sortOrder: 'asc' | 'desc';
  view: 'active' | 'archived';
}
export type TaskListResult = { data: TaskDto[]; meta: PageMeta };

/** create: undefined = omit. update: null = clear. */
export interface TaskPayload {
  title?: string;
  description?: string | null;
  taskType?: TaskKind;
  priority?: TaskPriorityValue;
  dueAt?: string | null;
  reminderAt?: string | null;
  relatedEntityType?: TaskRelatedType | null;
  relatedEntityId?: string | null;
  tags?: string[];
  assignedTo?: string | null;
}

export interface CalendarParams {
  from: string;
  to: string;
  assignedTo?: string;
  status?: TaskState;
  priority?: TaskPriorityValue;
  taskType?: TaskKind;
}
export interface CalendarMeta { from: string; to: string; total: number; truncated: boolean }
export type CalendarResult = { data: TaskDto[]; meta: CalendarMeta };

export interface TaskSummaryParams { dayStart: string; dayEnd: string; scope: 'mine' | 'team' }
export interface TaskSummaryDto {
  scope: 'mine' | 'team';
  myTasks: { count: number; items: TaskDto[] };
  dueToday: { count: number; items: TaskDto[] };
  overdue: { count: number; items: TaskDto[] };
  upcomingFollowUps: { items: TaskDto[] };
  recentlyCompleted: { items: TaskDto[] };
}

export interface NotificationDto {
  _id: string;
  type: 'TASK_ASSIGNED' | 'TASK_REMINDER' | 'TASK_OVERDUE' | 'TASK_COMPLETED';
  title: string;
  message: string;
  relatedEntityType: TaskRelatedType | null;
  relatedEntityId: string | null;
  taskId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationListParams { page: number; limit: number; unread?: 'true' }
export type NotificationListMeta = PageMeta & { unreadCount: number };
export type NotificationListResult = { data: NotificationDto[]; meta: NotificationListMeta };