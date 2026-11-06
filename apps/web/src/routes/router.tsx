
import { CalendarDays, FileText } from 'lucide-react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from '@/layouts/app-layout';
import { AuthLayout } from '@/layouts/auth-layout';

import { ComingSoonPage } from '@/pages/coming-soon-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RouteError } from '@/pages/route-error';

import { PublicOnly, RequireAuth } from './guards';

import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  DashboardPage,
  LeadDetailPage,
  LeadsPage,
  ContactDetailPage,
  ContactsPage,
  SettingsPage,
  ActivitiesPage,
  AnalyticsPage,
  PipelinePage,
  PropertiesPage,
  TasksPage,
  TeamPage,
  LazyPage,
} from './lazy-pages';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/app/dashboard" replace />,
  },
  {
    errorElement: <RouteError />,
    children: [
      // Public authentication routes
      {
        element: <PublicOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              {
                path: '/login',
                element: (
                  <LazyPage>
                    <LoginPage />
                  </LazyPage>
                ),
              },
              {
                path: '/register',
                element: (
                  <LazyPage>
                    <RegisterPage />
                  </LazyPage>
                ),
              },
              {
                path: '/forgot-password',
                element: (
                  <LazyPage>
                    <ForgotPasswordPage />
                  </LazyPage>
                ),
              },
            ],
          },
        ],
      },

      // Other authentication routes
      {
        element: <AuthLayout />,
        children: [
          {
            path: '/reset-password',
            element: (
              <LazyPage>
                <ResetPasswordPage />
              </LazyPage>
            ),
          },
          {
            path: '/accept-invitation',
            element: (
              <LazyPage>
                <AcceptInvitationPage />
              </LazyPage>
            ),
          },
        ],
      },

      // Protected application routes
      {
        path: '/app',
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              {
                index: true,
                element: <Navigate to="dashboard" replace />,
              },
              {
                path: 'dashboard',
                element: (
                  <LazyPage>
                    <DashboardPage />
                  </LazyPage>
                ),
              },
              {
                path: 'leads',
                element: (
                  <LazyPage>
                    <LeadsPage />
                  </LazyPage>
                ),
              },
              {
                path: 'leads/:leadId',
                element: (
                  <LazyPage>
                    <LeadDetailPage />
                  </LazyPage>
                ),
              },
              {
                path: 'contacts',
                element: (
                  <LazyPage>
                    <ContactsPage />
                  </LazyPage>
                ),
              },
              {
                path: 'contacts/:contactId',
                element: (
                  <LazyPage>
                    <ContactDetailPage />
                  </LazyPage>
                ),
              },
              {
                path: 'properties',
                element: (
                  <LazyPage>
                    <PropertiesPage />
                  </LazyPage>
                ),
              },
              {
                path: 'pipeline',
                element: (
                  <LazyPage>
                    <PipelinePage />
                  </LazyPage>
                ),
              },
              {
                path: 'tasks',
                element: (
                  <LazyPage>
                    <TasksPage />
                  </LazyPage>
                ),
              },
              {
                path: 'calendar',
                element: (
                  <ComingSoonPage
                    title="Calendar"
                    description="Viewings, meetings and follow-ups in one schedule."
                    icon={CalendarDays}
                    message="A shared calendar with viewing scheduling is planned. For now, due dates live on each task."
                  />
                ),
              },
              {
                path: 'activities',
                element: (
                  <LazyPage>
                    <ActivitiesPage />
                  </LazyPage>
                ),
              },
              {
                path: 'analytics',
                element: (
                  <LazyPage>
                    <AnalyticsPage />
                  </LazyPage>
                ),
              },
              {
                path: 'reports',
                element: (
                  <ComingSoonPage
                    title="Reports"
                    description="Exportable reports for owners and managers."
                    icon={FileText}
                    message="Scheduled and exportable reports are planned after the core CRM modules are complete."
                  />
                ),
              },
              {
                path: 'team',
                element: (
                  <LazyPage>
                    <TeamPage />
                  </LazyPage>
                ),
              },
              {
                path: 'settings',
                element: (
                  <LazyPage>
                    <SettingsPage />
                  </LazyPage>
                ),
              },
              {
                path: '*',
                element: <NotFoundPage />,
              },
            ],
          },
        ],
      },

      // Global 404
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
