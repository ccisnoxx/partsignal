import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { PlatformPromptVersionBindButton } from './platform-prompt-binding-dialog';
import { PromptVersionHistoryButton } from './prompt-version-dialogs';

const versionList: components['schemas']['PlatformPromptVersionList'] = {
  prompt_id: '10000000-0000-4000-8000-000000000001',
  prompt_name: '知乎专栏 Prompt',
  latest_published_version_id: '20000000-0000-4000-8000-000000000002',
  items: [
    {
      id: '20000000-0000-4000-8000-000000000002',
      prompt_id: '10000000-0000-4000-8000-000000000001',
      version: 2,
      status: 'PUBLISHED',
      template_markdown: '# v2 正文',
      template_sha256: 'a'.repeat(64),
      change_summary: '优化问答结构',
      revision: 0,
      published_at: '2026-11-27T08:00:00Z',
      published_by: '30000000-0000-4000-8000-000000000001',
      created_by: '30000000-0000-4000-8000-000000000001',
      created_at: '2026-11-27T08:00:00Z',
      updated_at: '2026-11-27T08:00:00Z',
      bound_platform_count: 1,
      bound_platforms: [{ id: '40000000-0000-4000-8000-000000000001', name: '知乎', slug: 'zhihu' }],
      available_actions: [],
      metrics: {
        generation_job_count: 4,
        succeeded_job_count: 4,
        first_pass_review_total: 4,
        first_pass_approved_count: 3,
        first_pass_approval_rate: 0.75,
        avg_human_revisions: 0.5,
        published_article_count: 3,
        geo_observation_count: 2,
        geo_mention_rate: 1.0,
        geo_citation_rate: 0.5,
      },
    },
  ],
};

const bindingData: components['schemas']['PlatformPromptBindingOut'] = {
  platform_profile_id: '40000000-0000-4000-8000-000000000001',
  platform_revision: 3,
  platform_prompt_id: '10000000-0000-4000-8000-000000000001',
  platform_prompt_name: '知乎专栏 Prompt',
  bound_version: {
    id: '20000000-0000-4000-8000-000000000002',
    prompt_id: '10000000-0000-4000-8000-000000000001',
    prompt_name: '知乎专栏 Prompt',
    version: 2,
    change_summary: '优化问答结构',
    published_at: '2026-11-27T08:00:00Z',
    is_current: true,
  },
  available_versions: [
    {
      id: '20000000-0000-4000-8000-000000000002',
      prompt_id: '10000000-0000-4000-8000-000000000001',
      prompt_name: '知乎专栏 Prompt',
      version: 2,
      change_summary: '优化问答结构',
      published_at: '2026-11-27T08:00:00Z',
      is_current: true,
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('Prompt versioning dialogs', () => {
  it('懒加载版本历史并展示按版本聚合效果指标', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: versionList,
      response: Response.json(versionList),
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PromptVersionHistoryButton
          csrfToken="csrf-3a"
          currentMarkdown="# 当前正文"
          promptId={versionList.prompt_id}
          promptName={versionList.prompt_name}
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '版本历史与效果' }));
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('100% / 50%')).toBeInTheDocument();
    expect(screen.getByText('已绑定 1 个平台')).toBeInTheDocument();
  });

  it('平台绑定弹窗提交 expected_revision 乐观锁切换版本', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: bindingData,
      response: Response.json(bindingData),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: bindingData,
      response: Response.json(bindingData),
    } as never);
    const onBound = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlatformPromptVersionBindButton
          csrfToken="csrf-3a"
          onBound={onBound}
          platformProfileId={bindingData.platform_profile_id}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '切换 / 回滚 Prompt 版本' }));
    expect(await screen.findByText(/当前生效：知乎专栏 Prompt · v2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认绑定版本' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/v1/platform-profiles/{platform_profile_id}/bind-prompt-version',
      expect.objectContaining({
        body: {
          expected_revision: 3,
          platform_prompt_version_id: '20000000-0000-4000-8000-000000000002',
        },
      }),
    ));
    expect(onBound).toHaveBeenCalledOnce();
  });
});
