import { createFileRoute } from '@tanstack/react-router';

import { LeadershipDashboardPage } from '@/domains/geo-dashboard/leadership-dashboard-page';

export const Route = createFileRoute('/_app/geo/dashboard')({
  staticData: { navId: 'geo-dashboard', breadcrumb: '效果总览' },
  component: GeoDashboardRoute,
});

function GeoDashboardRoute() {
  const { auth } = Route.useRouteContext();
  const canOperate = auth.user?.account_type !== 'VIEWER';
  return <LeadershipDashboardPage canOperate={canOperate} csrfToken={auth.csrfToken} />;
}
