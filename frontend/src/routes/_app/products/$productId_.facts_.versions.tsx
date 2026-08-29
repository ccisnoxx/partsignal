import { createFileRoute, redirect } from '@tanstack/react-router';

import { FactHistoryPage } from '@/domains/product/fact-history-page';
import {
  factHistorySearchSchema,
  isCanonicalFactHistorySearch,
} from '@/domains/product/fact-history.model';
import { productFactHistoryQueryOptions } from '@/domains/product/product.api';

export const Route = createFileRoute('/_app/products/$productId_/facts_/versions')({
  staticData: { breadcrumb: '事实版本历史' },
  validateSearch: factHistorySearchSchema,
  search: {
    middlewares: [({ search, next }) => next(factHistorySearchSchema.parse(search))],
  },
  beforeLoad: ({ location, params, search }) => {
    if (!isCanonicalFactHistorySearch(location.search, search)) {
      throw redirect({
        to: '/products/$productId/facts/versions',
        params: { productId: params.productId },
        search,
        replace: true,
      });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps, params }) => {
    const options = productFactHistoryQueryOptions(params.productId, deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: FactHistoryRoute,
});

function FactHistoryRoute() {
  const { productId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FactHistoryPage
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      productId={productId}
      search={search}
    />
  );
}
