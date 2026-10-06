import { createFileRoute, redirect } from '@tanstack/react-router';
import { CatalogPage } from '@/domains/geo-catalog/catalog-page';
import { catalogDetailQueryOptions, catalogListQueryOptions } from '@/domains/geo-catalog/catalog.api';
import { catalogSearchSchema, isCanonicalCatalogSearch } from '@/domains/geo-catalog/catalog.model';
import { productsKeys } from '@/domains/product/product.api';

export const Route = createFileRoute('/_app/configuration/geo-entities')({
  staticData: { navId: 'geo-entities', breadcrumb: '监测对象与竞品' },
  validateSearch: catalogSearchSchema,
  search: { middlewares: [({ search, next }) => next(catalogSearchSchema.parse(search))] },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalCatalogSearch(location.search, search)) throw redirect({ to: '/configuration/geo-entities', search, replace: true });
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(catalogListQueryOptions(deps));
    if (deps.subject_id) void context.queryClient.prefetchQuery(catalogDetailQueryOptions(deps.subject_id));
  },
  component: CatalogRoute,
});
function CatalogRoute() {
  const search = Route.useSearch();
  const { auth, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return <CatalogPage csrfToken={auth.csrfToken} isAdmin={auth.isAdmin} onConsumersChanged={async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productsKeys.lists() }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: productsKeys.details() }, { throwOnError: true }),
    ]);
  }} onSearchChange={(next, replace, ignoreBlocker) => void navigate({ search: next, replace, ignoreBlocker })} search={search} />;
}
