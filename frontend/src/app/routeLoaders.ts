/** 路由动态 import 的唯一目录，同时服务 React.lazy 与预取。 */
import { lazy } from 'react';

export const routeLoaders = {
  dashboard: () => import('../features/dashboard/DashboardPage'),
  products: () => import('../features/product-facts/ProductsPage'),
  productFacts: () => import('../features/product-facts/ProductFactsPage'),
  contentTasks: () => import('../features/content-tasks/ContentTasksPage'),
  contentEditor: () => import('../features/content-editor/ContentEditorPage'),
  publications: () => import('../features/publications/PublicationsPage'),
  geoObservations: () => import('../features/geo-observations/GeoObservationsPage'),
  settings: () => import('../features/settings/SettingsPage'),
  users: () => import('../features/users/UserManagementPage'),
  configurationLayout: () => import('../features/configuration/ConfigurationLayout'),
  aiChannels: () => import('../features/configuration/AIChannelsPage'),
  aiChannelDetail: () => import('../features/configuration/AIChannelDetailPage'),
  platformTypes: () => import('../features/configuration/PlatformTypesPage'),
  platforms: () => import('../features/configuration/PlatformsPage'),
  platformPrompts: () => import('../features/configuration/PlatformPromptsPage'),
  auditLog: () => import('../features/configuration/AuditLogPage'),
} as const;

export type RouteLoaderKey = keyof typeof routeLoaders;

export const DashboardPage = lazy(async () => ({ default: (await routeLoaders.dashboard()).DashboardPage }));
export const ProductsPage = lazy(async () => ({ default: (await routeLoaders.products()).ProductsPage }));
export const ProductFactsPage = lazy(async () => ({ default: (await routeLoaders.productFacts()).ProductFactsPage }));
export const ContentTasksPage = lazy(async () => ({ default: (await routeLoaders.contentTasks()).ContentTasksPage }));
export const ContentEditorPage = lazy(async () => ({ default: (await routeLoaders.contentEditor()).ContentEditorPage }));
export const PublicationsPage = lazy(async () => ({ default: (await routeLoaders.publications()).PublicationsPage }));
export const GeoObservationsPage = lazy(async () => ({ default: (await routeLoaders.geoObservations()).GeoObservationsPage }));
export const SettingsPage = lazy(async () => ({ default: (await routeLoaders.settings()).SettingsPage }));
export const UserManagementPage = lazy(async () => ({ default: (await routeLoaders.users()).UserManagementPage }));
export const ConfigurationLayout = lazy(async () => ({ default: (await routeLoaders.configurationLayout()).ConfigurationLayout }));
export const AIChannelsPage = lazy(async () => ({ default: (await routeLoaders.aiChannels()).AIChannelsPage }));
export const AIChannelDetailPage = lazy(async () => ({ default: (await routeLoaders.aiChannelDetail()).AIChannelDetailPage }));
export const PlatformTypesPage = lazy(async () => ({ default: (await routeLoaders.platformTypes()).PlatformTypesPage }));
export const PlatformsPage = lazy(async () => ({ default: (await routeLoaders.platforms()).PlatformsPage }));
export const PlatformPromptsPage = lazy(async () => ({ default: (await routeLoaders.platformPrompts()).PlatformPromptsPage }));
export const AuditLogPage = lazy(async () => ({ default: (await routeLoaders.auditLog()).AuditLogPage }));
