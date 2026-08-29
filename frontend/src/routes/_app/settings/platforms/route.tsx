import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/settings/platforms')({
  staticData: { navId: 'platforms', breadcrumb: '平台与账号' },
  component: Outlet,
});
