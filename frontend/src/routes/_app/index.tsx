import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';

import { getAuthRouteUser } from '@/app/auth/auth-provider';
import { WorkbenchPage } from '@/domains/workbench/workbench-page';
import { workbenchQueryOptions } from '@/domains/workbench/workbench.api';

export const Route = createFileRoute('/_app/')({
  staticData: { navId: 'workbench', breadcrumb: '工作台' },
  beforeLoad: ({ context }) => {
    const user = getAuthRouteUser(context.queryClient);
    if (user?.account_type === 'VIEWER') {
      throw redirect({ replace: true, to: '/geo/dashboard' });
    }
  },
  loader: ({ context }) => {
    const user = getAuthRouteUser(context.queryClient);
    if (user?.account_type === 'VIEWER') return;
    const options = workbenchQueryOptions();
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: WorkbenchRoute,
});

function WorkbenchRoute() {
  const { auth } = Route.useRouteContext();
  if (auth.user?.account_type === 'VIEWER') {
    return <Navigate replace to="/geo/dashboard" />;
  }
  return <WorkbenchPage />;
}
