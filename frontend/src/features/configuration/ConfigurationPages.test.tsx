/** 锁定配置页面的层级、Prompt 和渠道查询边界。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { queryClient } from '../../app/queryClient';
import { queryKeys } from '../../shared/api/queryKeys';
import { AIChannelDetailPage } from './AIChannelDetailPage';
import { AIChannelsPage } from './AIChannelsPage';
import { PlatformPromptsPage } from './PlatformPromptsPage';
import { PlatformsPage } from './PlatformsPage';

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));

vi.mock('../../shared/api/client', () => ({
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
  id: 'channel-1', name: '受控模型渠道', base_url: 'https://provider.example.invalid/v1', timeout_seconds: 60,
  is_enabled: true, api_key_configured: true, api_key_updated_at: '2026-07-13T08:00:00+08:00', revision: 3,
  created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T08:00:00+08:00',
  headers: [
    { id: 'header-1', name: 'X-Public', is_sensitive: false, is_configured: true, value: 'public-value' },
    { id: 'header-2', name: 'X-Secret', is_sensitive: true, is_configured: true, value: null },
  ],
  enabled_models: [{ display_name: '内容生成模型', model_id: 'model-controlled' }],
};
const model = {
  id: 'model-1', channel_id: channel.id, display_name: '内容生成模型', model_id: 'model-controlled', request_parameters: { temperature: 0.2 },
  is_enabled: true, test_status: 'PASSED', last_tested_at: '2026-07-13T09:00:00+08:00', last_test_error_summary: null,
  revision: 2, created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T09:00:00+08:00',
};
const platformType = { id: 'type-1', name: '技术社区', slug: 'technical-community', revision: 0, created_by: 'user-1', created_at: channel.created_at };
const platformRules = { target_audience: '工程师', title_min: 1, title_max: 120, body_min: 1, body_max: 5000, tone: '技术说明', allow_external_links: true, allow_tables: true, allow_contact: false, prohibited_phrases: [], sections: [] };
const platforms = [
  { id: 'profile-empty', name: '待配置平台', slug: 'pending-platform', allowed_domains: ['pending.example.invalid'], platform_type_id: platformType.id, revision: 0, active_version: null, prompt_configured: false },
  { id: 'profile-ready', name: '工程师社区', slug: 'engineer-community', allowed_domains: ['community.example.invalid'], platform_type_id: platformType.id, revision: 1, active_version: { id: 'version-1', platform_profile_id: 'profile-ready', version: 1, status: 'ACTIVE', rules: platformRules, revision: 0, created_at: channel.created_at }, prompt_configured: true },
];
const platformPrompt = { platform_profile_id: 'profile-ready', template_markdown: '仅使用已批准事实。', revision: 1, updated_by: 'user-1', created_at: channel.created_at, updated_at: channel.updated_at };
let platformItems = platforms;

function result(data: unknown) {
  return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
}

function renderWithQuery(ui: ReactNode, initialEntries: string[]) {
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  queryClient.clear();
  platformItems = platforms;
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels') return result({ items: [channel] });
    if (path === '/api/v1/ai-channels/{channel_id}') return result(channel);
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ items: [model] });
    if (path === '/api/v1/platform-profiles') return result({ items: platformItems });
    if (path === '/api/v1/platform-types') return result({ items: [platformType] });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result(platformPrompt);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels/{channel_id}/discover-models') return result({ items: [{ model_id: 'model-controlled' }, { model_id: 'model-new' }] });
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ ...model, id: 'model-2', display_name: 'model-new', model_id: 'model-new' });
    if (path === '/api/v1/ai-models/{model_id}/disable') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PUT.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result({ ...platformPrompt, revision: 2 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.DELETE.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') platformItems = platformItems.map((item) => item.id === 'profile-ready' ? { ...item, prompt_configured: false } : item);
    return Promise.resolve({ response: new Response(null, { status: 204 }) });
  });
});

test('平台列表明确展示无有效规则和缺少 Prompt', async () => {
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  expect(await screen.findByText('无有效规则')).toBeInTheDocument();
  expect(screen.getByText('未配置 Prompt')).toBeInTheDocument();
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

test('渠道首页以卡片展示契约字段且不触发模型 N+1 查询', async () => {
  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  expect(await screen.findByRole('link', { name: '查看 受控模型渠道 配置' })).toHaveAttribute('href', '/configuration/ai/channels/channel-1');
  expect(screen.getByText('https://provider.example.invalid/v1')).toBeInTheDocument();
  expect(screen.getByText('2 个')).toBeInTheDocument();
  expect(screen.getByText('model-controlled')).toBeInTheDocument();
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledTimes(1));
  expect(apiMocks.GET).toHaveBeenCalledWith('/api/v1/ai-channels');
});

test('渠道详情展示三个区块、模型测试信息且不回显敏感 Header', async () => {
  renderWithQuery(<Routes><Route path="/configuration/ai/channels/:channelId" element={<AIChannelDetailPage />} /></Routes>, ['/configuration/ai/channels/channel-1']);
  expect(await screen.findByText('连接与凭据')).toBeInTheDocument();
  expect(screen.getByText('请求 Header')).toBeInTheDocument();
  expect(screen.getByText('模型')).toBeInTheDocument();
  expect(await screen.findByText('内容生成模型')).toBeInTheDocument();
  expect(screen.getByText('已配置且不回显')).toBeInTheDocument();
  expect(screen.getByText('public-value')).toBeInTheDocument();
  expect(screen.queryByText('header-secret')).not.toBeInTheDocument();
  expect(screen.getByText('temperature')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试连接' })).toBeInTheDocument();
  expect(apiMocks.GET).toHaveBeenCalledTimes(2);
});

test('模型状态变更后同步失效渠道摘要和模型列表缓存', async () => {
  const user = userEvent.setup();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  renderWithQuery(<Routes><Route path="/configuration/ai/channels/:channelId" element={<AIChannelDetailPage />} /></Routes>, ['/configuration/ai/channels/channel-1']);
  const row = (await screen.findByText('内容生成模型')).closest('tr');
  expect(row).not.toBeNull();

  await user.click(within(row!).getByRole('button', { name: /停\s*用/ }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/ai-models/{model_id}/disable',
    expect.objectContaining({ body: { expected_revision: model.revision } }),
  ));
  await waitFor(() => {
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.aiChannels.detail(channel.id) });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.aiChannels.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.aiChannels.models(channel.id) });
  });
  invalidateQueries.mockRestore();
});

test('获取模型在弹窗中列出远端结果并可直接添加未配置模型', async () => {
  const user = userEvent.setup();
  renderWithQuery(<Routes><Route path="/configuration/ai/channels/:channelId" element={<AIChannelDetailPage />} /></Routes>, ['/configuration/ai/channels/channel-1']);
  await screen.findByText('内容生成模型');

  await user.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByRole('dialog', { name: '获取模型' })).toBeInTheDocument();
  expect(await screen.findByText('model-new')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '已添加' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: '添加' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/ai-channels/{channel_id}/models',
    expect.objectContaining({ body: { display_name: 'model-new', model_id: 'model-new', request_parameters: {} } }),
  ));
});
