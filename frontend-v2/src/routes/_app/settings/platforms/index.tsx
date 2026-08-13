import { createFileRoute, redirect } from '@tanstack/react-router';

import { platformListQueryOptions } from '@/domains/configuration/platform.api';
import { PlatformListPage } from '@/domains/configuration/platform-list-page';
import {
  isCanonicalPlatformSearch,
  platformSearchSchema,
} from '@/domains/configuration/platform-list.model';

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
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <PlatformListPage
      csrfToken={auth.csrfToken}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
