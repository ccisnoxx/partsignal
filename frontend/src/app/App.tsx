/** 应用根组件，声明全局 Provider 和全部业务路由。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { AuthProvider } from '../features/auth/AuthProvider';
import { QueryLoading } from '../shared/components/AsyncState';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { queryClient } from './queryClient';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const ProductsPage = lazy(() => import('../features/product-facts/ProductsPage').then((module) => ({ default: module.ProductsPage })));
const ProductFactsPage = lazy(() => import('../features/product-facts/ProductFactsPage').then((module) => ({ default: module.ProductFactsPage })));
const ContentTasksPage = lazy(() => import('../features/content-tasks/ContentTasksPage').then((module) => ({ default: module.ContentTasksPage })));
const ContentEditorPage = lazy(() => import('../features/content-editor/ContentEditorPage').then((module) => ({ default: module.ContentEditorPage })));
const PublicationsPage = lazy(() => import('../features/publications/PublicationsPage').then((module) => ({ default: module.PublicationsPage })));
const GeoObservationsPage = lazy(() => import('../features/geo-observations/GeoObservationsPage').then((module) => ({ default: module.GeoObservationsPage })));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const UserManagementPage = lazy(() => import('../features/users/UserManagementPage').then((module) => ({ default: module.UserManagementPage })));
const ConfigurationPage = lazy(() => import('../features/configuration/ConfigurationPage').then((module) => ({ default: module.ConfigurationPage })));

export function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{
      token: { colorPrimary: '#d85f36', borderRadius: 8, colorText: '#17342e', fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif' },
      components: { Layout: { siderBg: '#0b2d25', headerBg: '#f4f0e8' }, Button: { primaryShadow: 'none' } },
    }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <Suspense fallback={<main className="centered"><QueryLoading /></main>}><Routes>
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
                    <Route path="publications/:publicationId" element={<PublicationsPage />} />
                    <Route path="publication-attentions/:attentionId" element={<PublicationsPage />} />
                    <Route path="publication-attentions/:attentionId/repair" element={<PublicationsPage />} />
                    <Route path="observations" element={<GeoObservationsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="users" element={<UserManagementPage />} />
                    <Route path="configuration" element={<ConfigurationPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes></Suspense>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
