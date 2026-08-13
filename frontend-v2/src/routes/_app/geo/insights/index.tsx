import { createFileRoute, redirect } from '@tanstack/react-router';

import { GeoInsightsPage } from '@/domains/geo/geo-insights-page';
import { geoInsightsQueryOptions } from '@/domains/geo/geo.api';
import {
  geoInsightSearchSchema,
  isCanonicalGeoInsightSearch,
} from '@/domains/geo/geo-insights.model';

export const Route = createFileRoute('/_app/geo/insights/')({
  validateSearch: geoInsightSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(geoInsightSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalGeoInsightSearch(location.search, search)) {
      throw redirect({ to: '/geo/insights', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = geoInsightsQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: GeoInsightsRoute,
});

function GeoInsightsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <GeoInsightsPage
      csrfToken={auth.csrfToken}
      onCreated={(taskId) => void navigate({
        to: '/content/tasks/$taskId',
        params: { taskId },
      })}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
