import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/publishing/issues')({
  staticData: { navId: 'publishing-issues', breadcrumb: '内容问题' },
  component: Outlet,
});
