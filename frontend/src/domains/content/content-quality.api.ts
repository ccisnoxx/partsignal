import { queryOptions } from '@tanstack/react-query';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { ContentRequestError } from './content.api';

type ContentDuplicationAnalysisOut = components['schemas']['ContentDuplicationAnalysisOut'];
type SemanticQualityCheckJobList = components['schemas']['SemanticQualityCheckJobList'];
type SemanticQualityCheckJobOut = components['schemas']['SemanticQualityCheckJobOut'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

const contentQualityKeys = {
  duplication: (contentVersionId: string) =>
    ['content', 'duplication', contentVersionId] as const,
  semanticChecks: (contentVersionId: string) =>
    ['content', 'semantic-quality-checks', contentVersionId] as const,
};

function qualityRequestError(
  action: string,
  result: { error?: unknown; response: Response },
): ContentRequestError {
  const envelope = result.error as ErrorEnvelope | undefined;
  const detail = envelope?.error;
  const message = detail?.message ?? `${action}失败（HTTP ${result.response.status}）`;
  return new ContentRequestError(message, result.response.status, detail);
}

function contentDuplicationQueryOptions(contentVersionId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: contentQualityKeys.duplication(contentVersionId),
    queryFn: async (): Promise<ContentDuplicationAnalysisOut> => {
      const result = await api.GET(
        '/api/v1/content-versions/{content_version_id}/duplication-analysis',
        { params: { path: { content_version_id: contentVersionId } } },
      );
      if (!result.data) throw qualityRequestError('读取内容重复度分析', result);
      return result.data;
    },
    retry: false,
    staleTime: 10_000,
  });
}

function semanticQualityChecksQueryOptions(contentVersionId: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: contentQualityKeys.semanticChecks(contentVersionId),
    queryFn: async (): Promise<SemanticQualityCheckJobList> => {
      const result = await api.GET(
        '/api/v1/content-versions/{content_version_id}/semantic-quality-checks',
        { params: { path: { content_version_id: contentVersionId } } },
      );
      if (!result.data) throw qualityRequestError('读取 AI 语义质量检查记录', result);
      return result.data;
    },
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((job) => job.status === 'PENDING' || job.status === 'RUNNING')
        ? 2_000
        : false;
    },
    retry: false,
    staleTime: 0,
  });
}

async function createSemanticQualityCheck(
  contentVersionId: string,
  aiModelId: string,
  csrfToken: string | null,
  idempotencyKey: string,
): Promise<SemanticQualityCheckJobOut> {
  if (!csrfToken) throw new ContentRequestError('缺少会话 CSRF Token，请刷新后重试', 403);
  const result = await api.POST(
    '/api/v1/content-versions/{content_version_id}/semantic-quality-checks',
    {
      body: { ai_model_id: aiModelId },
      params: {
        path: { content_version_id: contentVersionId },
        header: {
          'X-CSRF-Token': csrfToken,
          'Idempotency-Key': idempotencyKey,
        },
      },
    },
  );
  if (result.data) return result.data;
  throw qualityRequestError('发起 AI 语义质量检查', result);
}

export {
  contentDuplicationQueryOptions,
  contentQualityKeys,
  createSemanticQualityCheck,
  semanticQualityChecksQueryOptions,
};
