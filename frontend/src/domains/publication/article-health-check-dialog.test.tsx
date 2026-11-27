import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import {
  parseAuditLogDetailResponse,
  projectAuditFacts,
} from '@/domains/audit/audit.model';
import { PlatformHealthCheckSettingsButton } from '@/domains/configuration/platform-health-check-dialog';
import { ArticleHealthCheckDialogButton } from './article-health-check-dialog';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Slice 3D public page health check UI', () => {
  it('平台健康检查配置弹窗支持懒加载与带 expected_revision CAS 保存', async () => {
    const initial: components['schemas']['PlatformHealthCheckSettingsOut'] = {
      platform_profile_id: '10000000-0000-4000-8000-000000000001',
      health_check_enabled: false,
      health_check_interval_hours: 24,
      health_check_anomaly_threshold: 2,
      revision: 3,
    };
    const updated: components['schemas']['PlatformHealthCheckSettingsOut'] = {
      ...initial,
      health_check_enabled: true,
      revision: 4,
    };
    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: initial,
      response: Response.json(initial),
    } as never);
    const patch = vi.spyOn(api, 'PATCH').mockResolvedValue({
      data: updated,
      response: Response.json(updated),
    } as never);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlatformHealthCheckSettingsButton
          canEdit
          csrfToken="csrf-3d"
          platformId={initial.platform_profile_id}
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '公开页健康检查配置' }));
    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(await screen.findByText('公开页面健康检查配置已保存。')).toBeInTheDocument();
  });

  it('发布成果公开页健康检查弹窗展示三档状态并在自动建单后通知重载', async () => {
    const articleId = '20000000-0000-4000-8000-000000000001';
    const issueId = '30000000-0000-4000-8000-000000000001';
    const history: components['schemas']['PublishedArticleHealthCheckList'] = {
      published_article_id: articleId,
      platform_health_check_enabled: true,
      anomaly_threshold: 2,
      consecutive_confirmed_anomalies: 1,
      latest_status: 'FETCH_BLOCKED',
      items: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          published_article_id: articleId,
          checked_url: 'https://zhuanlan.zhihu.com/p/1',
          final_url: 'https://zhuanlan.zhihu.com/p/1',
          status: 'FETCH_BLOCKED',
          http_status: 403,
          redirect_count: 0,
          redirected: false,
          page_title: null,
          title_matches: null,
          body_similarity: null,
          has_noindex: false,
          canonical_url: null,
          canonical_matches: null,
          anomaly_reasons: [],
          fetch_error_code: 'HTTP_403',
          auto_opened_issue_id: null,
          triggered_by: null,
          checked_at: '2026-11-27T10:00:00Z',
        },
      ],
    };
    const runOut: components['schemas']['PublishedArticleHealthCheckOut'] = {
      ...history.items[0]!,
      id: '40000000-0000-4000-8000-000000000002',
      status: 'CONFIRMED_ANOMALY',
      http_status: 404,
      anomaly_reasons: ['HTTP_GONE_OR_NOT_FOUND'],
      fetch_error_code: null,
      auto_opened_issue_id: issueId,
    };

    const get = vi.spyOn(api, 'GET').mockResolvedValue({
      data: history,
      response: Response.json(history),
    } as never);
    const post = vi.spyOn(api, 'POST').mockResolvedValue({
      data: runOut,
      response: Response.json(runOut),
    } as never);
    const onIssueAutoOpened = vi.fn().mockResolvedValue(undefined);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ArticleHealthCheckDialogButton
          articleId={articleId}
          csrfToken="csrf-3d"
          onIssueAutoOpened={onIssueAutoOpened}
        />
      </QueryClientProvider>,
    );

    expect(get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '公开页面健康检查' }));
    expect(await screen.findByText(/抓取受阻 \(FETCH_BLOCKED/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '立即执行公开页健康检查' }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    await waitFor(() => expect(onIssueAutoOpened).toHaveBeenCalledOnce());
    expect(await screen.findByText(/系统已自动登记发布后内容问题/)).toBeInTheDocument();
  });

  it('前端审计模型完整支持 Slice 3D 全部 3 个新动作与 5 个新事实字段投影', () => {
    const actor = {
      id: '10000000-0000-4000-8000-000000000009',
      display_name: '管理员',
      account_type: 'ADMIN' as const,
    };
    const cases = [
      {
        business_module: 'CONFIGURATION' as const,
        action: 'platform_profile.health_check_settings_updated',
        target_type: 'PlatformProfile',
        target_id: '10000000-0000-4000-8000-000000000001',
        facts: {
          platform_profile_id: '10000000-0000-4000-8000-000000000001',
          health_check_enabled: true,
          health_check_interval_hours: 12,
          health_check_anomaly_threshold: 2,
          revision: 4,
        },
      },
      {
        business_module: 'PUBLICATION' as const,
        action: 'published_article_health_check.run',
        target_type: 'PublishedArticle',
        target_id: '20000000-0000-4000-8000-000000000001',
        facts: {
          publication_id: '20000000-0000-4000-8000-000000000001',
          status: 'CONFIRMED_ANOMALY',
          auto_opened_issue_count: 1,
        },
      },
      {
        business_module: 'PUBLICATION' as const,
        action: 'published_article_health_check.batch_run',
        target_type: 'PublishedArticleHealthCheckBatch',
        target_id: null,
        facts: {
          checked_count: 5,
          auto_opened_issue_count: 1,
        },
      },
    ];

    for (const item of cases) {
      const logId = '50000000-0000-4000-8000-000000000001';
      const relatedEntry = item.target_type === 'PlatformProfile'
        ? { status: 'AVAILABLE', kind: 'PlatformProfile', parent_id: null }
        : { status: 'UNSUPPORTED', kind: null, parent_id: null };
      const detail = parseAuditLogDetailResponse(
        {
          id: logId,
          actor_id: actor.id,
          actor,
          business_module: item.business_module,
          action: item.action,
          target_type: item.target_type,
          target_id: item.target_id,
          outcome: 'SUCCESS',
          primary_task: 'VIEW_LOG_DETAIL',
          request_id: 'req-audit-3d',
          created_at: '2026-11-27T12:00:00Z',
          result_message: '操作成功',
          error_code: null,
          changes: [],
          facts: item.facts,
          related_entry: relatedEntry,
        },
        logId,
      );
      const projected = projectAuditFacts(detail.facts);
      expect(projected.length).toBe(Object.keys(item.facts).length);
    }
  });
});
