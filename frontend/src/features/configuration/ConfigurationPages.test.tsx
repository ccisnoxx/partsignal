/** 锁定渠道卡片和详情页的安全展示与查询边界。 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { AIChannelDetailPage } from './AIChannelDetailPage';
import { AIChannelsPage } from './AIChannelsPage';

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
};
const model = {
  id: 'model-1', channel_id: channel.id, display_name: '内容生成模型', model_id: 'model-controlled', request_parameters: { temperature: 0.2 },
  is_enabled: true, test_status: 'PASSED', last_tested_at: '2026-07-13T09:00:00+08:00', last_test_error_summary: null,
  revision: 2, created_by: 'user-1', created_at: '2026-07-13T08:00:00+08:00', updated_at: '2026-07-13T09:00:00+08:00',
};

function result(data: unknown) {
  return Promise.resolve({ data, response: new Response(null, { status: 200 }) });
}

function renderWithQuery(ui: ReactNode, initialEntries: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels') return result({ items: [channel] });
    if (path === '/api/v1/ai-channels/{channel_id}') return result(channel);
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ items: [model] });
    throw new Error(`未声明测试请求：${path}`);
  });
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === '/api/v1/ai-channels/{channel_id}/discover-models') return result({ items: [{ model_id: 'model-controlled' }, { model_id: 'model-new' }] });
    if (path === '/api/v1/ai-channels/{channel_id}/models') return result({ ...model, id: 'model-2', display_name: 'model-new', model_id: 'model-new' });
    throw new Error(`未声明测试请求：${path}`);
  });
});

test('渠道首页以卡片展示契约字段且不触发模型 N+1 查询', async () => {
  renderWithQuery(<AIChannelsPage />, ['/configuration/ai']);
  expect(await screen.findByRole('link', { name: '查看 受控模型渠道 配置' })).toHaveAttribute('href', '/configuration/ai/channels/channel-1');
  expect(screen.getByText('https://provider.example.invalid/v1')).toBeInTheDocument();
  expect(screen.getByText('2 个')).toBeInTheDocument();
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
