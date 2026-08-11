import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/publishing')({
  staticData: { navId: 'publishing', breadcrumb: '发布' },
  component: Outlet,
});
