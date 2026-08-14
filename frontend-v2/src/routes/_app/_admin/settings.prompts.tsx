import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentKeys } from '@/domains/content/content.api';
import { platformKeys } from '@/domains/configuration/platform.api';
import {
  platformPromptListQueryOptions,
  promptKeys,
} from '@/domains/configuration/prompt.api';
import {
  PromptWorkspacePage,
  type PromptMutationKind,
} from '@/domains/configuration/prompt-workspace-page';
import {
  isCanonicalPromptWorkspaceSearch,
  promptWorkspaceSearchSchema,
} from '@/domains/configuration/prompt-workspace.model';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/settings/prompts')({
  staticData: { navId: 'prompts', breadcrumb: 'Prompt 管理' },
  validateSearch: promptWorkspaceSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(promptWorkspaceSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalPromptWorkspaceSearch(location.search, search)) {
      throw redirect({ to: '/settings/prompts', search, replace: true });
    }
  },
  loader: ({ context }) => {
    const options = platformPromptListQueryOptions();
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="Prompt 管理发生意外错误" />
  ),
  component: PromptWorkspaceRoute,
});

function PromptWorkspaceRoute() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { auth } = Route.useRouteContext();

  async function invalidateConsumers(kind: PromptMutationKind) {
    if (kind === 'create') return;
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: promptKeys.previewOptionsRoot() }),
      queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: platformKeys.details() }),
      queryClient.invalidateQueries({
        predicate: (query) => contentKeys.isGenerationOptions(query.queryKey),
      }),
    ];
    if (kind === 'delete') {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: contentKeys.details() }),
        queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts() }),
      );
    }
    await Promise.all(invalidations);
  }

  return (
    <PromptWorkspacePage
      csrfToken={auth.csrfToken}
      onConsumersChanged={invalidateConsumers}
      onSearchChange={(nextSearch, replace = false) => navigate({
        search: nextSearch,
        replace,
      })}
      search={search}
    />
  );
}
