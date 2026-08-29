import { createFileRoute, redirect } from '@tanstack/react-router';

import { GeoInsightsPrintPage } from '@/domains/geo/geo-insights-print-page';
import { geoInsightsQueryOptions } from '@/domains/geo/geo.api';
import {
  geoInsightSearchSchema,
  isCanonicalGeoInsightSearch,
} from '@/domains/geo/geo-insights.model';

export const Route = createFileRoute('/_app/geo/insights/print')({
  staticData: { layout: 'print' },
  validateSearch: geoInsightSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(geoInsightSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalGeoInsightSearch(location.search, search)) {
      throw redirect({ to: '/geo/insights/print', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = geoInsightsQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: GeoInsightsPrintRoute,
});

function GeoInsightsPrintRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <GeoInsightsPrintPage
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
