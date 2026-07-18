/** 验证 GEO 新登记只使用产品、人工搜索条件和逐篇文章结果。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { mockFetch } from '../../test/fetchMock';

const productId = '20000000-0000-4000-8000-000000000001';
const user = {
  id: '10000000-0000-4000-8000-000000000001', username: 'engineer', display_name: '工程师',
  account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: '2026-07-18T00:00:00Z',
} satisfies Schema<'User'>;

test('选择产品后逐篇登记人工搜索结果', async () => {
  window.history.pushState({}, '', '/observations');
  mockFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/auth/me')) return { body: user };
    if (url.pathname.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (url.pathname.endsWith('/geo-metrics')) return { body: { sample_count: 0, mention_rate: 0, recommendation_rate: 0, citation_rate: 0, accuracy_rate: null, manual_observation_count: 0, article_result_count: 0, recommended_article_count: 0, not_recommended_article_count: 0, article_recommendation_rate: null } satisfies Schema<'GeoMetrics'> };
    if (url.pathname.endsWith('/geo-observations')) return { body: { items: [] } satisfies Schema<'GeoObservationList'> };
    if (url.pathname.endsWith('/products')) return { body: { items: [{ id: productId, part_number: 'PS-001', brand: 'PartSignal', category: 'MCU', status: 'ACTIVE', revision: 0, created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z' }], page: 1, page_size: 100, total: 1 } satisfies Schema<'ProductList'> };
    if (url.pathname.endsWith('/geo-observation-publications')) return { body: { items: [{ publication_record_id: '30000000-0000-4000-8000-000000000001', title: 'PS-001 选型文章', platform_name: '工程师社区', final_url: 'https://community.example.invalid/ps-001', status: 'VERIFIED' }] } satisfies Schema<'GeoPublicationCandidateList'> };
    throw new Error(`未声明的测试请求：${request.method} ${url.pathname}`);
  });

  render(<App />);
  expect(await screen.findByRole('heading', { name: 'GEO 观测' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /登记观测/ }));
  expect(await screen.findByRole('dialog', { name: '登记 GEO 观测' })).toBeInTheDocument();
  expect(screen.queryByLabelText('目标问题')).not.toBeInTheDocument();
  expect(screen.queryByText('启用联网搜索')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('combobox', { name: '产品' }));
  await userEvent.click(await screen.findByText('PartSignal PS-001'));
  expect(await screen.findByText('PS-001 选型文章')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看文章' })).toHaveAttribute('href', 'https://community.example.invalid/ps-001');
  await userEvent.click(screen.getByRole('combobox', { name: '文章推荐结果：PS-001 选型文章' }));
  await userEvent.click(await screen.findByRole('option', { name: '已推荐' }));
  expect(screen.getByText('至少上传一张真实搜索结果截图；系统不会自动解析或联网复查。')).toBeInTheDocument();
});
