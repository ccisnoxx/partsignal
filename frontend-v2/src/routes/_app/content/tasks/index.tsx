import { createFileRoute, redirect, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';

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
  const createdTaskId = useLocation({
    select: (location) => location.state.contentTaskCreated,
  });
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!createdTaskId) return;
    void navigate({
      replace: true,
      search,
      state: (previous) => ({ ...previous, contentTaskCreated: undefined }),
      to: '/content/tasks',
    });
  }, [createdTaskId, navigate, search]);
  return (
    <ContentTaskListPage
      csrfToken={auth.csrfToken}
      initialNotice={createdTaskId ? '内容任务已创建，列表已刷新。' : undefined}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
