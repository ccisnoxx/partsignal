import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentKeys } from '@/domains/content/content.api';
import { platformListQueryOptions } from '@/domains/configuration/platform.api';
import { PlatformListPage } from '@/domains/configuration/platform-list-page';
import {
  isCanonicalPlatformSearch,
  platformSearchSchema,
} from '@/domains/configuration/platform-list.model';
import { publicationKeys } from '@/domains/publication/publication.api';

export const Route = createFileRoute('/_app/settings/platforms/')({
  validateSearch: platformSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(platformSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalPlatformSearch(location.search, search)) {
      throw redirect({ to: '/settings/platforms', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = platformListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  component: PlatformsRoute,
});

function PlatformsRoute() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <PlatformListPage
      csrfToken={auth.csrfToken}
      onPlatformChanged={async (kind) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: contentKeys.creationOptionsRoot() }),
          queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems() }),
          queryClient.invalidateQueries({ queryKey: publicationKeys.workspaceContexts() }),
          ...(kind === 'delete' ? [
            queryClient.invalidateQueries({ queryKey: contentKeys.platformReferences() }),
            queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
            queryClient.invalidateQueries({ queryKey: contentKeys.details() }),
            queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts() }),
            queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
          ] : []),
        ]);
      }}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
