import { createFileRoute } from '@tanstack/react-router';

import { NewGeoObservationPage } from '@/domains/geo/new-geo-observation-page';

export const Route = createFileRoute('/_app/geo/observations/new')({
  staticData: { breadcrumb: '新建 Observation' },
  component: NewGeoObservationRoute,
});

function NewGeoObservationRoute() {
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <NewGeoObservationPage
      csrfToken={auth.csrfToken}
      onCancel={() => void navigate({
        to: '/geo/observations',
        search: { page: 1, pageSize: 20 },
      })}
      onCreated={() => void navigate({
        to: '/geo/observations',
        search: { page: 1, pageSize: 20 },
      })}
    />
  );
}
