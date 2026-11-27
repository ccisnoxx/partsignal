import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { ContentDuplicationDialogButton } from './content-duplication-dialog';

const duplicationData: components['schemas']['ContentDuplicationAnalysisOut'] = {
  content_version_id: '10000000-0000-4000-8000-000000000001',
  content_task_id: '20000000-0000-4000-8000-000000000001',
  campaign_id: '30000000-0000-4000-8000-000000000001',
  product_id: '40000000-0000-4000-8000-000000000001',
  compared_campaign_count: 2,
  compared_product_count: 4,
  same_campaign_max_similarity: 0.72,
  same_product_max_similarity: 0.72,
  similar_contents: [
    {
      content_version_id: '10000000-0000-4000-8000-000000000002',
      content_task_id: '20000000-0000-4000-8000-000000000002',
      task_identifier: 'CT-20000000',
      platform_name: '知乎',
      campaign_id: '30000000-0000-4000-8000-000000000001',
      same_campaign: true,
      title: 'TPS5430 国产替代选型指南',
      status: 'APPROVED',
      similarity: 0.72,
      title_similarity: 0.85,
      shared_paragraph_count: 1,
    },
  ],
  duplicate_titles: [],
  duplicate_paragraphs: [
    {
      target_version_id: '10000000-0000-4000-8000-000000000002',
      target_task_identifier: 'CT-20000000',
      target_platform_name: '知乎',
      target_title: 'TPS5430 国产替代选型指南',
      same_campaign: true,
      source_excerpt: '在工业 24V 电源场景下需要重点核对输入电压裕量。',
      matched_excerpt: '在工业 24V 电源场景下需要重点核对输入电压裕量与封装热阻。',
      similarity: 0.82,
    },
  ],
  differentiation_suggestions: ['建议围绕知乎问答场景改写开头与案例结构。'],
};

const semanticJobList: components['schemas']['SemanticQualityCheckJobList'] = {
  content_version_id: duplicationData.content_version_id,
  items: [],
  available_models: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      display_name: 'GPT-4o Mini',
      model_id: 'gpt-4o-mini',
      channel_id: '80000000-0000-4000-8000-000000000001',
      channel_name: 'OpenAI 渠道',
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('ContentDuplicationDialogButton', () => {
  it('懒加载重复度分析并支持发起带幂等键的 AI 语义质量检查', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation((path) => {
      if (path === '/api/v1/content-versions/{content_version_id}/duplication-analysis') {
        return Promise.resolve({ data: duplicationData, response: Response.json(duplicationData) } as never);
      }
      return Promise.resolve({ data: semanticJobList, response: Response.json(semanticJobList) } as never);
    });
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: {
        id: '90000000-0000-4000-8000-000000000001',
        content_version_id: duplicationData.content_version_id,
        content_task_id: duplicationData.content_task_id,
        content_revision: 1,
        content_hash: 'h'.repeat(64),
        status: 'PENDING',
        ai_model_id: semanticJobList.available_models![0]!.id,
        adapter_name: 'openai-compatible-chat-completions',
        findings: [],
        differentiation_suggestions: [],
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        response_duration_ms: null,
        error_code: null,
        error_summary: null,
        created_by: '99000000-0000-4000-8000-000000000001',
        created_at: '2026-11-27T08:00:00Z',
        started_at: null,
        finished_at: null,
      },
      response: Response.json({}, { status: 202 }),
    } as never);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ContentDuplicationDialogButton
          contentVersionId={duplicationData.content_version_id}
          csrfToken="csrf-3b-token"
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '重复度分析与 AI 深度质检' }));
    expect(await screen.findByText('建议围绕知乎问答场景改写开头与案例结构。')).toBeInTheDocument();
    expect(screen.getByText('TPS5430 国产替代选型指南')).toBeInTheDocument();
    expect(screen.getByText(/当前摘录：在工业 24V 电源场景下/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '发起 AI 语义质量检查' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/content-versions/{content_version_id}/semantic-quality-checks',
      expect.objectContaining({
        body: { ai_model_id: semanticJobList.available_models![0]!.id },
        params: expect.objectContaining({
          header: expect.objectContaining({
            'X-CSRF-Token': 'csrf-3b-token',
            'Idempotency-Key': expect.any(String),
          }),
        }),
      }),
    ));
  });
});
