
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from '@/layouts/app-layout';
import { AuthLayout } from '@/layouts/auth-layout';

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
  DealDetailPage,
  PropertyDetailPage,
  SettingsPage,
  ActivitiesPage,
  AnalyticsPage,
  ReportsPage,
  ReportViewerPage,
  PipelinePage,
  PropertiesPage,
  TasksPage,
  CalendarPage,
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
                path: 'properties/:propertyId',
                element: (
                  <LazyPage>
                    <PropertyDetailPage />
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
                path: 'pipeline/:dealId',
                element: (
                  <LazyPage>
                    <DealDetailPage />
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
                  <LazyPage>
                    <CalendarPage />
                  </LazyPage>
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
                  <LazyPage>
                    <ReportsPage />
                  </LazyPage>
                ),
              },
              {
                path: 'reports/:reportId',
                element: (
                  <LazyPage>
                    <ReportViewerPage />
                  </LazyPage>
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
