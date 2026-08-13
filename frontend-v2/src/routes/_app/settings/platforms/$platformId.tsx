import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { platformDetailQueryOptions } from '@/domains/configuration/platform.api';
import {
  PlatformWorkspacePage,
  type PlatformAccountMutationKind,
  type PlatformMutationKind,
} from '@/domains/configuration/platform-workspace-page';
import {
  isCanonicalPlatformWorkspaceSearch,
  platformWorkspaceSearchSchema,
} from '@/domains/configuration/platform-workspace.model';
import { publicationKeys } from '@/domains/publication/publication.api';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/settings/platforms/$platformId')({
  staticData: { breadcrumb: '平台工作区' },
  validateSearch: platformWorkspaceSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(platformWorkspaceSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, params, search }) => {
    if (!z.uuid().safeParse(params.platformId).success) {
      throw new Error(`Platform ID 不是有效 UUID：${params.platformId}`);
    }
    const canonicalPlatformId = params.platformId.toLocaleLowerCase();
    if (params.platformId !== canonicalPlatformId) {
      throw redirect({
        to: '/settings/platforms/$platformId',
        params: { platformId: canonicalPlatformId },
        search,
        replace: true,
      });
    }
    if (!isCanonicalPlatformWorkspaceSearch(location.search, search)) {
      throw redirect({
        to: '/settings/platforms/$platformId',
        params,
        search,
        replace: true,
      });
    }
  },
  loader: ({ context, params }) => {
    const options = platformDetailQueryOptions(params.platformId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="Platform Workspace 发生意外错误" />
  ),
  component: PlatformWorkspaceRoute,
});

function PlatformWorkspaceRoute() {
  const queryClient = useQueryClient();
  const { platformId } = Route.useParams();
  const { tab } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();

  async function invalidateConsumers(kind: PlatformMutationKind) {
    if (kind === 'generation') {
      await queryClient.invalidateQueries({
        predicate: (query) => contentKeys.isGenerationOptions(query.queryKey),
      });
      return;
    }

    const invalidations = kind === 'status' ? [
      queryClient.invalidateQueries({ queryKey: contentKeys.creationOptionsRoot() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workspaceContexts() }),
    ] : [
      queryClient.invalidateQueries({ queryKey: contentKeys.platformReferences() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.creationOptionsRoot() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.details() }),
      queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workspaceContexts() }),
    ];
    await Promise.all(invalidations);
  }

  async function invalidateAccountConsumers(kind: PlatformAccountMutationKind) {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: publicationKeys.readyItems() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workspaceContexts() }),
    ];
    if (kind === 'update' || kind === 'delete') {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
      );
    }
    await Promise.all(invalidations);
  }

  return (
    <PlatformWorkspacePage
      canManagePlatformTypes={auth.isAdmin}
      csrfToken={auth.csrfToken}
      onAccountConsumersChanged={invalidateAccountConsumers}
      onConsumersChanged={invalidateConsumers}
      onDeleted={() => navigate({
        to: '/settings/platforms',
        search: { page: 1, pageSize: 20 },
        replace: true,
      })}
      onTabChange={(nextTab) => navigate({ search: { tab: nextTab } })}
      platformId={platformId}
      tab={tab}
    />
  );
}
