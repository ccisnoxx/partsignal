import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { aiChannelDetailQueryOptions } from '@/domains/configuration/ai-channel.api';
import { AIChannelWorkspacePage } from '@/domains/configuration/ai-channel-workspace-page';
import {
  aiChannelWorkspaceSearchSchema,
  isCanonicalAIChannelWorkspaceSearch,
} from '@/domains/configuration/ai-channel-workspace.model';
import { promptKeys } from '@/domains/configuration/prompt.api';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/settings/ai_/$channelId')({
  staticData: { navId: 'ai-channels', breadcrumb: 'AI 渠道工作区' },
  validateSearch: aiChannelWorkspaceSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(aiChannelWorkspaceSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, params, search }) => {
    if (!z.uuid().safeParse(params.channelId).success) {
      throw new Error(`AI Channel ID 不是有效 UUID：${params.channelId}`);
    }
    const canonicalChannelId = params.channelId.toLowerCase();
    if (params.channelId !== canonicalChannelId) {
      throw redirect({
        to: '/settings/ai/$channelId',
        params: { channelId: canonicalChannelId },
        search,
        replace: true,
      });
    }
    if (!isCanonicalAIChannelWorkspaceSearch(location.search, search)) {
      throw redirect({
        to: '/settings/ai/$channelId',
        params,
        search,
        replace: true,
      });
    }
  },
  loader: ({ context, params }) => {
    const options = aiChannelDetailQueryOptions(params.channelId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="AI Channel Workspace 发生意外错误" />
  ),
  component: AIChannelWorkspaceRoute,
});

function AIChannelWorkspaceRoute() {
  const queryClient = useQueryClient();
  const { channelId } = Route.useParams();
  const search = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();

  async function invalidateConsumers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: promptKeys.previewOptionsRoot() }),
      queryClient.invalidateQueries({
        predicate: (query) => contentKeys.isGenerationOptions(query.queryKey),
      }),
    ]);
  }

  return (
    <AIChannelWorkspacePage
      channelId={channelId}
      csrfToken={auth.csrfToken}
      onConsumersChanged={invalidateConsumers}
      onDeleted={() => navigate({
        to: '/settings/ai',
        search: { page: 1, pageSize: 20 },
        replace: true,
      })}
      onSearchChange={(nextSearch) => navigate({ search: nextSearch })}
      search={search}
    />
  );
}
