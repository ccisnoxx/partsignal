import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/articles')({
  staticData: { navId: 'articles', breadcrumb: '文章与发布' },
  component: Outlet,
});
