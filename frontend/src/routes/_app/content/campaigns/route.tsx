import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/content/campaigns')({
  staticData: { navId: 'content-campaigns', breadcrumb: '内容活动' },
  component: Outlet,
});
