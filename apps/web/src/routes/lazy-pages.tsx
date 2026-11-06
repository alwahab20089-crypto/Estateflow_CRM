
import { lazy, Suspense, type ReactNode } from 'react';

// Authentication pages
export const AcceptInvitationPage = lazy(() =>
  import('@/features/auth/pages/accept-invitation-page')
    .then((m) => ({ default: m.AcceptInvitationPage }))
);

export const ForgotPasswordPage = lazy(() =>
  import('@/features/auth/pages/forgot-password-page')
    .then((m) => ({ default: m.ForgotPasswordPage }))
);

export const LoginPage = lazy(() =>
  import('@/features/auth/pages/login-page')
    .then((m) => ({ default: m.LoginPage }))
);

export const RegisterPage = lazy(() =>
  import('@/features/auth/pages/register-page')
    .then((m) => ({ default: m.RegisterPage }))
);

export const ResetPasswordPage = lazy(() =>
  import('@/features/auth/pages/reset-password-page')
    .then((m) => ({ default: m.ResetPasswordPage }))
);

// Dashboard
export const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page')
    .then((m) => ({ default: m.DashboardPage }))
);

// Leads
export const LeadDetailPage = lazy(() =>
  import('@/features/leads/lead-detail-page')
    .then((m) => ({ default: m.LeadDetailPage }))
);

export const LeadsPage = lazy(() =>
  import('@/features/leads/leads-page')
    .then((m) => ({ default: m.LeadsPage }))
);

// Contacts
export const ContactDetailPage = lazy(() =>
  import('@/features/contacts/contact-detail-page')
    .then((m) => ({ default: m.ContactDetailPage }))
);

export const ContactsPage = lazy(() =>
  import('@/features/contacts/contacts-page')
    .then((m) => ({ default: m.ContactsPage }))
);

// Settings
export const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page')
    .then((m) => ({ default: m.SettingsPage }))
);

// Other pages
export const ActivitiesPage = lazy(() =>
  import('@/pages/activities-page')
    .then((m) => ({ default: m.ActivitiesPage }))
);

export const AnalyticsPage = lazy(() =>
  import('@/pages/analytics-page')
    .then((m) => ({ default: m.AnalyticsPage }))
);

export const PipelinePage = lazy(() =>
  import('@/pages/pipeline-page')
    .then((m) => ({ default: m.PipelinePage }))
);

export const PropertiesPage = lazy(() =>
  import('@/pages/properties-page')
    .then((m) => ({ default: m.PropertiesPage }))
);

export const TasksPage = lazy(() =>
  import('@/pages/tasks-page')
    .then((m) => ({ default: m.TasksPage }))
);

export const TeamPage = lazy(() =>
  import('@/pages/team-page')
    .then((m) => ({ default: m.TeamPage }))
);

// Shared loading wrapper
export function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-[40vh] items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <span className="text-sm text-muted-foreground">
            Loading page...
          </span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
