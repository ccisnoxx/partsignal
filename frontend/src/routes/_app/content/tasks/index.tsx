import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentTaskListQueryOptions } from '@/domains/content/content.api';
import { ContentTaskListPage } from '@/domains/content/content-task-list-page';
import {
  contentTasksSearchSchema,
  isCanonicalContentTasksSearch,
} from '@/domains/content/content-task-list.model';

export const Route = createFileRoute('/_app/content/tasks/')({
  validateSearch: contentTasksSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(contentTasksSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalContentTasksSearch(location.search, search)) {
      throw redirect({ to: '/content/tasks', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = contentTaskListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: ContentTasksRoute,
});

function ContentTasksRoute() {
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <ContentTaskListPage
      csrfToken={auth.csrfToken}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
