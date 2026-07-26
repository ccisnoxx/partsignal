/** 验证 GEO 人工观测写入、历史空值和记录页服务端查询。 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '21000000-0000-4000-8000-000000000001';
const publicationId = '30000000-0000-4000-8000-000000000001';
const evidenceFileId = '50000000-0000-4000-8000-000000000001';

vi.mock('../../shared/components/DirectUpload', () => ({
  DirectUpload: ({ onUploaded }: { onUploaded: (file: Schema<'FileRecord'>) => void }) => (
    <button
      type="button"
      onClick={() => onUploaded({
        id: '50000000-0000-4000-8000-000000000001',
        category: 'OPERATION_SCREENSHOT',
        original_filename: 'geo-evidence.png',
        object_key: 'test/geo-evidence.png',
        content_type: 'image/png',
        size: 12,
        sha256: 'a'.repeat(64),
        access_level: 'INTERNAL',
        status: 'VERIFIED',
        created_at: '2026-07-20T10:00:00Z',
        verified_at: '2026-07-20T10:00:01Z',
      })}
    >
      选择测试证据
    </button>
  ),
}));
const user = {
  id: '10000000-0000-4000-8000-000000000001', username: 'engineer', display_name: '工程师',
  account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: '2026-07-18T00:00:00Z',
} satisfies Schema<'User'>;

const metrics = {
  legacy_sample_count: 0, legacy_mention_rate: null, legacy_recommendation_rate: null,
  legacy_citation_rate: null, legacy_accuracy_rate: null,
  manual_observation_count: 1, article_result_count: 1, recommended_article_count: 1,
  not_recommended_article_count: 0, article_recommendation_rate: 1,
} satisfies Schema<'GeoMetrics'>;

const manualRecord = {
  observation_kind: 'MANUAL_ARTICLE_SEARCH',
  id: '40000000-0000-4000-8000-000000000001',
  query_topic_id: topicId,
  product_id: productId,
  product_label: 'PartSignal PS-001',
  search_platform: 'DeepSeek',
  search_query: 'PS-001 如何替代？',
  tested_at: '2026-07-20T10:00:00Z',
  article_results: [{
    publication_record_id: publicationId,
    discovered: true,
    mentioned: true,
    recommendation_status: 'RECOMMENDED',
    cited: true,
    accuracy: 'ACCURATE',
    title: 'PS-001 选型文章',
    platform_name: '工程师社区',
    final_url: 'https://community.example.invalid/ps-001',
  }],
  attachment_file_ids: [evidenceFileId],
  notes: '引用部分参数与原文一致。',
  supersedes_id: null,
  tested_by: user.id,
  recorder: { id: user.id, username: user.username, display_name: user.display_name },
  is_current: true,
  available_actions: ['CORRECT'],
  created_at: '2026-07-20T10:05:00Z',
} satisfies Schema<'ManualGeoObservation'>;

const historicalManualRecord = {
  ...manualRecord,
  id: '40000000-0000-4000-8000-000000000002',
  query_topic_id: null,
  article_results: manualRecord.article_results.map((item) => ({
    ...item,
    discovered: null,
    mentioned: null,
    cited: null,
    accuracy: null,
  })),
} satisfies Schema<'ManualGeoObservation'>;

const topic = {
  id: topicId,
  canonical_question: 'PS-001 的替代选型有哪些？',
  intent_type: 'REPLACEMENT',
  variants: ['PS-001 如何替代？'],
  revision: 0,
  created_at: '2026-07-18T00:00:00Z',
} satisfies Schema<'QueryTopic'>;

async function choose(comboboxName: string, optionName: string) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('人工观测弹窗未渲染');
  const combobox = within(dialog).getByLabelText(comboboxName);
  fireEvent.mouseDown(combobox);
  const option = await waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content',
    )].find((item) => item.textContent === optionName);
    expect(match).toBeDefined();
    return match!;
  });
  fireEvent.click(option);
}

test('选择真实问题主题并提交完整逐篇阶段，服务端失败时保留表单', async () => {
  window.history.pushState({}, '', '/observations');
  let createRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: { ...metrics, manual_observation_count: 0, article_result_count: 0, recommended_article_count: 0, article_recommendation_rate: null } satisfies Schema<'GeoMetrics'> };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'GET') return { body: { items: [], page: 1, page_size: 20, total: 0 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [{ id: productId, part_number: 'PS-001', brand: 'PartSignal', category: 'MCU', status: 'ACTIVE', revision: 0, created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' }], page: 1, page_size: 100, total: 1 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/geo-observation-publications')) return { body: { items: [{ publication_record_id: publicationId, title: 'PS-001 选型文章', platform_name: '工程师社区', final_url: 'https://community.example.invalid/ps-001', status: 'VERIFIED' }] } satisfies Schema<'GeoPublicationCandidateList'> };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'POST') {
      createRequest = request;
      return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: '观测事实校验失败', request_id: 'geo-create-failed' } } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: 'GEO 观测' })).toBeInTheDocument();
  expect(await screen.findByText('当前筛选范围暂无观测记录')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /新建观测/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('登记人工观测')).toBeInTheDocument();
  expect(screen.queryByText('启用联网搜索')).not.toBeInTheDocument();

  await choose('产品', 'PartSignal PS-001');
  await choose('问题主题', topic.canonical_question);
  expect(await screen.findByText('PS-001 选型文章')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看文章' })).toHaveAttribute('href', 'https://community.example.invalid/ps-001');
  fireEvent.change(screen.getByRole('textbox', { name: '人工搜索平台' }), { target: { value: 'DeepSeek' } });
  fireEvent.change(screen.getByRole('textbox', { name: '实际搜索词' }), { target: { value: 'PS-001 如何替代？' } });

  const mentionSelect = screen.getByRole('combobox', { name: '是否提及：PS-001 选型文章' });
  fireEvent.mouseDown(mentionSelect);
  expect(await screen.findByRole('option', { name: '已提及' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.keyDown(mentionSelect, { key: 'Escape', code: 'Escape' });
  await choose('是否发现：PS-001 选型文章', '已发现');
  await choose('是否提及：PS-001 选型文章', '已提及');
  await choose('文章推荐结果：PS-001 选型文章', '已推荐');
  await choose('是否引用：PS-001 选型文章', '有引用');
  await choose('准确性：PS-001 选型文章', '准确');
  fireEvent.click(screen.getByRole('button', { name: '选择测试证据' }));
  expect(screen.getByText('至少上传一张真实搜索结果截图；系统不会自动解析或联网复查。')).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole('button', { name: /追加观测记录/ }));
  expect(await screen.findByText('观测事实校验失败')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '实际搜索词' })).toHaveValue('PS-001 如何替代？');
  await waitFor(() => expect(createRequest).toBeInstanceOf(Request));
  await expect(createRequest!.clone().json()).resolves.toMatchObject({
    product_id: productId,
    query_topic_id: topicId,
    search_platform: 'DeepSeek',
    search_query: 'PS-001 如何替代？',
    attachment_file_ids: [evidenceFileId],
    article_results: [{
      publication_record_id: publicationId,
      discovered: true,
      mentioned: true,
      recommendation_status: 'RECOMMENDED',
      cited: true,
      accuracy: 'ACCURATE',
    }],
  });
}, 45_000);

test('筛选、排序和清除操作写入 URL 并请求服务端', async () => {
  window.history.pushState({}, '', '/observations');
  const listQueries: URLSearchParams[] = [];
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname.endsWith('/geo-observations')) {
      listQueries.push(new URLSearchParams(url.search));
      return { body: { items: [manualRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    }
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [] } satisfies Schema<'QueryTopicList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  expect(await screen.findByText('PS-001 如何替代？')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '分析洞察' })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /导出/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: '仅看我的记录' }));
  await waitFor(() => expect(listQueries.some((query) => query.get('only_mine') === 'true')).toBe(true));
  expect(window.location.search).toContain('only_mine=true');

  fireEvent.click(screen.getByRole('button', { name: /观测时间/ }));
  await waitFor(() => expect(listQueries.some((query) => query.get('sort_order') === 'ASC')).toBe(true));
  expect(window.location.search).toContain('sort_order=ASC');

  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  await waitFor(() => expect(window.location.search).toBe('?all_time=true'));
  await waitFor(() => expect(listQueries.some((query) => !query.has('date_from') && !query.has('date_to'))).toBe(true));
});

test('补采前历史追加更正允许选择真实问题主题', async () => {
  window.history.pushState({}, '', `/observations/${historicalManualRecord.id}/correct`);
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname === `/api/v1/geo-observations/${historicalManualRecord.id}`) return { body: historicalManualRecord };
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [historicalManualRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/geo-observation-publications')) return { body: { items: [{ publication_record_id: publicationId, title: 'PS-001 选型文章', platform_name: '工程师社区', final_url: 'https://community.example.invalid/ps-001', status: 'VERIFIED' }] } satisfies Schema<'GeoPublicationCandidateList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('更正人工观测')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '问题主题' })).toBeEnabled();
  await choose('问题主题', topic.canonical_question);
  await waitFor(() => expect(screen.getByRole('combobox', { name: '问题主题' }).parentElement).toHaveAttribute('title', topic.canonical_question));
});

test('人工观测详情对补采前空值明确显示历史未采集', async () => {
  window.history.pushState({}, '', '/observations');
  const file = {
    id: evidenceFileId, category: 'OPERATION_SCREENSHOT', original_filename: 'geo-evidence.png',
    object_key: 'test/geo-evidence.png', content_type: 'image/png', size: 12, sha256: 'a'.repeat(64),
    access_level: 'INTERNAL', status: 'VERIFIED', created_at: '2026-07-20T10:00:00Z', verified_at: '2026-07-20T10:00:01Z',
  } satisfies Schema<'FileRecord'>;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname === `/api/v1/geo-observations/${historicalManualRecord.id}`) return { body: historicalManualRecord };
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [historicalManualRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname === `/api/v1/files/${file.id}/download-url`) return { body: { url: 'https://files.example.invalid/geo-evidence.png', expires_at: '2026-07-20T11:00:00Z' } satisfies Schema<'SignedUrl'> };
    if (url.pathname === `/api/v1/files/${file.id}`) return { body: file };
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [] } satisfies Schema<'QueryTopicList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'PS-001 如何替代？' }));
  expect(await screen.findByText('该记录存在补采前未采集事实；未知值保持未知，不按“否”推断。')).toBeInTheDocument();
  expect(screen.getAllByText('历史未采集').length).toBeGreaterThanOrEqual(4);
  expect(screen.queryByText('历史回答摘要')).not.toBeInTheDocument();
  expect(screen.getByText('引用部分参数与原文一致。')).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: 'geo-evidence.png' })).toBeInTheDocument();
  expect(window.location.search).toContain(`record=${historicalManualRecord.id}`);
});

test('统计失败不遮挡真实观测列表，并提供独立重试入口', async () => {
  window.history.pushState({}, '', '/observations');
  let metricRequests = 0;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) {
      metricRequests += 1;
      return { status: 500, body: { error: { code: 'GEO_METRICS_FAILED', message: 'GEO 统计失败' } } };
    }
    if (url.pathname.endsWith('/geo-observations')) {
      return { body: { items: [manualRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    }
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [] } satisfies Schema<'QueryTopicList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: 'GEO 观测' })).toBeInTheDocument();
  expect(await screen.findByText('PS-001 如何替代？')).toBeInTheDocument();
  const metricState = await screen.findByRole('region', { name: 'GEO 观测统计' });
  expect(await within(metricState).findByRole('alert')).toHaveTextContent('GEO 统计失败');
  const previousRequests = metricRequests;
  fireEvent.click(within(metricState).getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(metricRequests).toBeGreaterThan(previousRequests));
});
