import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { contentKeys } from '@/domains/content/content.api';
import { aiChannelKeys, aiChannelListQueryOptions } from '@/domains/configuration/ai-channel.api';
import { AIChannelListPage } from '@/domains/configuration/ai-channel-list-page';
import {
  aiChannelSearchSchema,
  isCanonicalAIChannelSearch,
} from '@/domains/configuration/ai-channel-list.model';
import { promptKeys } from '@/domains/configuration/prompt.api';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/settings/ai')({
  staticData: { navId: 'ai-channels', breadcrumb: 'AI 渠道' },
  validateSearch: aiChannelSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(aiChannelSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalAIChannelSearch(location.search, search)) {
      throw redirect({ to: '/settings/ai', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = aiChannelListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="AI 渠道发生意外错误" />
  ),
  component: AIChannelListRoute,
});

function AIChannelListRoute() {
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { auth } = Route.useRouteContext();

  return (
    <AIChannelListPage
      csrfToken={auth.csrfToken}
      onChannelChanged={async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: aiChannelKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: promptKeys.previewOptionsRoot() }),
          queryClient.invalidateQueries({
            predicate: (query) => contentKeys.isGenerationOptions(query.queryKey),
          }),
        ]);
      }}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
