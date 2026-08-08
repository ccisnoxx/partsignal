/** 验证 GEO 人工观测写入、历史空值和记录页服务端查询。 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { ThemeProvider } from '../../app/ThemeProvider';
import { setCsrfToken } from '../../shared/api/client';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';
import { GeoObservationsPage } from './GeoObservationsPage';

const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '21000000-0000-4000-8000-000000000001';
const publicationId = '30000000-0000-4000-8000-000000000001';
const secondPublicationId = '30000000-0000-4000-8000-000000000002';
const evidenceFileId = '50000000-0000-4000-8000-000000000001';

vi.mock('../../shared/components/DirectUpload', () => ({
  DirectUpload: ({ disabled, onUploaded }: { disabled?: boolean; onUploaded: (file: Schema<'FileRecord'>) => void }) => (
    <button
      type="button"
      disabled={disabled}
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
  account_type: 'ENGINEER', is_active: true, must_change_password: false, available_actions: [], revision: 1, created_at: '2026-07-18T00:00:00Z',
  workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER',
  deletion: null,
} satisfies Schema<'User'>;
const adminUser = { ...user, account_type: 'ADMIN' } satisfies Schema<'User'>;

const metrics = {
  legacy_sample_count: 0, legacy_mention_rate: null, legacy_recommendation_rate: null,
  legacy_citation_rate: null, legacy_accuracy_rate: null,
  manual_observation_count: 1, article_result_count: 1, discovered_article_count: 1,
  mentioned_article_count: 1, article_discovery_rate: 1, article_mention_rate: 1, article_accuracy_rate: 1,
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
    published_article_id: publicationId,
    discovered: true,
    mentioned: true,
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
  workflow_stage: 'READY',
  primary_task: 'VIEW_ANALYSIS',
  available_actions: ['CORRECT', 'DELETE'],
  created_at: '2026-07-20T10:05:00Z',
} satisfies Schema<'ManualGeoObservation'>;

const historicalManualRecord = {
  ...manualRecord,
  id: '40000000-0000-4000-8000-000000000002',
  query_topic_id: null,
  workflow_stage: 'INCOMPLETE',
  primary_task: 'CORRECT_OBSERVATION',
  article_results: manualRecord.article_results.map((item) => ({
    ...item,
    discovered: null,
    mentioned: null,
    accuracy: null,
  })),
} satisfies Schema<'ManualGeoObservation'>;

const correctionRecord = {
  ...manualRecord,
  id: '40000000-0000-4000-8000-000000000003',
  attachment_file_ids: [],
  article_results: [
    ...manualRecord.article_results,
    {
      published_article_id: secondPublicationId,
      discovered: false,
      mentioned: true,
      accuracy: 'PARTIAL',
      title: 'PS-001 进阶文章',
      platform_name: '工程师社区',
      final_url: 'https://community.example.invalid/ps-001-advanced',
    },
  ],
} satisfies Schema<'ManualGeoObservation'>;

const topic = {
  id: topicId,
  canonical_question: 'PS-001 的替代选型有哪些？',
  intent_type: 'REPLACEMENT',
  variants: ['PS-001 如何替代？'],
  available_actions: ['UPDATE'],
  deletion: null,
  primary_task: 'USE_FOR_OBSERVATION',
  revision: 0,
  created_at: '2026-07-18T00:00:00Z',
} satisfies Schema<'QueryTopic'>;

async function findVisibleOption(optionName: string) {
  return waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content',
    )].find((item) => item.textContent === optionName);
    expect(match).toBeDefined();
    return match!;
  });
}

async function choose(comboboxName: string, optionName: string) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('人工观测弹窗未渲染');
  const combobox = within(dialog).getByLabelText(comboboxName);
  fireEvent.mouseDown(combobox);
  fireEvent.click(await findVisibleOption(optionName));
}

function renderPage() {
  return render(
    <ThemeProvider>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/observations" element={<GeoObservationsPage />} />
              <Route path="/observations/:observationId/correct" element={<GeoObservationsPage />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ThemeProvider>,
  );
}

beforeEach(() => setCsrfToken('x'.repeat(32)));
afterEach(() => setCsrfToken(null));

test('独立提交提及和准确性且不上传截图，服务端失败时保留表单', async () => {
  window.history.pushState({}, '', '/observations');
  let createRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: { ...metrics, manual_observation_count: 0, article_result_count: 0, discovered_article_count: 0, mentioned_article_count: 0, article_discovery_rate: null, article_mention_rate: null, article_accuracy_rate: null } satisfies Schema<'GeoMetrics'> };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'GET') return { body: { items: [], page: 1, page_size: 20, total: 0 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [{ id: productId, part_number: 'PS-001', brand: 'PartSignal', category: 'MCU', status: 'ACTIVE', workflow_stage: 'FACT_APPROVED', primary_task: 'CREATE_CONTENT_TASK', available_actions: ['UPDATE'], deletion: null, revision: 0, created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z', fact_status: 'APPROVED', current_fact: { version: 1, status: 'APPROVED' } }], page: 1, page_size: 100, total: 1 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/geo-observation-publications')) return { body: { items: [{ published_article_id: publicationId, title: 'PS-001 选型文章', platform_name: '工程师社区', final_url: 'https://community.example.invalid/ps-001', status: 'COMPLETED' }] } satisfies Schema<'GeoPublicationCandidateList'> };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'POST') {
      createRequest = request;
      return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: '观测事实校验失败', request_id: 'geo-create-failed' } } };
    }
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  const page = within(await waitFor(() => {
    const root = document.querySelector<HTMLElement>('.geo-observation-page');
    expect(root).not.toBeNull();
    return root!;
  }));
  expect(await page.findByRole('heading', { name: 'GEO 观测' })).toBeInTheDocument();
  expect(await page.findByText('当前筛选范围暂无观测记录')).toBeInTheDocument();
  fireEvent.click(page.getByRole('button', { name: /新建观测/ }));
  const dialog = await screen.findByRole('dialog');
  const form = within(dialog);
  expect(form.getByText('登记人工观测')).toBeInTheDocument();
  expect(form.queryByText('启用联网搜索')).not.toBeInTheDocument();

  await choose('产品', 'PartSignal PS-001');
  await choose('问题主题', topic.canonical_question);
  expect(await form.findByText('PS-001 选型文章')).toBeInTheDocument();
  expect(form.getByRole('link', { name: '查看文章' })).toHaveAttribute('href', 'https://community.example.invalid/ps-001');
  fireEvent.change(form.getByRole('textbox', { name: '人工搜索平台' }), { target: { value: 'DeepSeek' } });
  fireEvent.change(form.getByRole('textbox', { name: '实际搜索词' }), { target: { value: 'PS-001 如何替代？' } });

  expect(form.getByRole('checkbox', { name: '是否发现：PS-001 选型文章' })).not.toBeChecked();
  fireEvent.click(form.getByRole('checkbox', { name: '是否提及：PS-001 选型文章' }));
  await choose('准确性：PS-001 选型文章', '部分准确');
  expect(form.getByText('截图用于补充真实搜索结果证据；系统不会自动解析或联网复查。')).toBeInTheDocument();

  fireEvent.click(form.getByRole('button', { name: /追加观测记录/ }));
  expect(await form.findByText('观测事实校验失败')).toBeInTheDocument();
  expect(dialog).toBeInTheDocument();
  expect(form.getByRole('textbox', { name: '实际搜索词' })).toHaveValue('PS-001 如何替代？');
  await waitFor(() => expect(createRequest).toBeInstanceOf(Request));
  await expect(createRequest!.clone().json()).resolves.toMatchObject({
    product_id: productId,
    query_topic_id: topicId,
    search_platform: 'DeepSeek',
    search_query: 'PS-001 如何替代？',
    attachment_file_ids: [],
    article_results: [{
      published_article_id: publicationId,
      discovered: false,
      mentioned: true,
      accuracy: 'PARTIAL',
    }],
  });
}, 60_000);

test('筛选、排序和清除操作写入 URL 并请求服务端', async () => {
  window.history.pushState({}, '', '/observations?article_recommendation=RECOMMENDED');
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

  renderPage();
  const page = within(await waitFor(() => {
    const root = document.querySelector<HTMLElement>('.geo-observation-page');
    expect(root).not.toBeNull();
    return root!;
  }));
  expect(await page.findByText('PS-001 如何替代？')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '分析洞察' })).toHaveLength(1);
  expect(page.queryByRole('button', { name: /导出/ })).not.toBeInTheDocument();
  await waitFor(() => expect(window.location.search).not.toContain('article_recommendation'));

  const filters = page.getByRole('search', { name: '观测记录筛选' });
  const discoveryFilter = within(within(filters).getByText('是否发现').closest('label')!).getByRole('combobox');
  fireEvent.mouseDown(discoveryFilter);
  fireEvent.click(await findVisibleOption('已发现'));
  await waitFor(() => expect(listQueries.some((query) => query.get('discovered') === 'true')).toBe(true));

  fireEvent.click(page.getByRole('switch', { name: '仅看我的记录' }));
  await waitFor(() => expect(listQueries.some((query) => query.get('only_mine') === 'true')).toBe(true));
  expect(window.location.search).toContain('only_mine=true');

  fireEvent.click(page.getByRole('button', { name: /观测时间/ }));
  await waitFor(() => expect(listQueries.some((query) => query.get('sort_order') === 'ASC')).toBe(true));
  expect(window.location.search).toContain('sort_order=ASC');

  fireEvent.click(page.getByRole('button', { name: '清除筛选' }));
  await waitFor(() => expect(window.location.search).toBe('?all_time=true'));
  await waitFor(() => expect(listQueries.some((query) => !query.has('date_from') && !query.has('date_to'))).toBe(true));
});

test('服务端允许时经二次确认删除人工观测完整更正链', async () => {
  window.history.pushState({}, '', '/observations');
  let deleted = false;
  let deleteRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: adminUser };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: deleted ? { ...metrics, manual_observation_count: 0, article_result_count: 0, discovered_article_count: 0, mentioned_article_count: 0, article_discovery_rate: null, article_mention_rate: null, article_accuracy_rate: null } : metrics };
    if (url.pathname === `/api/v1/geo-observations/${manualRecord.id}` && request.method === 'DELETE') {
      deleted = true;
      deleteRequest = request;
      return { body: {} };
    }
    if (url.pathname.endsWith('/geo-observations') && request.method === 'GET') {
      return { body: { items: deleted ? [] : [manualRecord], page: 1, page_size: 20, total: deleted ? 0 : 1 } satisfies Schema<'GeoObservationList'> };
    }
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [] } satisfies Schema<'QueryTopicList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  const more = await screen.findByRole('button', { name: `更多操作：${manualRecord.id}` });
  fireEvent.click(more);
  await userEvent.click(await screen.findByRole('menuitem', { name: /删除完整更正链/ }));
  const confirm = await screen.findByRole('dialog');
  expect(within(confirm).getByText('当前人工观测及其全部历史更正会一并删除；失去全部引用的证据文件将进入清理。此操作不可恢复。')).toBeInTheDocument();
  expect(within(confirm).queryByText(/物理删除/)).not.toBeInTheDocument();
  await userEvent.click(within(confirm).getByRole('button', { name: '删除完整更正链' }));

  await waitFor(() => expect(deleteRequest).toBeInstanceOf(Request));
  expect(deleteRequest!.headers.get('X-CSRF-Token')).toBe('x'.repeat(32));
  expect(await screen.findByText('人工观测完整更正链已删除')).toBeInTheDocument();
  expect(await screen.findByText('当前筛选范围暂无观测记录')).toBeInTheDocument();
});

test('更正完整预填原观测且只修改一个逐篇字段', async () => {
  window.history.pushState({}, '', `/observations/${correctionRecord.id}/correct`);
  let correctionRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname === `/api/v1/geo-observations/${correctionRecord.id}`) return { body: correctionRecord };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'POST') {
      correctionRequest = request;
      return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: '测试保留更正表单', request_id: 'geo-correction-failed' } } };
    }
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [correctionRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  const dialog = await screen.findByRole('dialog');
  const form = within(dialog);
  expect(form.getByRole('checkbox', { name: '是否发现：PS-001 选型文章' })).toBeChecked();
  expect(form.getByRole('checkbox', { name: '是否提及：PS-001 选型文章' })).toBeChecked();
  expect(form.getByRole('checkbox', { name: '是否发现：PS-001 进阶文章' })).not.toBeChecked();
  expect(form.getByRole('checkbox', { name: '是否提及：PS-001 进阶文章' })).toBeChecked();
  expect(form.getByRole('textbox', { name: '实际搜索词' })).toHaveValue(correctionRecord.search_query);
  expect(form.getByRole('textbox', { name: '人工备注' })).toHaveValue(correctionRecord.notes);
  const testedAt = form.getByLabelText('观测时间') as HTMLInputElement;
  expect(new Date(testedAt.value).getTime()).toBe(new Date(correctionRecord.tested_at).getTime());

  const discoveredCheckbox = form.getByRole('checkbox', { name: '是否发现：PS-001 选型文章' });
  await waitFor(() => expect(discoveredCheckbox).toBeEnabled());
  await userEvent.click(discoveredCheckbox.closest('label')!);
  expect(form.getByRole('checkbox', { name: '是否发现：PS-001 选型文章' })).not.toBeChecked();
  await userEvent.click(form.getByRole('button', { name: /追加更正记录/ }));
  await waitFor(() => expect(correctionRequest).toBeInstanceOf(Request));
  await expect(correctionRequest!.clone().json()).resolves.toMatchObject({
    product_id: correctionRecord.product_id,
    query_topic_id: correctionRecord.query_topic_id,
    search_platform: correctionRecord.search_platform,
    search_query: correctionRecord.search_query,
    tested_at: new Date(correctionRecord.tested_at).toISOString(),
    notes: correctionRecord.notes,
    supersedes_id: correctionRecord.id,
    attachment_file_ids: [],
    article_results: [
      {
        published_article_id: publicationId,
        discovered: false,
        mentioned: true,
        accuracy: 'ACCURATE',
      },
      {
        published_article_id: secondPublicationId,
        discovered: false,
        mentioned: true,
        accuracy: 'PARTIAL',
      },
    ],
  });
});

test('服务端未投影 CORRECT 时更正表单、上传和提交统一禁用', async () => {
  const readOnlyRecord = { ...correctionRecord, available_actions: [] } satisfies Schema<'ManualGeoObservation'>;
  window.history.pushState({}, '', `/observations/${readOnlyRecord.id}/correct`);
  let correctionRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname === `/api/v1/geo-observations/${readOnlyRecord.id}`) return { body: readOnlyRecord };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'POST') {
      correctionRequest = request;
      return { body: readOnlyRecord };
    }
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [readOnlyRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByText('当前记录不可更正')).toBeInTheDocument();
  expect(dialog.getByRole('textbox', { name: '人工备注' })).toBeDisabled();
  expect(dialog.getByRole('button', { name: '选择测试证据' })).toBeDisabled();
  const submit = dialog.getByRole('button', { name: /追加更正记录/ });
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(correctionRequest).toBeUndefined();
});

test('补采前历史追加更正允许选择真实问题主题', async () => {
  window.history.pushState({}, '', `/observations/${historicalManualRecord.id}/correct`);
  let correctionRequest: Request | undefined;
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: metrics };
    if (url.pathname === `/api/v1/geo-observations/${historicalManualRecord.id}`) return { body: historicalManualRecord };
    if (url.pathname.endsWith('/geo-observations') && request.method === 'POST') {
      correctionRequest = request;
      return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: '测试保留更正表单', request_id: 'geo-correction-failed' } } };
    }
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [historicalManualRecord], page: 1, page_size: 20, total: 1 } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/query-topics')) return { body: { items: [topic] } satisfies Schema<'QueryTopicList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [], page: 1, page_size: 100, total: 0 } satisfies Schema<'ProductList'> };
    if (url.pathname === `/api/v1/files/${evidenceFileId}`) return { body: {
      id: evidenceFileId, category: 'OPERATION_SCREENSHOT', original_filename: 'geo-evidence.png',
      object_key: 'test/geo-evidence.png', content_type: 'image/png', size: 12, sha256: 'a'.repeat(64),
      access_level: 'INTERNAL', status: 'VERIFIED', created_at: '2026-07-20T10:00:00Z', verified_at: '2026-07-20T10:00:01Z',
    } satisfies Schema<'FileRecord'> };
    if (url.pathname === `/api/v1/files/${evidenceFileId}/download-url`) return { body: { url: 'https://files.example.invalid/geo-evidence.png', expires_at: '2026-07-20T11:00:00Z' } satisfies Schema<'SignedUrl'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  renderPage();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('更正人工观测')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '问题主题' })).toBeEnabled();
  await choose('问题主题', topic.canonical_question);
  await waitFor(() => expect(screen.getByRole('combobox', { name: '问题主题' }).parentElement).toHaveAttribute('title', topic.canonical_question));
  expect(await within(dialog).findByText('已有证据截图（1）')).toBeInTheDocument();
  await waitFor(() => expect(dialog.querySelector('img[alt="geo-evidence.png"]')).toBeInTheDocument());
  fireEvent.click(within(dialog).getByRole('button', { name: /追加更正记录/ }));
  expect(await within(dialog).findByText('请选择是否发现')).toBeInTheDocument();
  expect(within(dialog).getByText('请选择是否提及')).toBeInTheDocument();
  expect(correctionRequest).toBeUndefined();
  await choose('是否发现：PS-001 选型文章', '否');
  await waitFor(() => {
    expect(within(dialog).getByRole('combobox', { name: '是否发现：PS-001 选型文章' }).parentElement)
      .toHaveAttribute('title', '否');
  });
  await choose('是否提及：PS-001 选型文章', '否');
  await waitFor(() => {
    expect(within(dialog).getByRole('combobox', { name: '是否发现：PS-001 选型文章' }).parentElement)
      .toHaveAttribute('title', '否');
    expect(within(dialog).getByRole('combobox', { name: '是否提及：PS-001 选型文章' }).parentElement)
      .toHaveAttribute('title', '否');
  });
  await userEvent.click(within(dialog).getByRole('button', { name: /追加更正记录/ }));
  await waitFor(() => expect(correctionRequest).toBeInstanceOf(Request));
  await expect(correctionRequest!.clone().json()).resolves.toMatchObject({
    supersedes_id: historicalManualRecord.id,
    attachment_file_ids: [],
    article_results: [{ published_article_id: publicationId, discovered: false, mentioned: false, accuracy: null }],
  });
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

  renderPage();
  const page = within(await waitFor(() => {
    const root = document.querySelector<HTMLElement>('.geo-observation-page');
    expect(root).not.toBeNull();
    return root!;
  }));
  fireEvent.click(await page.findByRole('button', { name: 'PS-001 如何替代？' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('该记录存在补采前未采集事实；未知值保持未知，不按“否”推断。')).toBeInTheDocument();
  expect(within(dialog).getAllByText('历史未采集').length).toBeGreaterThanOrEqual(3);
  expect(within(dialog).getByText('未判断')).toBeInTheDocument();
  expect(within(dialog).queryByText('历史回答摘要')).not.toBeInTheDocument();
  expect(within(dialog).getByText('引用部分参数与原文一致。')).toBeInTheDocument();
  await waitFor(() => expect(dialog.querySelector('img[alt="geo-evidence.png"]')).toBeInTheDocument());
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

  renderPage();
  expect(await screen.findByRole('heading', { name: 'GEO 观测' })).toBeInTheDocument();
  expect(await screen.findByText('PS-001 如何替代？')).toBeInTheDocument();
  const metricState = await screen.findByRole('region', { name: 'GEO 观测统计' });
  expect(await within(metricState).findByRole('alert')).toHaveTextContent('GEO 统计失败');
  const previousRequests = metricRequests;
  fireEvent.click(within(metricState).getByRole('button', { name: /重\s*试/ }));
  await waitFor(() => expect(metricRequests).toBeGreaterThan(previousRequests));
});
