import { createFileRoute } from '@tanstack/react-router';

import { NewGeoObservationPage } from '@/domains/geo/new-geo-observation-page';
import { newGeoObservationSearchSchema } from '@/domains/geo/new-geo-observation.model';

export const Route = createFileRoute('/_app/geo/observations/new')({
  validateSearch: newGeoObservationSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(newGeoObservationSearchSchema.parse(search))],
  },
  staticData: { breadcrumb: '新建 Observation' },
  component: NewGeoObservationRoute,
});

function NewGeoObservationRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <NewGeoObservationPage
      csrfToken={auth.csrfToken}
      onCancel={() => void navigate({
        to: '/geo/observations',
        search: { page: 1, pageSize: 20 },
      })}
      onCreated={(observationId) => void navigate({
        to: '/geo/observations/$observationId',
        params: { observationId },
      })}
      queryTopicId={search.queryTopicId}
      geoPlatform={search.geoPlatform}
    />
  );
}
