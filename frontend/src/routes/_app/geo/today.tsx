import { createFileRoute, Navigate } from '@tanstack/react-router';

import { DailyChecklistPage } from '@/domains/geo-checklist/daily-checklist-page';

export const Route = createFileRoute('/_app/geo/today')({
  component: GeoTodayRoute,
});

function GeoTodayRoute() {
  const { auth } = Route.useRouteContext();
  if (auth.user?.account_type === 'VIEWER') {
    return <Navigate replace to="/geo/overview" />;
  }
  return <DailyChecklistPage csrfToken={auth.csrfToken} />;
}
