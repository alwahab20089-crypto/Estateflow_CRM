export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export const PLATFORM_ROLES = ['NONE', 'PLATFORM_ADMIN'] as const;
export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT'] as const;
export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export const MEMBERSHIP_INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'] as const;
export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'MEETING_SCHEDULED',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;

export const OPEN_LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'MEETING_SCHEDULED',
  'NEGOTIATION',
] as const;

export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const LEAD_TYPES = ['BUYER', 'SELLER', 'TENANT', 'LANDLORD', 'INVESTOR'] as const;

export const LEAD_SOURCES = [
  'WEBSITE',
  'FACEBOOK',
  'INSTAGRAM',
  'WHATSAPP',
  'REFERRAL',
  'WALK_IN',
  'PROPERTY_PORTAL',
  'PHONE_CALL',
  'OTHER',
] as const;

export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT',
  'PLOT',
  'COMMERCIAL',
  'OFFICE',
  'FARMHOUSE',
  'OTHER',
] as const;

export const ACTIVITY_ENTITY_TYPES = ['LEAD', 'CONTACT', 'PROPERTY', 'TASK', 'DEAL', 'AUTOMATION'] as const;

export const ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'MEETING',
  'NOTE',
  'STATUS_CHANGE',
  'FOLLOW_UP',
  'PROPERTY_VIEWING',
  'OTHER',
  'CREATED',
  'ASSIGNMENT',
  'UPDATE',
  'CONVERTED',
] as const;

export const CONTACT_TYPES = ['BUYER', 'SELLER', 'TENANT', 'LANDLORD', 'INVESTOR', 'OTHER'] as const;
export const CONTACT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const CONTACT_METHODS = ['PHONE', 'EMAIL', 'WHATSAPP', 'SMS'] as const;

/** Lead statuses that may be converted into a contact. LOST is deliberately excluded (reopen it first). */
export const CONVERTIBLE_LEAD_STATUSES = ['QUALIFIED', 'MEETING_SCHEDULED', 'NEGOTIATION', 'WON'] as const;

/** Money is stored as integer minor units. 1e13 minor units is far below 2^53, so doubles stay exact. */
export const MAX_MINOR_UNITS = 10_000_000_000_000;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const PROPERTY_STATUSES = [
  'DRAFT',
  'AVAILABLE',
  'UNDER_OFFER',
  'RESERVED',
  'SOLD',
  'RENTED',
  'LEASED',
  'INACTIVE',
] as const;

export const LISTING_TYPES = ['SALE', 'RENT', 'LEASE'] as const;
export const AREA_UNITS = ['SQFT', 'SQM', 'MARLA', 'KANAL', 'ACRE'] as const;

export const FURNISHING_STATUSES = [
  'FURNISHED',
  'SEMI_FURNISHED',
  'UNFURNISHED',
  'NOT_APPLICABLE',
] as const;

export const RENT_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

export const DEAL_TYPES = LISTING_TYPES;

export const DEAL_STAGES = [
  'NEW',
  'QUALIFICATION',
  'PROPERTY_MATCHED',
  'VIEWING_SCHEDULED',
  'NEGOTIATION',
  'CONTRACT',
  'WON',
  'LOST',
] as const;

export const MAX_PROPERTY_IMAGES = 20;

/** Property status after a deal of that type is WON. */
export const CLOSED_PROPERTY_STATUS = {
  SALE: 'SOLD',
  RENT: 'RENTED',
  LEASE: 'LEASED',
} as const;

/** Statuses that can still take a deal. */
export const DEALABLE_PROPERTY_STATUSES = ['AVAILABLE', 'UNDER_OFFER', 'RESERVED'] as const;

export const TASK_TYPES = [
  'CALL',
  'MEETING',
  'PROPERTY_VIEWING',
  'FOLLOW_UP',
  'EMAIL',
  'DOCUMENTATION',
  'GENERAL',
] as const;

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const OPEN_TASK_STATUSES = ['TODO', 'IN_PROGRESS'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TASK_RELATED_ENTITY_TYPES = ['LEAD', 'CONTACT', 'PROPERTY', 'DEAL'] as const;

export const REMINDER_STATUSES = ['NONE', 'PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'FAILED'] as const;

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'TASK_REMINDER',
  'TASK_OVERDUE',
  'TASK_COMPLETED',
  'TASK_DUE_SOON',
  'LEAD_ASSIGNED',
  'DEAL_ASSIGNED',
  'DEAL_WON',
  'DEAL_LOST',
  'PROPERTY_STATUS_CHANGED',
  'AUTOMATION',
  'AUTOMATION_COMPLETED',
  'AUTOMATION_FAILED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Cannot be disabled by user preferences. */
export const MANDATORY_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'TASK_ASSIGNED',
  'LEAD_ASSIGNED',
  'DEAL_ASSIGNED',
  'TASK_OVERDUE',
  'AUTOMATION_FAILED',
];