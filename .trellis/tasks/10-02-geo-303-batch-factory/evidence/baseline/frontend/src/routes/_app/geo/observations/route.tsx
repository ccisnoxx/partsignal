import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/geo/observations')({
  staticData: { navId: 'geo-observations', breadcrumb: '观测记录' },
  component: Outlet,
});
