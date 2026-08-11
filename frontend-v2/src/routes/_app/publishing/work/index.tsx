import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentKeys } from '@/domains/content/content.api';
import { publicationWorkListQueryOptions } from '@/domains/publication/publication.api';
import { PublicationWorkPage } from '@/domains/publication/publication-work-page';
import {
  isCanonicalPublicationWorkSearch,
  publicationWorkSearchSchema,
} from '@/domains/publication/publication-work.model';

export const Route = createFileRoute('/_app/publishing/work/')({
  validateSearch: publicationWorkSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(publicationWorkSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalPublicationWorkSearch(location.search, search)) {
      throw redirect({ to: '/publishing/work', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = publicationWorkListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PublicationWorkRoute,
});

function PublicationWorkRoute() {
  const search = Route.useSearch();
  const { auth, queryClient } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <PublicationWorkPage
      csrfToken={auth.csrfToken}
      onContentProjectionChange={async (taskId) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.editorContext(taskId) }),
          queryClient.invalidateQueries({ queryKey: contentKeys.reviewContext(taskId) }),
        ]);
      }}
      onSearchChange={(nextSearch) => navigate({ search: nextSearch })}
      search={search}
    />
  );
}
