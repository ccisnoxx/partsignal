import { createFileRoute, redirect } from '@tanstack/react-router';

import { queryTopicListQueryOptions } from '@/domains/geo/geo.api';
import { QueryTopicListPage } from '@/domains/geo/query-topic-list-page';
import {
  isCanonicalQueryTopicSearch,
  queryTopicSearchSchema,
} from '@/domains/geo/query-topic-list.model';

export const Route = createFileRoute('/_app/geo/topics/')({
  validateSearch: queryTopicSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(queryTopicSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalQueryTopicSearch(location.search, search)) {
      throw redirect({ to: '/geo/topics', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = queryTopicListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: QueryTopicsRoute,
});

function QueryTopicsRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <QueryTopicListPage
      csrfToken={auth.csrfToken}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
