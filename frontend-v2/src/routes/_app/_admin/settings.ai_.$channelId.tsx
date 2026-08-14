import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { contentKeys } from '@/domains/content/content.api';
import { aiChannelDetailQueryOptions } from '@/domains/configuration/ai-channel.api';
import { AIChannelWorkspacePage } from '@/domains/configuration/ai-channel-workspace-page';
import {
  aiChannelWorkspaceSearchSchema,
  isCanonicalAIChannelWorkspaceSearch,
  isDeliveredAIChannelWorkspaceTab,
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
    if (!isDeliveredAIChannelWorkspaceTab(search.tab)) throw notFound();
  },
  loader: ({ context, params }) => {
    const options = aiChannelDetailQueryOptions(params.channelId);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  notFoundComponent: () => (
    <section className="space-y-2 rounded-xl border border-border-subtle bg-surface-panel p-5" role="alert">
      <p className="type-label text-text-muted">404</p>
      <h1 className="type-page-title">该 AI 渠道区域尚未交付</h1>
      <p className="text-text-secondary">当前已提供基本信息、请求配置与模型管理。</p>
    </section>
  ),
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="AI Channel Workspace 发生意外错误" />
  ),
  component: AIChannelWorkspaceRoute,
});

function AIChannelWorkspaceRoute() {
  const queryClient = useQueryClient();
  const { channelId } = Route.useParams();
  const { tab } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  if (!isDeliveredAIChannelWorkspaceTab(tab)) throw notFound();

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
      onTabChange={(nextTab) => navigate({ search: { tab: nextTab } })}
      tab={tab}
    />
  );
}
