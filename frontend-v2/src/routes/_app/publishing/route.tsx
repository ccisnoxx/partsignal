import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/publishing')({
  staticData: { breadcrumb: '发布管理' },
  component: Outlet,
});
