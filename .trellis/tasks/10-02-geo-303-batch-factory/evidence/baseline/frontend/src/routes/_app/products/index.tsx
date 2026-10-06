import { createFileRoute, redirect, stripSearchParams } from '@tanstack/react-router';

import { productsListQueryOptions } from '@/domains/product/product.api';
import { ProductsListPage } from '@/domains/product/products-list-page';
import {
  isCanonicalProductsSearch,
  productsSearchSchema,
} from '@/domains/product/products-list.model';

export const Route = createFileRoute('/_app/products/')({
  validateSearch: productsSearchSchema,
  search: {
    middlewares: [
      ({ search, next }) => next(productsSearchSchema.parse(search)),
      stripSearchParams({ pageSize: 20, sort: 'UPDATED_DESC' }),
    ],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalProductsSearch(location.search, search)) {
      throw redirect({ to: '/products', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = productsListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: ProductsRoute,
});

function ProductsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <ProductsListPage
      csrfToken={auth.csrfToken}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
