import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/publishing/work')({
  staticData: { navId: 'publishing-work', breadcrumb: '发布工作' },
  component: Outlet,
});
