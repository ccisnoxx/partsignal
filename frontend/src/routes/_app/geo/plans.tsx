import { createFileRoute, redirect } from '@tanstack/react-router';
import { planDetailOptions, planListOptions } from '@/domains/geo-plans/plans.api';
import { PlansPage } from '@/domains/geo-plans/plans-page';
import { isCanonicalPlanSearch, planSearchSchema } from '@/domains/geo-plans/plans.model';
export const Route = createFileRoute('/_app/geo/plans')({
  staticData: { navId: 'geo-plans', breadcrumb: '监测计划' },
  validateSearch: planSearchSchema,
  search: { middlewares: [({ search, next }) => next(planSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => { if (!isCanonicalPlanSearch(location.search, search)) throw redirect({ to: '/geo/plans', search, replace: true }); },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => { void context.queryClient.prefetchQuery(planListOptions(deps)); if (deps.selected) void context.queryClient.prefetchQuery(planDetailOptions(deps.selected)); },
  component: PlansRoute,
});
function PlansRoute() {
  const search = Route.useSearch(); const { auth } = Route.useRouteContext(); const navigate = Route.useNavigate();
  return <PlansPage csrfToken={auth.csrfToken} onSearchChange={(next, replace, ignoreBlocker) => void navigate({ search: next, replace, ignoreBlocker })} search={search} />;
}
