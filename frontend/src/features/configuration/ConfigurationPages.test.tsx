/** 锁定配置页面的层级、Prompt 和渠道查询边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { AIChannelDetailPage } from './AIChannelDetailPage';
import { AIChannelsPage } from './AIChannelsPage';
import { PlatformPromptsPage } from './PlatformPromptsPage';
import { PlatformRulesPage } from './PlatformRulesPage';
import { PlatformsPage } from './PlatformsPage';

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));

vi.mock('../../shared/api/client', () => ({
  ApiError: class ApiError extends Error { code = 'HTTP_ERROR'; },
  api: apiMocks,
  csrfHeader: () => ({ 'X-CSRF-Token': 'test' }),
  ensureSuccess: (result: { response: Response }) => { if (!result.response.ok) throw new Error('请求失败'); },
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  unwrap: <T,>(result: { data?: T; response: Response }) => {
    if (result.data !== undefined) return result.data;
    throw new Error(`请求失败（HTTP ${result.response.status}）`);
  },
}));

const channel = {
  id: 'channel-1', name: '受控模型渠道', description: '生产内容生成渠道', protocol_type: 'openai-compatible-chat-completions' as const, provider_brand: 'OPENAI' as const,
  base_url: 'https://provider.example.invalid/v1', timeout_seconds: 60,
  is_enabled: true, api_key_configured: true, api_key_updated_at: '2026-07-13T08:00:00+08:00', revision: 3,
  latest_test_status: 'PASSED' as const, last_tested_at: '2026-07-13T09:00:00+08:00',
  created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T08:00:00+08:00',
  headers: [
    { id: 'header-1', name: 'X-Public', is_sensitive: false, is_configured: true, value: 'public-value' },
    { id: 'header-2', name: 'X-Secret', is_sensitive: true, is_configured: true, value: null },
  ],
  enabled_models: [{ display_name: '内容生成模型', model_id: 'model-controlled' }],
};
const channelSummary = {
  id: channel.id, name: channel.name, description: channel.description, protocol_type: channel.protocol_type,
  provider_brand: channel.provider_brand, base_url: channel.base_url, is_enabled: channel.is_enabled,
  api_key_configured: channel.api_key_configured, header_count: channel.headers.length, enabled_model_count: 1,
  latest_test_status: channel.latest_test_status, last_tested_at: channel.last_tested_at, revision: channel.revision,
};
const model = {
  id: 'model-1', channel_id: channel.id, display_name: '内容生成模型', model_id: 'model-controlled', request_parameters: { temperature: 0.2 },
  is_enabled: true, test_status: 'PASSED', last_tested_at: '2026-07-13T09:00:00+08:00', last_test_error_summary: null,
  revision: 2, created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T09:00:00+08:00',
};
const platformType = { id: 'type-1', name: '技术社区', slug: 'technical-community', revision: 0, created_by: 'user-1', created_at: channel.created_at };
const platformRules = { target_audience: '工程师', title_min: 1, title_max: 120, body_min: 1, body_max: 5000, tone: '技术说明', allow_external_links: true, allow_tables: true, allow_contact: false, prohibited_phrases: [], sections: [] };
const platforms = [
  { id: 'profile-empty', name: '待配置平台', slug: 'pending-platform', allowed_domains: ['pending.example.invalid'], platform_type_id: platformType.id, website_url: null, logo: null, revision: 0, active_version: null, prompt_configured: false },
  { id: 'profile-ready', name: '工程师社区', slug: 'engineer-community', allowed_domains: ['community.example.invalid'], platform_type_id: platformType.id, website_url: 'https://community.example.invalid/', logo: { source: 'EXTERNAL' as const, url: 'https://cdn.example.invalid/community.png' }, revision: 1, active_version: { id: 'version-1', platform_profile_id: 'profile-ready', version: 1, status: 'ACTIVE', rules: platformRules, revision: 0, created_at: channel.created_at }, prompt_configured: true },
];
const ruleVersions = [
  platforms[1]!.active_version,
  { id: 'version-2', platform_profile_id: 'profile-ready', version: 2, status: 'DRAFT', rules: { ...platformRules, body_max: 6000 }, revision: 3, created_at: channel.created_at },
].filter((version) => version !== null);
const platformPrompt = { platform_profile_id: 'profile-ready', template_markdown: '仅使用已批准事实。', revision: 1, updated_by: 'user-1', created_at: channel.created_at, updated_at: channel.updated_at };
const humanizationPrompt = { template_markdown: '保持事实，只改善表达。', revision: 1, updated_by: 'user-1', created_at: channel.created_at, updated_at: channel.updated_at };
let platformItems = platforms;
let platformRuleItems = ruleVersions;

function result(data: unknown) {
  return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
}

function renderWithQuery(ui: ReactNode, initialEntries: string[]) {
  return render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider></ThemeProvider>);
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
  platformItems = platforms;
  platformRuleItems = ruleVersions;
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels') return result({ items: [channelSummary], page: 1, page_size: 20, total: 1, counts: { all: 1, enabled: 1, disabled: 0 } });
    if (path === '/api/v1/ai-channels/{channel_id}') return result(channel);
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ items: [model] });
    if (path === '/api/v1/ai-channels/{channel_id}/usage-summary') return result({ channel_id: channel.id, period: '30d', period_started_at: '2026-06-13T08:00:00+08:00', period_ended_at: '2026-07-13T08:00:00+08:00', total_jobs: 3, succeeded_jobs: 2, failed_jobs: 1, success_rate: 2 / 3, average_response_duration_ms: 1200, prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, last_used_at: '2026-07-13T07:00:00+08:00' });
    if (path === '/api/v1/ai-channels/{channel_id}/audit-logs') return result({ items: [{ id: 'audit-1', actor_id: 'user-1', action: 'ai_model.tested', target_type: 'AIModel', target_id: model.id, change_summary: { test_status: 'PASSED' }, request_id: 'request-1', created_at: channel.updated_at }], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/users') return result({ items: [{ id: 'user-1', username: 'admin', display_name: '系统管理员', account_type: 'ADMIN', is_active: true, must_change_password: false, revision: 0, created_at: channel.created_at }], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/platform-profiles') return result({ items: platformItems });
    if (path === '/api/v1/platform-profile-versions') return result({ items: platformRuleItems });
    if (path === '/api/v1/platform-types') return result({ items: [platformType] });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result(platformPrompt);
    if (path === '/api/v1/content-humanization-prompt') return result(humanizationPrompt);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels/{channel_id}/disable') return result({ ...channel, is_enabled: false, revision: channel.revision + 1 });
    if (path === '/api/v1/ai-channels/{channel_id}/discover-models') return result({ items: [{ model_id: 'model-controlled' }, { model_id: 'model-new' }] });
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ ...model, id: 'model-2', display_name: 'model-new', model_id: 'model-new' });
    if (path === '/api/v1/ai-models/{model_id}/disable') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    if (path === '/api/v1/ai-models/{model_id}/test') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    if (path === '/api/v1/platform-profiles') return result({ ...platforms[0], id: 'profile-new', active_version: null });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/versions') return result({ id: 'version-new', platform_profile_id: 'profile-empty', version: 1, status: 'DRAFT', rules: platformRules, revision: 0, created_at: channel.created_at });
    if (path === '/api/v1/platform-profile-versions/{platform_profile_version_id}/activate') return result({ ...platformRuleItems[1], status: 'ACTIVE', revision: 4 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PATCH.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}') return result({ ...platforms[1], revision: 2 });
    if (path === '/api/v1/platform-profile-versions/{platform_profile_version_id}') return result({ ...platformRuleItems[1], rules: { ...platformRules, body_max: 7000 }, revision: 4 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PUT.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result({ ...platformPrompt, revision: 2 });
    if (path === '/api/v1/content-humanization-prompt') return result({ ...humanizationPrompt, revision: 2 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.DELETE.mockImplementation((path: string, options?: { params?: { path?: Record<string, string> } }) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') platformItems = platformItems.map((item) => item.id === 'profile-ready' ? { ...item, prompt_configured: false } : item);
    if (path === '/api/v1/platform-profile-versions/{platform_profile_version_id}') platformRuleItems = platformRuleItems.filter((item) => item?.id !== options?.params?.path?.platform_profile_version_id);
    return Promise.resolve({ response: new Response(null, { status: 204 }) });
  });
});

test('平台列表明确展示无有效规则和缺少 Prompt', async () => {
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  expect(await screen.findByText('无有效规则')).toBeInTheDocument();
  expect(screen.getByText('未配置 Prompt')).toBeInTheDocument();
});

test('新增平台品牌字段可选且保持无当前规则', async () => {
  const payload = { name: '新平台', slug: 'new-platform', platform_type_id: platformType.id, allowed_domains: ['new.example.invalid'], website_url: null, logo: null } satisfies Schema<'PlatformProfileCreate'>;
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  await screen.findByText('待配置平台');
  expect(screen.getByRole('button', { name: /新增平台$/ })).toBeInTheDocument();
  expect(payload).not.toHaveProperty('rules');
  expect(screen.queryByLabelText('目标受众')).not.toBeInTheDocument();
});

test('编辑平台可保存官网和外部 Logo URL', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('button', { name: '编辑平台：工程师社区' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const website = within(dialog!).getByRole('textbox', { name: '平台官网' });
  await user.clear(website);
  await user.type(website, 'https://new.example.invalid/platform');
  const logoUrl = within(dialog!).getByRole('textbox', { name: '外部 Logo URL' });
  await user.clear(logoUrl);
  await user.type(logoUrl, 'https://cdn.example.invalid/new-logo.webp');
  await user.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  await waitFor(() => expect(apiMocks.PATCH).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_id: 'profile-ready' } }),
      body: expect.objectContaining({
        website_url: 'https://new.example.invalid/platform',
        logo: { source: 'EXTERNAL', url: 'https://cdn.example.invalid/new-logo.webp' },
      }),
    }),
  ));
});

test('编辑平台可显式清空官网和 Logo', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  fireEvent.click(within(row!).getByRole('button', { name: '编辑平台：工程师社区' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  await user.clear(within(dialog!).getByRole('textbox', { name: '平台官网' }));
  await user.click(within(dialog!).getByRole('combobox', { name: /Logo 来源/ }));
  await user.click(await screen.findByText('不设置 Logo'));
  await user.click(within(dialog!).getByRole('button', { name: '保存平台' }));
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
  fireEvent.click(within(row!).getByRole('button', { name: '编辑平台：工程师社区' }));
  const dialog = (await screen.findByText('编辑 工程师社区 的平台信息')).closest<HTMLElement>('[role="dialog"]');
  await user.click(within(dialog!).getByRole('button', { name: '保存平台' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请求失败（HTTP 503）');
});

test('独立规则页只展示真实版本并支持创建和编辑草稿', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformRulesPage />, ['/configuration/platform-rules']);
  expect(await screen.findByText('V1')).toBeInTheDocument();
  expect(screen.getByText('V2')).toBeInTheDocument();
  expect(screen.getAllByText('工程师社区')).toHaveLength(2);
  expect(screen.queryByText('待配置平台')).not.toBeInTheDocument();

  const createRuleButton = screen.getByRole('button', { name: /新增规则草稿$/ });
  fireEvent.click(createRuleButton);
  expect(createRuleButton).toHaveAttribute('aria-expanded', 'true');
  const createDialog = await screen.findByRole('dialog', { name: '新增规则草稿' });
  await user.click(within(createDialog).getByRole('combobox', { name: '所属平台' }));
  await user.click(await screen.findByTitle('待配置平台'));
  await user.type(within(createDialog).getByRole('textbox', { name: '目标受众' }), '采购工程师');
  await user.type(within(createDialog).getByRole('textbox', { name: '语气' }), '技术说明');
  for (const [label, value] of [['标题最短', '1'], ['标题最长', '100'], ['正文最短', '10'], ['正文最长', '3000']] as const) {
    await user.type(within(createDialog).getByRole('spinbutton', { name: label }), value);
  }
  await user.click(within(createDialog).getByRole('button', { name: '创建草稿版本' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}/versions',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_id: 'profile-empty' } }),
      body: expect.objectContaining({ rules: expect.objectContaining({ target_audience: '采购工程师', body_max: 3000 }) }),
    }),
  ));

  await user.click(screen.getByRole('button', { name: '编辑草稿' }));
  const editDialog = await screen.findByRole('dialog', { name: '编辑 工程师社区 V2 草稿' });
  const bodyMax = within(editDialog).getByRole('spinbutton', { name: '正文最长' });
  await user.clear(bodyMax);
  await user.type(bodyMax, '7000');
  await user.click(within(editDialog).getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(apiMocks.PATCH).toHaveBeenCalledWith(
    '/api/v1/platform-profile-versions/{platform_profile_version_id}',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_version_id: 'version-2' } }),
      body: expect.objectContaining({ expected_revision: 3, rules: expect.objectContaining({ body_max: 7000 }) }),
    }),
  ));
});

test('平台当前规则只列本平台草稿并复用激活命令', async () => {
  const user = userEvent.setup();
  platformRuleItems = [...ruleVersions, { id: 'version-cross', platform_profile_id: 'profile-empty', version: 9, status: 'DRAFT', rules: platformRules, revision: 0, created_at: channel.created_at }];
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  const selector = await screen.findByRole('combobox', { name: '选择 工程师社区 当前规则' });
  await user.click(selector);
  expect(await screen.findByRole('option', { name: 'V2 · DRAFT' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'V9 · DRAFT' })).not.toBeInTheDocument();
  await user.click(screen.getByTitle('V2 · DRAFT'));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/platform-profile-versions/{platform_profile_version_id}/activate',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_version_id: 'version-2' } }),
      body: { expected_revision: 3, comment: '选择为平台当前规则' },
    }),
  ));
  await waitFor(() => {
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.platformProfiles.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.platformProfileVersions.all });
  });
  invalidateQueries.mockRestore();
});

test('删除规则后移除真实行并失效平台与规则查询', async () => {
  const user = userEvent.setup();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  renderWithQuery(<PlatformRulesPage />, ['/configuration/platform-rules']);
  const draftRow = (await screen.findByText('V2')).closest('tr');
  expect(draftRow).not.toBeNull();
  await user.click(within(draftRow!).getByRole('button', { name: '更多操作：规则版本 V2' }));
  await user.click(await screen.findByRole('menuitem', { name: '删除' }));
  await screen.findByRole('dialog', { name: '物理删除规则版本 V2？' });
  await user.click(screen.getAllByRole('button', { name: /删\s*除/ }).at(-1)!);
  await waitFor(() => expect(screen.queryByText('V2')).not.toBeInTheDocument());
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.platformProfiles.all });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.platformProfileVersions.all });
  invalidateQueries.mockRestore();
});

test('Prompt 页面只展示真实 Prompt，新增时只能选择未配置平台', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts']);
  expect(await screen.findByText('工程师社区')).toBeInTheDocument();
  expect(screen.queryByText('待配置平台')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /新增 Prompt$/ }));
  const dialog = await screen.findByRole('dialog', { name: '新增 Prompt' });
  const platformSelect = within(dialog).getByRole('combobox', { name: '所属平台' });
  await user.click(platformSelect);
  expect(await screen.findByRole('option', { name: '待配置平台' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '工程师社区' })).not.toBeInTheDocument();
  await user.click(await screen.findByTitle('待配置平台'));
  expect(within(dialog).getAllByText('待配置平台')).not.toHaveLength(0);
  await user.type(within(dialog).getByRole('textbox', { name: 'Prompt Markdown' }), '新平台 Prompt。');
  await user.click(within(dialog).getByRole('button', { name: '创建 Prompt' }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}/prompt',
    expect.objectContaining({
      params: expect.objectContaining({ path: { platform_profile_id: 'profile-empty' } }),
      body: { template_markdown: '新平台 Prompt。', expected_revision: null },
    }),
  ));
});

test('管理员按 revision 保存全局自然化 Prompt', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts']);
  const editor = await screen.findByRole('textbox', { name: '自然化 Prompt Markdown' });
  expect(editor).toHaveValue('保持事实，只改善表达。');
  await user.clear(editor);
  await user.type(editor, '保留批准事实，重写机械表达。');
  await user.click(screen.getByRole('button', { name: '按 revision 保存' }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/content-humanization-prompt',
    expect.objectContaining({
      body: { template_markdown: '保留批准事实，重写机械表达。', expected_revision: 1 },
    }),
  ));
});

test('Prompt 页面按具体平台覆盖并在物理删除后移除该行', async () => {
  const user = userEvent.setup();
  renderWithQuery(<PlatformPromptsPage />, ['/configuration/prompts']);
  const row = (await screen.findByText('工程师社区')).closest('tr');
  expect(row).not.toBeNull();
  await user.click(within(row!).getByRole('button', { name: '编辑 Prompt' }));
  const editor = await screen.findByRole('textbox', { name: 'Prompt Markdown' });
  expect(editor).toHaveValue('仅使用已批准事实。');
  await user.clear(editor);
  await user.type(editor, '更新后的平台 Prompt。');
  await user.click(screen.getByRole('button', { name: '覆盖保存' }));
  await waitFor(() => expect(apiMocks.PUT).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}/prompt',
    expect.objectContaining({ body: { template_markdown: '更新后的平台 Prompt。', expected_revision: 1 } }),
  ));
  await user.click(screen.getByRole('button', { name: '删除当前 Prompt' }));
  await screen.findByText('删除当前 Prompt？');
  await user.click(screen.getAllByRole('button', { name: /删\s*除/ }).at(-1)!);
  await waitFor(() => expect(apiMocks.DELETE).toHaveBeenCalledWith(
    '/api/v1/platform-profiles/{platform_profile_id}/prompt',
    expect.objectContaining({ params: expect.objectContaining({ path: { platform_profile_id: 'profile-ready' } }) }),
  ));
  expect(await screen.findByText('暂无 Prompt')).toBeInTheDocument();
  expect(screen.queryByText('工程师社区')).not.toBeInTheDocument();
});

test('渠道工作区从 URL 恢复服务端筛选分页并自动选择首条渠道', async () => {
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai?status=enabled&provider_brand=OPENAI&sort=NAME_ASC&page_size=10&q=生产'],
  );
  expect(await screen.findByText('受控模型渠道')).toBeInTheDocument();
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledWith(
    '/api/v1/ai-channels',
    expect.objectContaining({ params: { query: expect.objectContaining({ q: '生产', status: 'ENABLED', provider_brand: 'OPENAI', sort: 'NAME_ASC', page_size: 10 }) } }),
  ));
  expect(await screen.findByText('生产内容生成渠道')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '全部渠道1' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Header 数量' })).toBeInTheDocument();
});

test('新增渠道提交受控品牌与协议且 API Key 只存在于创建载荷', async () => {
  const user = userEvent.setup();
  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  await screen.findByText('受控模型渠道');
  fireEvent.click(screen.getByRole('button', { name: /新增渠道$/ }));
  const dialog = await findRcDialog('新增渠道');
  await user.type(within(dialog).getByRole('textbox', { name: '渠道名称' }), '新渠道');
  await user.type(within(dialog).getByRole('textbox', { name: '描述' }), '测试用途');
  await user.type(within(dialog).getByRole('textbox', { name: 'API 根地址' }), 'https://new.example.invalid/v1');
  await user.type(within(dialog).getByLabelText('API Key'), 'secret-value');
  apiMocks.POST.mockResolvedValueOnce(result({ ...channel, id: 'channel-new', name: '新渠道' }));
  await user.click(within(dialog).getByRole('button', { name: '创建渠道' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith('/api/v1/ai-channels', expect.objectContaining({ body: expect.objectContaining({
    description: '测试用途', protocol_type: 'openai-compatible-chat-completions', provider_brand: 'CUSTOM', api_key: 'secret-value',
  }) })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增渠道' })).not.toBeInTheDocument());
  await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('secret-value'));
});

test('API Key 与敏感 Header 在弹窗结束后从 mutation 状态清除', async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <Routes><Route path="/configuration/ai" element={<AIChannelsPage />}><Route path="channels/:channelId" element={<AIChannelDetailPage />} /></Route></Routes>,
    ['/configuration/ai/channels/channel-1'],
  );
  await screen.findByText('生产内容生成渠道');
  apiMocks.PUT.mockResolvedValueOnce(result({ ...channel, revision: channel.revision + 1 }));
  await user.click(screen.getByRole('button', { name: '重新配置' }));
  const keyDialog = await findRcDialog('重新配置 API Key');
  await user.type(within(keyDialog).getByLabelText('新的 API Key'), 'replacement-secret');
  await user.click(within(keyDialog).getByRole('button', { name: '保存并重置连接状态' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '重新配置 API Key' })).not.toBeInTheDocument());
  await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('replacement-secret'));

  await user.click(screen.getByRole('tab', { name: '请求配置' }));
  apiMocks.POST.mockResolvedValueOnce(result({
    ...channel,
    revision: channel.revision + 1,
    headers: [...channel.headers, { id: 'header-new', name: 'X-New-Secret', is_sensitive: true, is_configured: true, value: null }],
  }));
  await user.click(screen.getByRole('button', { name: /新增$/ }));
  const headerDialog = await findRcDialog('新增 Header');
  await user.type(within(headerDialog).getByRole('textbox', { name: 'Header 名' }), 'X-New-Secret');
  await user.type(within(headerDialog).getByLabelText('值'), 'sensitive-header-value');
  await user.click(within(headerDialog).getByRole('combobox', { name: '类型' }));
  await user.click(await screen.findByText('敏感且永不回显'));
  await user.click(within(headerDialog).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增 Header' })).not.toBeInTheDocument());
  await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((item) => item.state.variables))).not.toContain('sensitive-header-value'));
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
  await user.click(screen.getByRole('tab', { name: '操作日志' }));
  expect(await screen.findByText('ai_model.tested')).toBeInTheDocument();
  expect(screen.getByText('系统管理员')).toBeInTheDocument();
});
