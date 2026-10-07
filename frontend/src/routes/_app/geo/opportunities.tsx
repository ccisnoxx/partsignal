import { createFileRoute, redirect } from '@tanstack/react-router';
import { opportunityComparisonOptions, opportunityDetailOptions, opportunityListOptions } from '@/domains/geo-opportunities/opportunities.api';
import { isCanonicalOpportunitySearch, opportunitySearchSchema } from '@/domains/geo-opportunities/opportunities.model';
import { OpportunitiesPage } from '@/domains/geo-opportunities/opportunities-page';
export const Route = createFileRoute('/_app/geo/opportunities')({
  staticData: { navId: 'geo-opportunities', breadcrumb: '机会工作台' },
  validateSearch: opportunitySearchSchema,
  search: { middlewares: [({ search, next }) => next(opportunitySearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => { if (!isCanonicalOpportunitySearch(location.search, search)) throw redirect({ to: '/geo/opportunities', search, replace: true }); },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(opportunityListOptions(deps)); if (deps.opportunity_id) { void context.queryClient.prefetchQuery(opportunityDetailOptions(deps)); void context.queryClient.prefetchQuery(opportunityComparisonOptions(deps)); } },
  component: OpportunitiesRoute,
});
function OpportunitiesRoute() {
  const search = Route.useSearch(); const { auth } = Route.useRouteContext(); const navigate = Route.useNavigate();
  return <OpportunitiesPage isAdmin={auth.isAdmin} search={search} csrfToken={auth.csrfToken} onSearchChange={(next, replace) => void navigate({ search: next, replace })} />;
}
