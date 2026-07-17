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
const ruleVersions = [
  platforms[1]!.active_version,
  { id: 'version-2', platform_profile_id: 'profile-ready', version: 2, status: 'DRAFT', rules: { ...platformRules, body_max: 6000 }, revision: 3, created_at: channel.created_at },
].filter((version) => version !== null);
const platformPrompt = { platform_profile_id: 'profile-ready', template_markdown: '仅使用已批准事实。', revision: 1, updated_by: 'user-1', created_at: channel.created_at, updated_at: channel.updated_at };
let platformItems = platforms;
let platformRuleItems = ruleVersions;

function result(data: unknown) {
  return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
}

function renderWithQuery(ui: ReactNode, initialEntries: string[]) {
  return render(<ThemeProvider><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider></ThemeProvider>);
}

beforeEach(() => {
  queryClient.clear();
  platformItems = platforms;
  platformRuleItems = ruleVersions;
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels') return result({ items: [channel] });
    if (path === '/api/v1/ai-channels/{channel_id}') return result(channel);
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ items: [model] });
    if (path === '/api/v1/platform-profiles') return result({ items: platformItems });
    if (path === '/api/v1/platform-profile-versions') return result({ items: platformRuleItems });
    if (path === '/api/v1/platform-types') return result({ items: [platformType] });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result(platformPrompt);
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels/{channel_id}/disable') return result({ ...channel, is_enabled: false, revision: channel.revision + 1 });
    if (path === '/api/v1/ai-channels/{channel_id}/discover-models') return result({ items: [{ model_id: 'model-controlled' }, { model_id: 'model-new' }] });
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ ...model, id: 'model-2', display_name: 'model-new', model_id: 'model-new' });
    if (path === '/api/v1/ai-models/{model_id}/disable') return result({ ...model, is_enabled: false, revision: model.revision + 1 });
    if (path === '/api/v1/platform-profiles') return result({ ...platforms[0], id: 'profile-new', active_version: null });
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/versions') return result({ id: 'version-new', platform_profile_id: 'profile-empty', version: 1, status: 'DRAFT', rules: platformRules, revision: 0, created_at: channel.created_at });
    if (path === '/api/v1/platform-profile-versions/{platform_profile_version_id}/activate') return result({ ...platformRuleItems[1], status: 'ACTIVE', revision: 4 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PATCH.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profile-versions/{platform_profile_version_id}') return result({ ...platformRuleItems[1], rules: { ...platformRules, body_max: 7000 }, revision: 4 });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.PUT.mockImplementation((path: string) => {
    if (path === '/api/v1/platform-profiles/{platform_profile_id}/prompt') return result({ ...platformPrompt, revision: 2 });
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

test('新增平台只提交身份字段且保持无当前规则', async () => {
  const payload = { name: '新平台', slug: 'new-platform', platform_type_id: platformType.id, allowed_domains: ['new.example.invalid'] } satisfies Schema<'PlatformProfileCreate'>;
  renderWithQuery(<PlatformsPage />, ['/configuration/platforms']);
  await screen.findByText('待配置平台');
  expect(screen.getByRole('button', { name: /新增平台$/ })).toBeInTheDocument();
  expect(payload).not.toHaveProperty('rules');
  expect(screen.queryByLabelText('目标受众')).not.toBeInTheDocument();
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

test('渠道首页以表格展示完整契约字段、操作且不触发模型 N+1 查询', async () => {
  const user = userEvent.setup();
  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  const detailLink = await screen.findByRole('link', { name: '查看 受控模型渠道 配置' });
  expect(detailLink).toHaveAttribute('href', '/configuration/ai/channels/channel-1');
  const row = detailLink.closest('tr');
  expect(row).not.toBeNull();
  expect(within(row!).getByText('https://provider.example.invalid/v1')).toBeInTheDocument();
  expect(within(row!).getByText(/已配置/)).toBeInTheDocument();
  expect(within(row!).getByText('model-controlled')).toBeInTheDocument();
  expect(within(row!).getByRole('button', { name: '更多操作：受控模型渠道' })).toBeInTheDocument();
  expect(within(row!).queryByRole('button', { name: /删\s*除/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '列设置' }));
  await user.click(await screen.findByRole('menuitem', { name: '请求超时' }));
  await user.click(await screen.findByRole('menuitem', { name: '请求 Header' }));
  expect(screen.getByText('60 秒')).toBeInTheDocument();
  expect(screen.getByText('2 个')).toBeInTheDocument();
  await waitFor(() => expect(apiMocks.GET).toHaveBeenCalledTimes(1));
  expect(apiMocks.GET).toHaveBeenCalledWith('/api/v1/ai-channels');

  await user.click(within(row!).getByRole('button', { name: '更多操作：受控模型渠道' }));
  await user.click(await screen.findByRole('menuitem', { name: '停用' }));
  await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith(
    '/api/v1/ai-channels/{channel_id}/disable',
    expect.objectContaining({
      params: expect.objectContaining({ path: { channel_id: channel.id } }),
      body: { expected_revision: channel.revision },
    }),
  ));
});

test('渠道首页默认隐藏次要列并避免重复显示相同的模型名称与 ID', async () => {
  const user = userEvent.setup();
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels') return result({
      items: [{
        ...channel,
        enabled_models: [
          { display_name: 'same-model', model_id: 'same-model' },
          { display_name: '展示名称', model_id: 'provider-model' },
        ],
      }],
    });
    throw new Error(`未声明测试请求：${path}`);
  });

  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  await screen.findByRole('link', { name: '查看 受控模型渠道 配置' });
  expect(screen.getByRole('columnheader', { name: 'API Key' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: '请求超时' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: '请求 Header' })).not.toBeInTheDocument();
  expect(screen.getAllByText('same-model')).toHaveLength(1);
  expect(screen.getByText('展示名称')).toBeInTheDocument();
  expect(screen.getByText('provider-model')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '列设置' }));
  await user.click(await screen.findByRole('menuitem', { name: '请求超时' }));
  expect(screen.getByRole('columnheader', { name: '请求超时' })).toBeInTheDocument();
});

test('渠道详情展示可达章节导航、模型测试信息且不回显敏感 Header', async () => {
  renderWithQuery(<Routes><Route path="/configuration/ai/channels/:channelId" element={<AIChannelDetailPage />} /></Routes>, ['/configuration/ai/channels/channel-1']);
  const navigation = await screen.findByRole('navigation', { name: 'AI 渠道配置章节' });
  for (const [name, target] of [['连接与凭据', 'channel-connection'], ['请求 Header', 'channel-headers'], ['模型', 'channel-models']] as const) {
    expect(within(navigation).getByRole('link', { name })).toHaveAttribute('href', `#${target}`);
    expect(document.getElementById(target)).toBeInTheDocument();
  }
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

  await user.click(within(row!).getByRole('button', { name: '更多操作：模型 内容生成模型' }));
  await user.click(await screen.findByRole('menuitem', { name: '停用' }));
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
