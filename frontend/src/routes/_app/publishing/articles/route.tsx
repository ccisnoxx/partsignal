import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/publishing/articles')({
  staticData: { navId: 'publishing-articles', breadcrumb: '发布成果' },
  component: Outlet,
});
