import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/products')({
  staticData: { navId: 'products', breadcrumb: '产品' },
  component: Outlet,
});
