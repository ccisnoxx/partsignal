import { createFileRoute, redirect } from '@tanstack/react-router';

import { publishedArticleListQueryOptions } from '@/domains/publication/publication.api';
import { PublishedArticleListPage } from '@/domains/publication/published-article-list-page';
import {
  isCanonicalPublishedArticleSearch,
  publishedArticleSearchSchema,
} from '@/domains/publication/published-article.model';

export const Route = createFileRoute('/_app/publishing/articles/')({
  validateSearch: publishedArticleSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(publishedArticleSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalPublishedArticleSearch(location.search, search)) {
      throw redirect({ to: '/publishing/articles', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = publishedArticleListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublishedArticlesRoute,
});

function PublishedArticlesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PublishedArticleListPage
      onSearchChange={(nextSearch) => navigate({ search: nextSearch })}
      search={search}
    />
  );
}
