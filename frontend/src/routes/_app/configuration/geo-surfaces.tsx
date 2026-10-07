import { createFileRoute, redirect } from '@tanstack/react-router';
import { SurfacesPage } from '@/domains/geo-catalog/surfaces-page';
import { profileListQueryOptions, profileQueryOptions, surfaceListQueryOptions, surfaceQueryOptions } from '@/domains/geo-catalog/surfaces.api';
import { isCanonicalSurfacesSearch, surfacesSearchSchema } from '@/domains/geo-catalog/surfaces-search.model';

export const Route = createFileRoute('/_app/configuration/geo-surfaces')({
  staticData: { navId: 'geo-surfaces', breadcrumb: 'GEO 平台与采集配置' },
  validateSearch: surfacesSearchSchema,
  search: { middlewares: [({ search, next }) => next(surfacesSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalSurfacesSearch(location.search, search)) throw redirect({ to: '/configuration/geo-surfaces', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    if (deps.tab === 'profiles') {
      void context.queryClient.prefetchQuery(profileListQueryOptions(deps));
      if (deps.profile_id) void context.queryClient.prefetchQuery(profileQueryOptions(deps.profile_id));
    } else {
      void context.queryClient.prefetchQuery(surfaceListQueryOptions(deps));
      if (deps.surface_id) void context.queryClient.prefetchQuery(surfaceQueryOptions(deps.surface_id));
    }
  },
  component: SurfacesRoute,
});
function SurfacesRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return <SurfacesPage isAdmin={auth.isAdmin} onSearchChange={(next, replace, ignoreBlocker) => void navigate({ search: next, replace, ignoreBlocker })} search={search} token={auth.csrfToken} />;
}
