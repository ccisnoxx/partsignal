import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/geo/topics')({
  staticData: { navId: 'geo-topics', breadcrumb: '问题主题' },
  component: Outlet,
});
