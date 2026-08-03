/** 锁定配置页面的层级、Prompt 和渠道查询边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import type { Schema } from '../../shared/api/types';
import { AIChannelDetailPage } from './AIChannelDetailPage';
import { AIChannelsPage } from './AIChannelsPage';
import { PlatformPromptsPage } from './PlatformPromptsPage';
import { PlatformsPage } from './PlatformsPage';

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));

vi.mock('../../shared/api/client', () => {
  class ApiError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }
  type ApiResult<T> = { data?: T; error?: { error?: { code?: string; message?: string } }; response: Response };
  const failure = (result: ApiResult<unknown>) => {
    const detail = result.error?.error;
    return new ApiError(detail?.message ?? `请求失败（HTTP ${result.response.status}）`, detail?.code ?? 'HTTP_ERROR');
  };
  return {
    ApiError,
    api: apiMocks,
    csrfHeader: () => ({ 'X-CSRF-Token': 'test' }),
    ensureSuccess: (result: ApiResult<unknown>) => { if (!result.response.ok) throw failure(result); },
    errorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败',
    newIdempotencyKey: () => 'idempotency-test',
    unwrap: <T,>(result: ApiResult<T>) => {
      if (result.data !== undefined) return result.data;
      throw failure(result);
    },
  };
});

const channel = {
  id: 'channel-1', name: '受控模型渠道', description: '生产内容生成渠道', protocol_type: 'openai-compatible-chat-completions' as const, provider_brand: 'OPENAI' as const,
  base_url: 'https://provider.example.invalid/v1', timeout_seconds: 60,
  is_enabled: true, api_key_configured: true, api_key_updated_at: '2026-07-13T08:00:00+08:00', revision: 3,
  latest_test_status: 'PASSED' as const, last_tested_at: '2026-07-13T09:00:00+08:00',
  created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T08:00:00+08:00',
  headers: [
    { id: 'header-1', name: 'X-Public', is_sensitive: false, is_configured: true, available_actions: ['UPDATE', 'DELETE'] as const, value: 'public-value' },
    { id: 'header-2', name: 'X-Secret', is_sensitive: true, is_configured: true, available_actions: ['UPDATE', 'DELETE'] as const, value: null },
  ],
  available_actions: ['UPDATE', 'REPLACE_API_KEY', 'DISABLE', 'DELETE', 'DISCOVER_MODELS', 'CREATE_HEADER', 'CREATE_MODEL'] as const,
  enabled_models: [{ display_name: '内容生成模型', model_id: 'model-controlled' }],
};
const channelSummary = {
  id: channel.id, name: channel.name, description: channel.description, protocol_type: channel.protocol_type,
  provider_brand: channel.provider_brand, base_url: channel.base_url, is_enabled: channel.is_enabled,
  api_key_configured: channel.api_key_configured, header_count: channel.headers.length, enabled_model_count: 1,
  latest_test_status: channel.latest_test_status, last_tested_at: channel.last_tested_at, revision: channel.revision,
  available_actions: channel.available_actions,
};
const otherChannelSummary = {
  ...channelSummary,
  id: 'channel-2',
  name: '备用模型渠道',
  description: '仅用于非当前删除回归',
};
const model = {
  id: 'model-1', channel_id: channel.id, display_name: '内容生成模型', model_id: 'model-controlled', request_parameters: { temperature: 0.2 },
  is_enabled: true, test_status: 'PASSED', last_tested_at: '2026-07-13T09:00:00+08:00', last_test_error_summary: null,
  available_actions: ['UPDATE', 'TEST', 'DISABLE', 'DELETE'] as const,
  revision: 2, created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T09:00:00+08:00',
};
const platformType = { id: 'type-1', name: '技术社区', slug: 'technical-community', available_actions: ['UPDATE'] as const, revision: 0, created_by: 'user-1', created_at: channel.created_at };
const platformPrompt = {
  id: 'prompt-shared',
  name: '技术文章 Prompt',
  template_markdown: '仅使用已批准事实。',
  revision: 1,
  updated_by: 'user-1',
  created_at: channel.created_at,
  updated_at: channel.updated_at,
  bound_platform_count: 1,
  available_actions: ['UPDATE'] as const,
  bound_platforms: [{ id: 'profile-ready', name: '工程师社区', slug: 'engineer-community' }],
};
const unusedPlatformPrompt = {
  ...platformPrompt,
  id: 'prompt-unused',
  name: '未绑定 Prompt',
  template_markdown: '待使用。',
  bound_platform_count: 0,
  available_actions: ['UPDATE', 'DELETE'] as const,
  bound_platforms: [],
};
const platforms = [
  { id: 'profile-empty', name: '待配置平台', slug: 'pending-platform', allowed_domains: ['pending.example.invalid'], platform_type_id: platformType.id, platform_type: { id: platformType.id, name: platformType.name, slug: platformType.slug }, website_url: null, logo: null, revision: 0, is_active: false, platform_prompt: null, configuration_complete: false, platform_account_count: 0, available_actions: ['UPDATE', 'ENABLE', 'DELETE'] as const, updated_at: null },
  { id: 'profile-ready', name: '工程师社区', slug: 'engineer-community', allowed_domains: ['community.example.invalid'], platform_type_id: platformType.id, platform_type: { id: platformType.id, name: platformType.name, slug: platformType.slug }, website_url: 'https://community.example.invalid/', logo: { source: 'EXTERNAL' as const, url: 'https://cdn.example.invalid/community.png' }, revision: 1, is_active: true, platform_prompt: { id: platformPrompt.id, name: platformPrompt.name, revision: platformPrompt.revision, updated_at: platformPrompt.updated_at }, configuration_complete: true, platform_account_count: 2, available_actions: ['UPDATE', 'DISABLE'] as const, updated_at: channel.updated_at },
];
const humanizationPrompt = { template_markdown: '保持事实，只改善表达。', available_actions: ['UPDATE'] as const, revision: 1, updated_by: 'user-1', created_at: channel.created_at, updated_at: channel.updated_at };
let channelItems = [channelSummary];
let platformItems = platforms;
let promptItems = [platformPrompt, unusedPlatformPrompt];
let generationJobs: Schema<'GenerationJob'>[] = [];

const previewTask: Schema<'ContentTaskListItem'> = {
  id: 'task-preview', product_id: 'product-1', fact_version_id: 'fact-1', platform_profile_id: 'profile-ready',
  query_topic_id: null,
  source_published_content_issue_id: null, available_actions: ['CANCEL'], status: 'OPEN', revision: 1, created_by: 'user-1', created_at: channel.created_at,
  product: { id: 'product-1', brand: 'PartSignal', part_number: 'PS-100' }, platform: { id: 'profile-ready', name: '工程师社区', website_url: platforms[1]!.website_url, logo: platforms[1]!.logo }, latest_generation_status: null,
};
const previewSource: Schema<'ContentVersion'> = { id: 'version-source', task_id: previewTask.id, fact_version_id: 'fact-1', source_job_id: 'job-source', based_on_id: null, version: 1, source_type: 'AI', title: '源草稿', summary: '源摘要', body_markdown: '源正文', tags: ['源'], content_hash: 'hash-source', status: 'DRAFT', available_actions: [], revision: 0, quality_issues: [], created_by: 'user-1', created_at: channel.created_at };
const previewContent: Schema<'ContentVersion'> = { ...previewSource, id: 'version-preview', source_job_id: 'job-preview', based_on_id: previewSource.id, version: 2, title: '真实预览标题', summary: '真实预览摘要', body_markdown: '[危险链接](javascript:alert(1))\n\n<script>globalThis.compromised=true</script>\n\n安全正文', tags: ['真实', '草稿'], content_hash: 'hash-preview' };

function result(data: unknown) {
  return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
}

function renderWithQuery(ui: ReactNode, initialEntries: string[]) {
  return render(<ThemeProvider><AntApp><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider></AntApp></ThemeProvider>);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

let dialogTitleSequence = 0;

async function findRcDialog(name: string | RegExp) {
  const dialog = await screen.findByRole('dialog');
  const title = dialog.querySelector<HTMLElement>('.ant-modal-title');
  if (!title) throw new Error('弹窗标题未渲染');
  title.id = `rc-dialog-title-${dialogTitleSequence += 1}`;
  dialog.setAttribute('aria-labelledby', title.id);
  expect(dialog).toHaveAccessibleName(name);
  return dialog;
}

beforeEach(() => {
  queryClient.clear();
  channelItems = [channelSummary];
  platformItems = platforms;
  promptItems = [platformPrompt, unusedPlatformPrompt];
  generationJobs = [];
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string, options?: { params?: { path?: Record<string, string> } }) => {
    if (path === '/api/v1/ai-channels') return result({
      items: channelItems,
      page: 1,
      page_size: 20,
      total: channelItems.length,
      counts: {
        all: channelItems.length,
        enabled: channelItems.filter((item) => item.is_enabled).length,
        disabled: channelItems.filter((item) => !item.is_enabled).length,
      },
    });
    if (path === '/api/v1/ai-channels/{channel_id}') {
      const item = channelItems.find((candidate) => candidate.id === options?.params?.path?.channel_id);
      if (!item) return Promise.resolve({ error: { error: { code: 'NOT_FOUND', message: '渠道不存在' } }, response: new Response(null, { status: 404 }) });
      return result(item.id === channel.id ? channel : { ...channel, ...item });
    }
    if (path === '/api/v1/ai-channels/{channel_id}/models') {
      const item = channelItems.find((candidate) => candidate.id === options?.params?.path?.channel_id);
      if (!item) return Promise.resolve({ error: { error: { code: 'NOT_FOUND', message: '渠道不存在' } }, response: new Response(null, { status: 404 }) });
      return result({ items: item.id === channel.id ? [model] : [] });
    }
    if (path === '/api/v1/ai-channels/{channel_id}/usage-summary') return result({ channel_id: channel.id, period: '30d', period_started_at: '2026-06-13T08:00:00+08:00', period_ended_at: '2026-07-13T08:00:00+08:00', total_jobs: 3, succeeded_jobs: 2, failed_jobs: 1, success_rate: 2 / 3, average_response_duration_ms: 1200, prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, last_used_at: '2026-07-13T07:00:00+08:00' });
    if (path === '/api/v1/ai-channels/{channel_id}/audit-logs') return result({ items: [{ id: 'audit-1', actor_id: 'user-1', actor: { id: 'user-1', display_name: '系统管理员', account_type: 'ADMIN' }, business_module: 'CONFIGURATION', action: 'ai_model.tested', target_type: 'AIModel', target_id: model.id, outcome: 'SUCCESS', change_summary: { test_status: 'PASSED' }, request_id: 'request-1', created_at: channel.updated_at }], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/users') return result({ items: [{ id: 'user-1', username: 'admin', display_name: '系统管理员', account_type: 'ADMIN', is_active: true, must_change_password: false, available_actions: ['UPDATE', 'DISABLE'], revision: 0, created_at: channel.created_at }], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/platform-profiles') {
      return result({ items: platformItems, page: 1, page_size: 10, total: platformItems.length, summary: { platform_total: platformItems.length, enabled_total: platformItems.filter((item) => item.is_active).length, missing_prompt_total: platformItems.filter((item) => !item.platform_prompt).length, configuration_complete_total: platformItems.filter((item) => item.configuration_complete).length } });
    }
    if (path === '/api/v1/audit-logs') return result({ items: [{ id: 'audit-rule-1', actor_id: 'user-1', actor: { id: 'user-1', display_name: '系统管理员', account_type: 'ADMIN' }, business_module: 'CONFIGURATION', action: 'platform_profile_version.created', target_type: 'PlatformProfileVersion', target_id: options?.params?.path?.platform_profile_version_id ?? 'version-1', outcome: 'SUCCESS', change_summary: {}, request_id: 'request-rule-1', created_at: channel.created_at }], page: 1, page_size: 100, total: 1 });
    if (path === '/api/v1/platform-types') return result({ items: [platformType] });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}') {
      const profile = platformItems.find((item) => item.id === options?.params?.path?.platform_profile_id);
      if (!profile) return Promise.resolve({ error: { error: { code: 'NOT_FOUND', message: '平台不存在' } }, response: new Response(null, { status: 404 }) });
      return result({ profile, account_summary: { total: profile.platform_account_count, enabled: 1, disabled: Math.max(0, profile.platform_account_count - 1) }, reference_summary: { as_of: channel.updated_at, recent_30_days: 3, all_time: 8 } });
    }
    if (path === '/api/v1/platform-profiles/export') return Promise.resolve({ data: '平台名称\n工程师社区', response: new Response(null, { status: 200, headers: { 'Content-Disposition': 'attachment; filename="platform-profiles.csv"' } }) });
    if (path === '/api/v1/platform-prompts') {
      return result({ items: promptItems.map((item) => ({
        id: item.id,
        name: item.name,
        revision: item.revision,
        updated_by: item.updated_by,
        updated_at: item.updated_at,
        bound_platform_count: item.bound_platform_count,
      })) });
    }
    if (path === '/api/v1/platform-prompts/{platform_prompt_id}') {
      const item = promptItems.find((candidate) => candidate.id === options?.params?.path?.platform_prompt_id);
      if (!item) return Promise.resolve({ error: { error: { code: 'NOT_FOUND', message: 'Prompt 不存在' } }, response: new Response(null, { status: 404 }) });
      return result(item);
    }
    if (path === '/api/v1/content-humanization-prompt') return result(humanizationPrompt);
    if (path === '/api/v1/content-tasks') return result({ items: [previewTask] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-options') return result({ platform_profile_id: 'profile-ready', platform_profile_name: '工程师社区', platform_prompt: { id: platformPrompt.id, name: platformPrompt.name, revision: platformPrompt.revision, template_markdown: platformPrompt.template_markdown }, humanization_prompt_configured: true, models: [{ id: model.id, channel_id: channel.id, channel_name: channel.name, display_name: model.display_name, model_id: model.model_id }] });
    if (path === '/api/v1/content-tasks/{content_task_id}/content-versions') return result({ items: [previewSource] });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') return result({ items: generationJobs });
    if (path === '/api/v1/content-versions/{content_version_id}') return result(previewContent);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels/{channel_id}/disable') return result({ ...channel, is_enabled: false, revision: channel.revision + 1 });
    if (path === '/api/v1/ai-channels/{channel_id}/discover-models') return result({ items: [{ model_id: 'model-controlled' }, { model_id: 'model-new' }] });
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ ...model, id: 'model-2', display_name: 'model-new', model_id: 'model-new' });
    if (path === '/api/v1/ai-models/{model_id}/disable') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    if (path === '/api/v1/ai-models/{model_id}/test') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    if (path === '/api/v1/platform-profiles') return result({ ...platforms[0], id: 'profile-new' });
    if (path === '/api/v1/platform-prompts') return result({ ...unusedPlatformPrompt, id: 'prompt-new', name: '新平台 Prompt', template_markdown: '新平台 Prompt。' });
    if (path === '/api/v1/platform-logo-candidates') return result({
      file_id: '00000000-0000-4000-8000-000000000029',
      preview: { url: 'https://objects.example.invalid/platform-logo.png', expires_at: channel.updated_at },
    });
    if (path === '/api/v1/content-tasks/{content_task_id}/generation-jobs') {
      const job: Schema<'GenerationJob'> = { id: 'job-preview', content_task_id: previewTask.id, job_type: 'GENERATE', source_content_version_id: null, status: 'PENDING', available_actions: [], attempt_count: 1, content_version_id: null, created_at: channel.created_at };
      generationJobs = [{ ...job, status: 'SUCCEEDED', content_version_id: previewContent.id }];
      return result(job);
    }
    if (path === '/api/v1/content-versions/{content_version_id}/humanization-jobs') {
      const job: Schema<'GenerationJob'> = { id: 'job-humanize', content_task_id: previewTask.id, job_type: 'HUMANIZE', source_content_version_id: previewSource.id, status: 'PENDING', available_actions: [], attempt_count: 1, content_version_id: null, created_at: channel.created_at };
      generationJobs = [{ ...job, status: 'SUCCEEDED', content_version_id: previewContent.id }];
      return result(job);
    }
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PATCH.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}') return result({ ...platforms[1], revision: 2 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PUT.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-prompts/{platform_prompt_id}') {
      return result({ ...platformPrompt, revision: 2 });
    }
    if (path === '/api/v1/content-humanization-prompt') return result({ ...humanizationPrompt, revision: 2 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.DELETE.mockImplementation((path: string, options?: { params?: { path?: Record<string, string> } }) => {
    if (path === '/api/v1/ai-channels/{channel_id}') {
      channelItems = channelItems.filter((item) => item.id !== options?.params?.path?.channel_id);
    }
    if (path === '/api/v1/platform-prompts/{platform_prompt_id}') {
      promptItems = promptItems.filter((item) => item.id !== options?.params?.path?.platform_prompt_id);
    }
    return Promise.resolve({ response: new Response(null, { status: 204 }) });
  });
});

test('平台列表明确展示 Prompt 配置状态', async () => {
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  expect(await screen.findByRole('heading', { name: '平台管理' })).toBeInTheDocument();
  expect(await within(screen.getByRole('region', { name: '平台列表' })).findByText('缺少 Prompt')).toHaveClass('status-tag-warning');
  const metrics = screen.getByRole('region', { name: '平台实时统计' });
  expect(metrics.querySelectorAll('.metric-tile')).toHaveLength(4);
  expect(within(metrics).queryByText('暂无历史基线')).not.toBeInTheDocument();
  const filters = screen.getByRole('search', { name: '平台筛选' });
  expect(within(filters).getByText('关键词')).toBeInTheDocument();
  expect(within(filters).getByText('启用状态')).toBeInTheDocument();
  const row = screen.getByText('工程师社区').closest('tr');
  const logo = row?.querySelector<HTMLElement>('.platform-avatar');
  expect(logo).toHaveStyle({ width: '24px', height: '24px' });
  fireEvent.click(within(row!).getByText('工程师社区'));
  expect(screen.queryByRole('heading', { name: '平台详情' })).not.toBeInTheDocument();
});

test('平台删除确认说明配置范围、保留对象和引用阻断', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  await user.click(await screen.findByRole('button', { name: '更多操作：待配置平台' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除平台' }));
  const dialog = await findRcDialog('删除平台“待配置平台”？');
  expect(within(dialog).getByText('将删除平台配置；Prompt 模板不会随之删除。存在内容任务或平台账号引用时服务端会拒绝，既有历史不会被改写。此操作不可恢复。')).toBeInTheDocument();
  expect(within(dialog).queryByText(/物理删除/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
});

test('平台管理从 URL 请求服务端筛选并恢复聚合详情', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:platforms') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms?q=工程&status=ENABLED&configuration_status=COMPLETE&page_size=10&platform=profile-ready']);
  expect(await screen.findByRole('heading', { name: '平台详情' })).toHaveFocus();
  expect(screen.getByRole('link', { name: /查看引用分析/ })).toHaveAttribute('href', '/tasks?platform_profile_id=profile-ready');
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledWith('/api/v1/platform-profiles', expect.objectContaining({ params: { query: expect.objectContaining({ q: '工程', status: 'ENABLED', configuration_status: 'COMPLETE', page: 1, page_size: 10 }) } })));
  await userEvent.click(screen.getByRole('button', { name: /导出列表/ }));
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledWith('/api/v1/platform-profiles/export', expect.objectContaining({ params: { query: { q: '工程', status: 'ENABLED', configuration_status: 'COMPLETE' } } })));
});


test('新增平台品牌字段可选且不包含规则字段', async () => {
  const payload = { name: '新平台', slug: 'new-platform', platform_type_id: platformType.id, platform_prompt_id: null, allowed_domains: ['new.example.invalid'], website_url: null, logo: null } satisfies Schema<'PlatformProfileCreate'>;
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  await screen.findByText('待配置平台');
  expect(screen.getByRole('button', { name: /新增平台$/ })).toBeInTheDocument();
  expect(payload).not.toHaveProperty('rules');
  expect(screen.queryByLabelText('目标受众')).not.toBeInTheDocument();
});

test('旧外链 Logo 保持只读，官网候选经确认后才随平台保存', async () => {
  const invalidations = vi.spyOn(queryClient, 'invalidateQueries');
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('button', { name: '更多操作：工程师社区' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑平台' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(within(dialog!).getByText('旧外链 Logo（只读）')).toBeInTheDocument();
  const website = within(dialog!).getByRole('textbox', { name: '官方网站' });
  fireEvent.change(website, { target: { value: 'https://new.example.invalid/platform' } });
  fireEvent.click(within(dialog!).getByRole('button', { name: /从官网发现 Logo/ }));
  expect(await within(dialog!).findByRole('img', { name: '官网 Logo 候选' })).toHaveAttribute('src', 'https://objects.example.invalid/platform-logo.png');
  fireEvent.change(website, { target: { value: 'https://final.example.invalid/platform' } });
  expect(within(dialog!).queryByRole('img', { name: '官网 Logo 候选' })).not.toBeInTheDocument();
  expect(apiMocks.PATCH).not.toHaveBeenCalled();
  fireEvent.click(within(dialog!).getByRole('button', { name: /从官网发现 Logo/ }));
  await within(dialog!).findByRole('img', { name: '官网 Logo 候选' });
  fireEvent.click(within(dialog!).getByRole('button', { name: '使用此 Logo' }));
  fireEvent.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/platform-logo-candidates',
    expect.objectContaining({ body: { website_url: 'https://final.example.invalid/platform' } }),
  ));
  await waitFor(() => expect(apiMocks.PATCH).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_id: 'profile-ready' } }),
      body: expect.objectContaining({
        expected_revision: 1,
        website_url: 'https://final.example.invalid/platform',
        logo: { source: 'UPLOAD', file_id: '00000000-0000-4000-8000-000000000029' },
      }),
    }),
  ));
  await waitFor(() => {
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['platform-profiles'] });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['platform-profile', 'profile-ready'] });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['content-tasks'] });
  });
  invalidations.mockRestore();
});

test('旧外链平台未操作 Logo 时 PATCH 省略该字段', async () => {
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  fireEvent.click(within(row!).getByRole('button', { name: '更多操作：工程师社区' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑平台' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  fireEvent.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  await waitFor(() => expect(apiMocks.PATCH).toHaveBeenCalled());
  const options = apiMocks.PATCH.mock.calls[0]?.[1] as { body: Record<string, unknown> };
  expect(options.body).not.toHaveProperty('logo');
  expect(options.body.expected_revision).toBe(1);
});

test('编辑平台可显式清空官网和 Logo', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  fireEvent.click(within(row!).getByRole('button', { name: '更多操作：工程师社区' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑平台' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  fireEvent.change(within(dialog!).getByRole('textbox', { name: '官方网站' }), { target: { value: '' } });
  await user.click(within(dialog!).getByRole('combobox', { name: /Logo 操作/ }));
  await user.click(await screen.findByText('清空 Logo'));
  fireEvent.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  await waitFor(() => expect(apiMocks.PATCH).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}',
    expect.objectContaining({ body: expect.objectContaining({ website_url: null, logo: null }) }),
  ));
});

test('平台保存失败时保留可感知的服务端反馈', async () => {
  const user = userEvent.setup();
  apiMocks.PATCH.mockResolvedValueOnce({ response: new Response(null, { status: 503 }) });
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  fireEvent.click(within(row!).getByRole('button', { name: '更多操作：工程师社区' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '编辑平台' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  await user.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  expect(await screen.findByText('请求失败（HTTP 503）')).toBeInTheDocument();
});


test('Prompt 工作台允许创建可复用模板', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts?tab=platform&new=1']);
  const name = await screen.findByRole('textbox', { name: 'Prompt 名称' });
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  expect(editor).toHaveValue('');
  await user.type(name, '新平台 Prompt');
  await user.type(editor, '新平台 Prompt。');
  await user.click(screen.getByRole('button', { name: /首次保存$/ }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/platform-prompts',
    expect.objectContaining({
      body: { name: '新平台 Prompt', template_markdown: '新平台 Prompt。' },
    }),
  ));
});

test('共享 Prompt 按 revision 保存、展示影响范围并保护本地草稿', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, [`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}`]);
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  expect(editor).toHaveValue('仅使用已批准事实。');
  const bindingSummary = screen.getByRole('region', { name: 'Prompt 使用平台' });
  expect(within(bindingSummary).getByText('使用平台')).toBeInTheDocument();
  expect(within(bindingSummary).getByText('1 个')).toBeInTheDocument();
  expect(within(bindingSummary).getByText('工程师社区')).toBeInTheDocument();
  expect(bindingSummary.querySelector('.ant-alert-icon')).not.toBeInTheDocument();
  await user.clear(editor);
  await user.type(editor, '更新后的平台 Prompt。');
  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('tab', { name: '全局自然化 Prompt' }));
  const dialog = await findRcDialog('放弃未保存的 Prompt 修改？');
  await user.click(within(dialog).getByRole('button', { name: '继续编辑' }));
  expect(editor).toHaveValue('更新后的平台 Prompt。');
  await user.click(screen.getByRole('button', { name: /保存 Prompt$/ }));
  const impactDialog = await findRcDialog('更新将影响 1 个平台');
  await user.click(within(impactDialog).getByRole('button', { name: '确认更新' }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/platform-prompts/{platform_prompt_id}',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_prompt_id: platformPrompt.id } }),
      body: { name: platformPrompt.name, template_markdown: '更新后的平台 Prompt。', expected_revision: 1 },
    }),
  ));
  expect(await screen.findByText('已保存')).toBeInTheDocument();
});

test('Prompt 草稿只确认一次后完成站内导航', async () => {
  const user = userEvent.setup();
  renderWithQuery(<Routes>
    <Route path="/configuration/prompts" element={<><a href="/products">离开配置</a><PlatformPromptsPage /></>} />
    <Route path="/products" element={<h1>产品事实</h1>} />
  </Routes>, [`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}`]);
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  await user.type(editor, '未保存');
  await user.click(screen.getByRole('link', { name: '离开配置' }));
  const dialog = await findRcDialog('放弃未保存的 Prompt 修改？');
  expect(dialog).toHaveTextContent('确认后将离开当前页面');
  await user.click(within(dialog).getByRole('button', { name: '放弃并离开' }));
  expect(await screen.findByRole('heading', { name: '产品事实' })).toBeInTheDocument();
  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(false);
});

test('确认放弃草稿后再次返回模板不会恢复已丢弃内容', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, [`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}`]);
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  await user.clear(editor);
  await user.type(editor, '应被丢弃的本地草稿。');
  await user.click(screen.getByRole('tab', { name: '全局自然化 Prompt' }));
  const dialog = await findRcDialog('放弃未保存的 Prompt 修改？');
  await user.click(within(dialog).getByRole('button', { name: '放弃修改' }));
  expect(await screen.findByRole('textbox', { name: '自然化 Prompt Markdown' })).toHaveValue('保持事实，只改善表达。');
  await user.click(screen.getByRole('tab', { name: '平台 Prompt' }));
  expect(await screen.findByRole('textbox', { name: 'Prompt Markdown' })).not.toHaveValue('应被丢弃的本地草稿。');
});

test('平台 Prompt revision 冲突保留本地草稿并提供显式重载', async () => {
  const user = userEvent.setup();
  apiMocks.PUT.mockResolvedValueOnce({
    error: { error: { code: 'REVISION_CONFLICT', message: '平台 Prompt 已被其他请求修改' } },
    response: new Response(null, { status: 409 }),
  });
  renderWithQuery(<PlatformPromptsPage />, [`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}`]);
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  await user.clear(editor);
  await user.type(editor, '必须保留的本地草稿。');
  await user.click(screen.getByRole('button', { name: /保存 Prompt$/ }));
  const impactDialog = await findRcDialog('更新将影响 1 个平台');
  await user.click(within(impactDialog).getByRole('button', { name: '确认更新' }));
  expect(await screen.findByText('服务端 Prompt 已发生变化，本地草稿未被覆盖。')).toBeInTheDocument();
  expect(editor).toHaveValue('必须保留的本地草稿。');
  expect(screen.getByRole('button', { name: '重新加载当前值' })).toBeInTheDocument();
});

test('管理员按 revision 保存全局自然化 Prompt 且没有删除入口', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts?tab=humanization&page=1&page_size=10']);
  const editor = await screen.findByRole('textbox', { name: '自然化 Prompt Markdown' });
  expect(editor).toHaveValue('保持事实，只改善表达。');
  expect(screen.queryByRole('button', { name: /删除 Prompt$/ })).not.toBeInTheDocument();
  await user.clear(editor);
  await user.type(editor, '保留批准事实，重写机械表达。');
  await user.click(screen.getByRole('button', { name: /保存 Prompt$/ }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/content-humanization-prompt',
    expect.objectContaining({
      body: { template_markdown: '保留批准事实，重写机械表达。', expected_revision: 1 },
    }),
  ));
});

test('全局自然化 Prompt 未配置时以 204 保留空编辑器和首次保存语义', async () => {
  const user = userEvent.setup();
  const get = apiMocks.GET.getMockImplementation()!;
  apiMocks.GET.mockImplementation((path: string, options?: unknown) => (
    path === '/api/v1/content-humanization-prompt'
      ? Promise.resolve({ response: new Response(null, { status: 204 }) })
      : get(path, options)
  ));
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts?tab=humanization&page=1&page_size=10']);
  const editor = await screen.findByRole('textbox', { name: '自然化 Prompt Markdown' });
  expect(editor).toHaveValue('');
  expect(screen.getByText('尚未配置 Prompt；首次保存后才可用于新生成作业。')).toBeInTheDocument();
  await user.type(editor, '首次配置自然化 Prompt。');
  await user.click(screen.getByRole('button', { name: /首次保存$/ }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/content-humanization-prompt',
    expect.objectContaining({
      body: { template_markdown: '首次配置自然化 Prompt。', expected_revision: null },
    }),
  ));
});

test('全局自然化 Prompt 的真实读取错误仍进入失败反馈', async () => {
  const get = apiMocks.GET.getMockImplementation()!;
  apiMocks.GET.mockImplementation((path: string, options?: unknown) => (
    path === '/api/v1/content-humanization-prompt'
      ? Promise.resolve({
        error: { error: { code: 'HUMANIZATION_PROMPT_UNAVAILABLE', message: '自然化 Prompt 服务暂不可用' } },
        response: new Response(null, { status: 503 }),
      })
      : get(path, options)
  ));
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts?tab=humanization&page=1&page_size=10']);
  expect(await screen.findByText('自然化 Prompt 服务暂不可用')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '自然化 Prompt Markdown' })).not.toBeInTheDocument();
});

test('Strict Mode 下删除当前 Prompt 后刷新列表且不重取已删除详情', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <StrictMode><><LocationProbe /><PlatformPromptsPage /></></StrictMode>,
    [`/configuration/prompts?tab=platform&platform_prompt_id=${unusedPlatformPrompt.id}`],
  );
  await screen.findByDisplayValue('待使用。');
  const removedDetailGets = () => apiMocks.GET.mock.calls.filter(([path, options]) => (
    path === '/api/v1/platform-prompts/{platform_prompt_id}'
    && options?.params?.path?.platform_prompt_id === unusedPlatformPrompt.id
  )).length;
  const detailGetsBeforeDelete = removedDetailGets();
  const bindingSummary = screen.getByRole('region', { name: 'Prompt 使用平台' });
  expect(within(bindingSummary).getByText('暂未绑定')).toBeInTheDocument();
  expect(within(bindingSummary).getByText('可直接删除此 Prompt。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /删除 Prompt$/ }));
  await screen.findByText('删除当前 Prompt？');
  await user.click(screen.getAllByRole('button', { name: /删除 Prompt$/ }).at(-1)!);
  await waitFor(() => expect(apiMocks.DELETE).toHaveBeenCalledWith(
    '/api/v1/platform-prompts/{platform_prompt_id}',
    expect.objectContaining({ params: expect.objectContaining({ path: { platform_prompt_id: unusedPlatformPrompt.id }, query: { expected_revision: 1 } }) }),
  ));
  await waitFor(() => {
    expect(screen.queryByText(unusedPlatformPrompt.name)).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`platform_prompt_id=${platformPrompt.id}`);
  });
  expect(await screen.findByDisplayValue(platformPrompt.template_markdown)).toBeInTheDocument();
  expect(apiMocks.DELETE).toHaveBeenCalledTimes(1);
  expect(removedDetailGets()).toBe(detailGetsBeforeDelete);
  expect(screen.queryByText('Prompt 不存在')).not.toBeInTheDocument();
});

test('Prompt 删除失败时保留当前选中项并显示原始错误', async () => {
  const user = userEvent.setup();
  apiMocks.DELETE.mockResolvedValueOnce({
    error: { error: { code: 'PROMPT_IN_USE', message: 'Prompt 仍被平台引用' } },
    response: new Response(null, { status: 409 }),
  });
  renderWithQuery(
    <><LocationProbe /><PlatformPromptsPage /></>,
    [`/configuration/prompts?tab=platform&platform_prompt_id=${unusedPlatformPrompt.id}`],
  );
  expect(await screen.findByDisplayValue(unusedPlatformPrompt.template_markdown)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /删除 Prompt$/ }));
  await user.click(screen.getAllByRole('button', { name: /删除 Prompt$/ }).at(-1)!);
  expect(await screen.findAllByText('Prompt 仍被平台引用')).not.toHaveLength(0);
  expect(screen.getByTestId('location')).toHaveTextContent(`platform_prompt_id=${unusedPlatformPrompt.id}`);
  expect(screen.getByDisplayValue(unusedPlatformPrompt.template_markdown)).toBeInTheDocument();
  expect(apiMocks.DELETE).toHaveBeenCalledTimes(1);
});

test('直接访问不存在的 Prompt 仍展示 NOT_FOUND', async () => {
  renderWithQuery(
    <PlatformPromptsPage />,
    ['/configuration/prompts?tab=platform&platform_prompt_id=prompt-missing'],
  );
  expect(await screen.findByText('Prompt 不存在')).toBeInTheDocument();
  expect(apiMocks.GET).toHaveBeenCalledWith(
    '/api/v1/platform-prompts/{platform_prompt_id}',
    expect.objectContaining({ params: { path: { platform_prompt_id: 'prompt-missing' } } }),
  );
});

test('平台输出预览创建真实作业、读取草稿并安全渲染 Markdown', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, [`/configuration/prompts?tab=platform&platform_prompt_id=${platformPrompt.id}`]);
  await screen.findByDisplayValue('仅使用已批准事实。');
  await user.click(screen.getByRole('combobox', { name: '预览内容任务' }));
  await user.click(await screen.findByTitle(/PartSignal PS-100/));
  await user.click(screen.getByRole('combobox', { name: '预览模型' }));
  await user.click(await screen.findByTitle(/内容生成模型/));
  await user.click(screen.getByRole('button', { name: /生成平台预览$/ }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-tasks/{content_task_id}/generation-jobs',
    expect.objectContaining({
      params: expect.objectContaining({ path: { content_task_id: previewTask.id }, header: expect.objectContaining({ 'Idempotency-Key': 'idempotency-test' }) }),
      body: {
        ai_model_id: model.id,
        platform_prompt_id: platformPrompt.id,
        platform_prompt_revision: platformPrompt.revision,
      },
    }),
  ));
  expect(await screen.findByText('真实预览标题')).toBeInTheDocument();
  const unsafeLink = screen.getByText('危险链接').closest('a');
  expect(unsafeLink).not.toHaveAttribute('href');
  expect(document.querySelector('.prompt-preview-article script')).toBeNull();
  expect(apiMocks.GET).not.toHaveBeenCalledWith('/api/v1/generation-jobs/{generation_job_id}', expect.anything());
});

test('自然化预览显式选择真实源草稿并创建 HUMANIZE 作业', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts?tab=humanization&page=1&page_size=10']);
  await screen.findByDisplayValue('保持事实，只改善表达。');
  await user.click(screen.getByRole('combobox', { name: '预览内容任务' }));
  await user.click(await screen.findByTitle(/PartSignal PS-100/));
  await user.click(screen.getByRole('combobox', { name: '自然化源草稿' }));
  await user.click(await screen.findByTitle(/V1 · 源草稿/));
  await user.click(screen.getByRole('combobox', { name: '预览模型' }));
  await user.click(await screen.findByTitle(/内容生成模型/));
  await user.click(screen.getByRole('button', { name: /生成自然化预览$/ }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/content-versions/{content_version_id}/humanization-jobs',
    expect.objectContaining({
      params: expect.objectContaining({ path: { content_version_id: previewSource.id }, header: expect.objectContaining({ 'Idempotency-Key': 'idempotency-test' }) }),
      body: { ai_model_id: model.id },
    }),
  ));
  expect(await screen.findByText('真实预览标题')).toBeInTheDocument();
});

test('渠道工作区从 URL 恢复服务端筛选分页并自动选择首条渠道', async () => {
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai?status=enabled&provider_brand=OPENAI&sort=NAME_ASC&page_size=10&q=生产'],
  );
  expect(await screen.findByRole('heading', { name: 'AI 渠道与模型' })).toBeInTheDocument();
  expect(await screen.findByText('受控模型渠道')).toBeInTheDocument();
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledWith(
    '/api/v1/ai-channels',
    expect.objectContaining({ params: { query: expect.objectContaining({ q: '生产', status: 'ENABLED', provider_brand: 'OPENAI', sort: 'NAME_ASC', page_size: 10 }) } }),
  ));
  expect(await screen.findByText('生产内容生成渠道')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '全部渠道1' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Header 数量' })).toBeInTheDocument();
  const channelTable = screen.getByRole('region', { name: 'AI 渠道列表' });
  expect(channelTable.querySelector('.status-tag-compact')).not.toBeNull();
  expect(within(channelTable).getByRole('button', { name: '配置：受控模型渠道' })).toBeInTheDocument();
  expect(within(channelTable).queryByRole('link', { name: /受控模型渠道/ })).not.toBeInTheDocument();
});

test('Strict Mode 下从详情删除当前渠道只发一次 DELETE 且不重取详情', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <StrictMode><><LocationProbe /><Routes>
      <Route path="/configuration/ai" element={<AIChannelsPage />}>
        <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
      </Route>
    </Routes></></StrictMode>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByRole('heading', { name: channel.name });
  const detailGets = () => apiMocks.GET.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}').length;
  const modelGets = () => apiMocks.GET.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}/models').length;
  const detailGetsBeforeDelete = detailGets();
  const modelGetsBeforeDelete = modelGets();
  await user.click(screen.getByRole('button', { name: /删除渠道$/ }));
  await screen.findByText('删除此 AI 渠道？');
  await user.click(screen.getAllByRole('button', { name: /删除渠道$/ }).at(-1)!);
  await waitFor(() => {
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/configuration\/ai$/);
    expect(screen.queryByText(channel.name)).not.toBeInTheDocument();
  });
  expect(apiMocks.DELETE.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}')).toHaveLength(1);
  expect(detailGets()).toBe(detailGetsBeforeDelete);
  expect(modelGets()).toBe(modelGetsBeforeDelete);
  expect(apiMocks.GET.mock.calls.filter(([path]) => path === '/api/v1/ai-channels').length).toBeGreaterThan(1);
});

test('从列表删除当前渠道同样先退出详情且不重取已删除资源', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <><LocationProbe /><Routes>
      <Route path="/configuration/ai" element={<AIChannelsPage />}>
        <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
      </Route>
    </Routes></>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByRole('heading', { name: channel.name });
  const detailGetsBeforeDelete = apiMocks.GET.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}').length;
  await user.click(screen.getByRole('button', { name: `更多操作：${channel.name}` }));
  await user.click(await screen.findByRole('menuitem', { name: '删除渠道' }));
  const dialog = await findRcDialog(`删除渠道“${channel.name}”？`);
  await user.click(within(dialog).getByRole('button', { name: '删除渠道' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/configuration\/ai$/));
  expect(apiMocks.DELETE.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}')).toHaveLength(1);
  expect(apiMocks.GET.mock.calls.filter(([path]) => path === '/api/v1/ai-channels/{channel_id}')).toHaveLength(detailGetsBeforeDelete);
});

test('删除非当前渠道不改变当前详情', async () => {
  const user = userEvent.setup();
  channelItems = [channelSummary, otherChannelSummary];
  renderWithQuery(
    <><LocationProbe /><Routes>
      <Route path="/configuration/ai" element={<AIChannelsPage />}>
        <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
      </Route>
    </Routes></>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText(otherChannelSummary.name);
  const currentDetailGets = () => apiMocks.GET.mock.calls.filter(([path, options]) => (
    path === '/api/v1/ai-channels/{channel_id}'
    && options?.params?.path?.channel_id === channel.id
  )).length;
  const detailGetsBeforeDelete = currentDetailGets();
  await user.click(screen.getByRole('button', { name: `更多操作：${otherChannelSummary.name}` }));
  await user.click(await screen.findByRole('menuitem', { name: '删除渠道' }));
  const dialog = await findRcDialog(`删除渠道“${otherChannelSummary.name}”？`);
  await user.click(within(dialog).getByRole('button', { name: '删除渠道' }));
  await waitFor(() => expect(screen.queryByText(otherChannelSummary.name)).not.toBeInTheDocument());
  expect(screen.getByTestId('location')).toHaveTextContent('/configuration/ai/channels/channel-1');
  expect(screen.getByRole('heading', { name: channel.name })).toBeInTheDocument();
  expect(currentDetailGets()).toBe(detailGetsBeforeDelete);
});

test('渠道删除失败时保留详情路由并显示原始错误', async () => {
  const user = userEvent.setup();
  apiMocks.DELETE.mockResolvedValueOnce({
    error: { error: { code: 'CHANNEL_IN_USE', message: '渠道仍有关联作业' } },
    response: new Response(null, { status: 409 }),
  });
  renderWithQuery(
    <><LocationProbe /><Routes>
      <Route path="/configuration/ai" element={<AIChannelsPage />}>
        <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
      </Route>
    </Routes></>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByRole('heading', { name: channel.name });
  await user.click(screen.getByRole('button', { name: /删除渠道$/ }));
  await user.click(screen.getAllByRole('button', { name: /删除渠道$/ }).at(-1)!);
  expect(await screen.findByText('渠道仍有关联作业')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/configuration/ai/channels/channel-1');
  expect(screen.getByRole('heading', { name: channel.name })).toBeInTheDocument();
  expect(apiMocks.DELETE).toHaveBeenCalledTimes(1);
});

test('直接访问不存在的渠道仍展示 NOT_FOUND', async () => {
  renderWithQuery(
    <Routes>
      <Route path="/configuration/ai" element={<AIChannelsPage />}>
        <Route path="channels/:channelId" element={<AIChannelDetailPage />} />
      </Route>
    </Routes>,
    ['/configuration/ai/channels/channel-missing'],
  );
  expect(await screen.findByText('渠道不存在')).toBeInTheDocument();
  expect(apiMocks.GET).toHaveBeenCalledWith(
    '/api/v1/ai-channels/{channel_id}',
    expect.objectContaining({ params: { path: { channel_id: 'channel-missing' } } }),
  );
});

test('新增渠道提交受控品牌与协议且 API Key 只存在于创建载荷', async () => {
  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  await screen.findByText('受控模型渠道');
  fireEvent.click(screen.getByRole('button', { name: /新增渠道$/ }));
  const dialog = await findRcDialog('新增渠道');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '渠道名称' }), { target: { value: '新渠道' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '描述' }), { target: { value: '测试用途' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'API 根地址' }), { target: { value: 'https://new.example.invalid/v1' } });
  fireEvent.change(within(dialog).getByLabelText('API Key'), { target: { value: 'secret-value' } });
  apiMocks.POST.mockResolvedValueOnce(result({ ...channel, id: 'channel-new', name: '新渠道' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '创建渠道' }));
  await waitFor(() => {
    expect(apiMocks.POST).toHaveBeenCalledWith('/api/v1/ai-channels', expect.objectContaining({ body: expect.objectContaining({
      description: '测试用途', protocol_type: 'openai-compatible-chat-completions', provider_brand: 'CUSTOM', api_key: 'secret-value',
    }) }));
    expect(screen.queryByRole('dialog', { name: '新增渠道' })).not.toBeInTheDocument();
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('secret-value');
  });
});

test('API Key 在弹窗结束后从 mutation 状态清除', async () => {
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText('生产内容生成渠道');
  apiMocks.PUT.mockResolvedValueOnce(result({ ...channel, revision: channel.revision + 1 }));
  fireEvent.click(screen.getByRole('button', { name: '重新配置' }));
  const keyDialog = await findRcDialog('重新配置 API Key');
  fireEvent.change(within(keyDialog).getByLabelText('新的 API Key'), { target: { value: 'replacement-secret' } });
  fireEvent.click(within(keyDialog).getByRole('button', { name: '保存并重置连接状态' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '重新配置 API Key' })).not.toBeInTheDocument();
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('replacement-secret');
  });
});

test('敏感 Header 在弹窗结束后从 mutation 状态清除', async () => {
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText('生产内容生成渠道');
  fireEvent.click(screen.getByRole('tab', { name: '请求配置' }));
  apiMocks.POST.mockResolvedValueOnce(result({
    ...channel,
    revision: channel.revision + 1,
    headers: [...channel.headers, { id: 'header-new', name: 'X-New-Secret', is_sensitive: true, is_configured: true, value: null }],
  }));
  fireEvent.click(screen.getByRole('button', { name: /新增$/ }));
  const headerDialog = await findRcDialog('新增 Header');
  fireEvent.change(within(headerDialog).getByRole('textbox', { name: 'Header 名' }), { target: { value: 'X-New-Secret' } });
  fireEvent.change(within(headerDialog).getByLabelText('值'), { target: { value: 'sensitive-header-value' } });
  fireEvent.mouseDown(within(headerDialog).getByRole('combobox', { name: '类型' }));
  fireEvent.click(await screen.findByText('敏感且永不回显'));
  fireEvent.click(within(headerDialog).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '新增 Header' })).not.toBeInTheDocument();
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('sensitive-header-value');
  });
});

test('复制渠道配置只写入非敏感白名单', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText('生产内容生成渠道');
  await user.click(screen.getByRole('button', { name: /复制配置$/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const copied = writeText.mock.calls[0]![0] as string;
  expect(copied).toContain('public-value');
  expect(copied).toContain('X-Secret');
  expect(copied).not.toContain('header-secret');
  expect(copied).not.toContain('api_key');
});

test('详情 Tabs 从 URL 恢复，请求配置仅显示固定掩码且敏感值不回显', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1?tab=request'],
  );
  expect(await screen.findByText('已安全配置（••••••）')).toBeInTheDocument();
  expect(screen.getByText('public-value')).toBeInTheDocument();
  expect(screen.queryByText('header-secret')).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '模型管理' }));
  expect(await screen.findByText('内容生成模型')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await findRcDialog('获取模型')).toBeInTheDocument();
  expect(await screen.findByText('model-new')).toBeInTheDocument();
});

test('Header 删除确认说明渠道和模型失效范围', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <Routes><Route path="/configuration/ai/channels/:channelId" element={<AIChannelDetailPage />} /></Routes>,
    ['/configuration/ai/channels/channel-1?tab=request'],
  );
  await user.click(await screen.findByRole('button', { name: '更多操作：Header X-Public' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  const dialog = await findRcDialog('删除 Header“X-Public”？');
  expect(within(dialog).getByText('删除后会停用该渠道及其全部模型，并把全部模型的测试状态重置为“未测试”、清除最近测试信息；重新测试并启用前不可用于生成。此操作不可恢复。')).toBeInTheDocument();
  expect(within(dialog).queryByText(/物理删除/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
});

test('渠道级连接测试必须显式选择模型并提示测试后停用', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText('生产内容生成渠道');
  await user.click(screen.getAllByRole('button', { name: /测试连接$/ })[0]!);
  const dialog = await findRcDialog(/测试连接/);
  expect(within(dialog).getByRole('button', { name: '开始测试' })).toBeDisabled();
  expect(within(dialog).getByText(/完成后模型将停用/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('combobox', { name: '选择测试模型' }));
  await user.click(await screen.findByTitle(/内容生成模型/));
  await user.click(within(dialog).getByRole('button', { name: '开始测试' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/ai-models/{model_id}/test',
    expect.objectContaining({ params: expect.objectContaining({ path: { model_id: model.id } }) }),
  ));
});

test('使用统计与渠道日志各自使用真实读取接口', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1?tab=usage'],
  );
  expect(await screen.findByText('业务作业')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('66.7%')).toBeInTheDocument();
  expect(document.querySelectorAll('.ai-usage-grid .metric-tile')).toHaveLength(4);
  await user.click(screen.getByRole('tab', { name: '操作日志' }));
  expect(await screen.findByText('ai_model.tested')).toBeInTheDocument();
  expect(screen.getByText('系统管理员')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '执行结果' })).toBeInTheDocument();
  expect(screen.getByText('成功')).toBeInTheDocument();
});
