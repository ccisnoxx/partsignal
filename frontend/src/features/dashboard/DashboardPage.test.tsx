/** 验证工作台严格使用契约统计，不从列表自行拼接第二份指标。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import type { Schema } from '../../shared/api/types';
import { api } from '../../shared/api/client';
import { mockFetch } from '../../test/fetchMock';

const user = {
  id: '10000000-0000-4000-8000-000000000001', username: 'reviewer', display_name: '审核员',
  account_type: 'ENGINEER', is_active: true, must_change_password: false, revision: 1, created_at: '2026-07-10T00:00:00Z',
} satisfies Schema<'User'>;

test('展示服务端待办和 GEO 指标', async () => {
  window.history.pushState({}, '', '/');
  mockFetch((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/auth/me')) return { body: user };
    if (path.endsWith('/auth/csrf')) return { body: { csrf_token: 'x'.repeat(32) } };
    if (path.endsWith('/dashboard/summary')) return { body: { pending_fact_reviews: 3, pending_content_reviews: 2, pending_publications: 4, publication_attention: 1, recent_accuracy_errors: 0 } satisfies Schema<'DashboardSummary'> };
    if (path.endsWith('/geo-metrics')) return { body: { sample_count: 10, mention_rate: 0.8, recommendation_rate: 0.5, citation_rate: 0.4, accuracy_rate: 0.75 } satisfies Schema<'GeoMetrics'> };
    throw new Error(`未声明的测试请求：${request.method} ${path}`);
  });
  expect((await api.GET('/api/v1/auth/me')).data).toEqual(user);
  render(<App />);
  expect(await screen.findByRole('heading', { name: '今天的内容链路' })).toBeInTheDocument();
  expect(screen.getByText('待审事实')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('待审事实').closest('.metric-tile')).toHaveClass('metric-warning');
  expect(screen.getByText('待人工发布').closest('.metric-tile')).toHaveClass('metric-data');
  expect(screen.getByText('发布需关注').closest('.metric-tile')).toHaveClass('metric-danger');
  expect(screen.getByText('近期准确性问题')).toBeInTheDocument();
  expect(screen.getByText('近期准确性问题').closest('.metric-tile')).toHaveClass('metric-default');
  expect(screen.getByText('当前样本 10 条；无法判断的样本不进入准确率分母。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '打开用户操作菜单' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /修改密码/ }));
  expect(await screen.findByRole('heading', { name: '修改密码' })).toBeInTheDocument();
  expect(screen.getByLabelText('当前密码')).toBeInTheDocument();
});
