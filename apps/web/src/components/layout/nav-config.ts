
import {
  Activity,
  Building2,
  CalendarDays,
  ChartColumn,
  Columns3,
  Contact,
  FileText,
  LayoutDashboard,
  ListChecks,
  Settings,
  Target,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden from the menu when the user lacks it. UX only: the API enforces permissions. */
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { label: 'Overview', to: '/app/dashboard', icon: LayoutDashboard },
      { label: 'Leads', to: '/app/leads', icon: Target },
      { label: 'Contacts', to: '/app/contacts', icon: Contact },
      { label: 'Properties', to: '/app/properties', icon: Building2 },
      { label: 'Pipeline', to: '/app/pipeline', icon: Columns3 },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Tasks', to: '/app/tasks', icon: ListChecks },
      { label: 'Calendar', to: '/app/calendar', icon: CalendarDays },
      { label: 'Activities', to: '/app/activities', icon: Activity },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Analytics',
        to: '/app/analytics',
        icon: ChartColumn,
        permission: 'analytics:read',
      },
      {
        label: 'Reports',
        to: '/app/reports',
        icon: FileText,
        permission: 'reports:read',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Team Members', to: '/app/team', icon: UsersRound },
      { label: 'Settings', to: '/app/settings', icon: Settings },
    ],
  },
];
