import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/geo/insights')({
  staticData: { navId: 'geo-insights', breadcrumb: 'GEO 洞察' },
  component: Outlet,
});
