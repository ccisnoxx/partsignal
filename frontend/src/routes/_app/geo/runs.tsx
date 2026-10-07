import { createFileRoute, redirect } from '@tanstack/react-router';
import { batchListOptions, runListOptions } from '@/domains/geo-runs/runs.api';
import { RunsPage } from '@/domains/geo-runs/runs-page';
import { isCanonicalRunSearch, runSearchSchema } from '@/domains/geo-runs/runs.model';

export const Route = createFileRoute('/_app/geo/runs')({
  staticData: { navId: 'geo-runs', breadcrumb: '运行中心' },
  validateSearch: runSearchSchema,
  search: { middlewares: [({ search, next }) => next(runSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalRunSearch(location.search, search)) throw redirect({ to: '/geo/runs', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    if (deps.view === 'runs') void context.queryClient.prefetchQuery(runListOptions(deps));
    else void context.queryClient.prefetchQuery(batchListOptions(deps));
  },
  component: RunsRoute,
});
function RunsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <RunsPage
      csrfToken={auth.csrfToken}
      onSearchChange={(next, replace, ignoreBlocker) => void navigate({ search: next, replace, ignoreBlocker })}
      search={search}
    />
  );
}
