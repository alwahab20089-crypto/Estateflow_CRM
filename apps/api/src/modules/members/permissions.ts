
import type { MemberRole } from '../../constants';

const CRM_RESOURCES = ['leads', 'contacts', 'properties', 'tasks', 'activities', 'deals'];

const crm = (actions: string[]) =>
  CRM_RESOURCES.flatMap((r) => actions.map((a) => `${r}:${a}`));


export const ALL_PERMISSIONS: string[] = [
  'org:read',
  'org:update',
  'org:delete',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'analytics:read',
  'analytics:team',
  'reports:read',
  'reports:export',
  'billing:read',
  'billing:manage',
  'license:read',
  'license:manage',
  'leads:read_all',
  'leads:assign',
  'leads:reopen',
  'leads:convert',
  'contacts:read_all',
  'contacts:assign',
  'properties:assign',
  'properties:manage_all',
  'deals:read_all',
  'deals:assign',
  'deals:reopen',
  'tasks:read_all',
  'tasks:assign',
  'tasks:restore',
  'notifications:read',
  'notifications:manage',
  'automations:read',
  'automations:create',
  'automations:update',
  'automations:delete',
  'automations:activate',
  'automations:execute',
  'automations:execution_read',
  'automations:retry',
  'notifications:preferences_update',
  
  ...crm(['read', 'create', 'update', 'delete']),
];

const ROLE_PERMISSIONS: Record<MemberRole, string[]> = {
  OWNER: ALL_PERMISSIONS,

  // ADMIN: organization settings and members, but no billing, license or organization deletion
  ADMIN: ALL_PERMISSIONS.filter(
    (p) =>
      p !== 'org:delete' &&
      !p.startsWith('billing:') &&
      !p.startsWith('license:'),
  ),

  MANAGER: [
    'org:read',
    'members:read',
    'analytics:read',
    'analytics:team',
    'reports:read',
    'reports:export',
    'leads:read_all',
    'leads:assign',
    'leads:reopen',
    'leads:convert',
    'contacts:read_all',
    'contacts:assign',
    'properties:assign',
    'properties:manage_all',
    'deals:read_all',
    'deals:assign',
    'deals:reopen',
    'tasks:read_all',
    'tasks:assign',
    'tasks:restore',
    'notifications:read',
    'notifications:manage',
    'automations:read',
    'automations:execution_read',
    'notifications:preferences_update',

    ...crm(['read', 'create', 'update']),
  ],

  AGENT: [
    'org:read',
    'leads:convert',
    'notifications:read',
    'notifications:manage',
    'analytics:read',
    'reports:read',
    'notifications:preferences_update',
    ...crm(['read', 'create', 'update']),
  ],
};

/** Effective permissions = (role defaults ∪ grants) − denied */
export function resolvePermissions(
  role: MemberRole,
  grants: string[] = [],
  denied: string[] = [],
): string[] {
  const merged = new Set([...ROLE_PERMISSIONS[role], ...grants]);

  return [...merged].filter((p) => !denied.includes(p)).sort();
}
