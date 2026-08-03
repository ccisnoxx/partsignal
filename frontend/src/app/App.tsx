/** 应用根组件，声明全局 Provider 和全部业务路由。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ProtectedRoute } from './ProtectedRoute';
import { queryClient } from './queryClient';
import {
  AIChannelDetailPage,
  AIChannelsPage,
  AdminRoute,
  AuditLogPage,
  ContentEditorPage,
  ContentTasksPage,
  DashboardPage,
  GeoInsightsPage,
  GeoInsightsPrintPage,
  GeoObservationsPage,
  GeoTopicsPage,
  PlatformTypesPage,
  PlatformsPage,
  PlatformPromptsPage,
  ProductFactsPage,
  ProductsPage,
  PublicationsPage,
  SettingsPage,
  UserManagementPage,
} from './routeLoaders';
import { ThemeProvider } from './ThemeProvider';

const AppLayout = lazy(async () => ({ default: (await import('./AppLayout')).AppLayout }));
const ChangePasswordPage = lazy(async () => ({
  default: (await import('../features/auth/ChangePasswordPage')).ChangePasswordPage,
}));

export function App() {
  return (
    <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="change-password" element={<ChangePasswordPage />} />
                  <Route element={<AppLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="products" element={<ProductsPage />} />
                    <Route path="products/:productId" element={<ProductFactsPage />} />
                    <Route path="tasks" element={<ContentTasksPage />} />
                    <Route path="tasks/:taskId" element={<ContentTasksPage />} />
                    <Route path="content/:contentVersionId" element={<ContentEditorPage />} />
                    <Route path="publications" element={<PublicationsPage />} />
                    <Route path="observations" element={<GeoObservationsPage />} />
                    <Route path="observations/insights" element={<GeoInsightsPage />} />
                    <Route path="observations/insights/print" element={<GeoInsightsPrintPage />} />
                    <Route path="observations/topics" element={<GeoTopicsPage />} />
                    <Route path="observations/:observationId/correct" element={<GeoObservationsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route element={<AdminRoute />}>
                      <Route path="users" element={<UserManagementPage />} />
                      <Route path="audit" element={<AuditLogPage />} />
                      <Route path="configuration">
                        <Route index element={<Navigate to="ai" replace />} />
                        <Route path="ai" element={<AIChannelsPage />}>
                          <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
                        </Route>
                        <Route path="platform-types" element={<PlatformTypesPage />} />
                        <Route path="platforms" element={<PlatformsPage />} />
                        <Route path="prompts" element={<PlatformPromptsPage />} />
                      </Route>
                    </Route>
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
    </ThemeProvider>
  );
}
