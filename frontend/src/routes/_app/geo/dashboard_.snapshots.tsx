import { createFileRoute } from '@tanstack/react-router';

import { ReportSnapshotsPage } from '@/domains/geo-dashboard/report-snapshots-page';

export const Route = createFileRoute('/_app/geo/dashboard_/snapshots')({
  staticData: { navId: 'geo-dashboard', breadcrumb: '冻结周报快照' },
  component: GeoDashboardSnapshotsRoute,
});

function GeoDashboardSnapshotsRoute() {
  const { auth } = Route.useRouteContext();
  const canOperate = auth.user?.account_type !== 'VIEWER';
  return <ReportSnapshotsPage canOperate={canOperate} csrfToken={auth.csrfToken} />;
}
