import { createFileRoute, redirect } from '@tanstack/react-router';
import { OverviewPage } from '@/domains/geo-insights/overview-page';
import { overviewOptions } from '@/domains/geo-insights/insights.api';
import { insightSearchSchema, isCanonicalInsightSearch } from '@/domains/geo-insights/drilldown.model';

export const Route = createFileRoute('/_app/geo/overview')({
  staticData: { navId: 'geo-overview', breadcrumb: '总览' },
  validateSearch: insightSearchSchema,
  search: { middlewares: [({ search, next }) => next(insightSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalInsightSearch(location.search, search)) throw redirect({ to: '/geo/overview', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(overviewOptions(deps)); },
  component: OverviewRoute,
});
function OverviewRoute() {
  const navigate = Route.useNavigate();
  return <OverviewPage search={Route.useSearch()} onSearchChange={(search, replace) => void navigate({ search, replace })}/>;
}
