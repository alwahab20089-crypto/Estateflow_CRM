import { CalendarClock, FileText, Home, ListChecks, Mail, Phone, Users, type LucideIcon } from 'lucide-react';
import type { TaskKind, TaskPriorityValue, TaskRelatedType, TaskState } from '@/types/tasks';

export const TASK_TYPES: TaskKind[] = ['CALL', 'MEETING', 'PROPERTY_VIEWING', 'FOLLOW_UP', 'EMAIL', 'DOCUMENTATION', 'GENERAL'];
export const TASK_STATUSES: TaskState[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export const TASK_PRIORITIES: TaskPriorityValue[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const RELATED_TYPES: TaskRelatedType[] = ['LEAD', 'CONTACT', 'PROPERTY', 'DEAL'];
export const PAGE_SIZES = [10, 20, 50];

export const TASK_TYPE_ICONS: Record<TaskKind, LucideIcon> = {
  CALL: Phone, MEETING: Users, PROPERTY_VIEWING: Home, FOLLOW_UP: CalendarClock, EMAIL: Mail, DOCUMENTATION: FileText, GENERAL: ListChecks,
};

export const RELATED_LABELS: Record<TaskRelatedType, string> = { LEAD: 'Lead', CONTACT: 'Contact', PROPERTY: 'Property', DEAL: 'Deal' };
export const RELATED_READ_PERMISSION: Record<TaskRelatedType, string> = {
  LEAD: 'leads:read', CONTACT: 'contacts:read', PROPERTY: 'properties:read', DEAL: 'deals:read',
};

export const relatedPath = (type: TaskRelatedType, id: string) =>
  ({ LEAD: `/app/leads/${id}`, CONTACT: `/app/contacts/${id}`, PROPERTY: `/app/properties/${id}`, DEAL: `/app/pipeline/${id}` })[type];

export const taskPath = (id: string) => `/app/tasks?task=${id}`;
export const isOpenStatus = (s: TaskState) => s === 'TODO' || s === 'IN_PROGRESS';

export const PRIORITY_BORDER: Record<TaskPriorityValue, string> = {
  LOW: 'border-l-muted-foreground/40', MEDIUM: 'border-l-info', HIGH: 'border-l-warning', URGENT: 'border-l-destructive',
};