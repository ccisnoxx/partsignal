import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/content/tasks')({
  staticData: { navId: 'content-tasks', breadcrumb: '内容任务' },
  component: Outlet,
});
