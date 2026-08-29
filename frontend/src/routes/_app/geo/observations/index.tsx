import { createFileRoute, redirect } from '@tanstack/react-router';

import { geoObservationListQueryOptions } from '@/domains/geo/geo.api';
import { GeoObservationListPage } from '@/domains/geo/geo-observation-list-page';
import {
  geoObservationSearchSchema,
  isCanonicalGeoObservationSearch,
} from '@/domains/geo/geo-observation-list.model';

export const Route = createFileRoute('/_app/geo/observations/')({
  validateSearch: geoObservationSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(geoObservationSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalGeoObservationSearch(location.search, search)) {
      throw redirect({ to: '/geo/observations', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = geoObservationListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: GeoObservationsRoute,
});

function GeoObservationsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <GeoObservationListPage
      csrfToken={auth.csrfToken}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
