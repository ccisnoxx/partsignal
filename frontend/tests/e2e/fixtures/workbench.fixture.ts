/** Workbench production artifact 的 generated-type 严格 fixture。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type WorkbenchMode = 'success' | 'empty' | 'error' | 'loading';
type WorkbenchController = {
  requests: URL[];
  releaseLoading: () => void;
  setMode: (mode: WorkbenchMode) => void;
};

const user = {
  id: '00000000-0000-4000-8000-000000000001', username: 'admin', display_name: '系统管理员',
  account_type: 'ADMIN', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1,
  created_at: '2026-08-23T00:00:00Z',
} satisfies components['schemas']['User'];

const ids = Array.from({ length: 6 }, (_, index) => `10000000-0000-4000-8000-00000000000${index + 1}`);
const categories = [
  'FACT_REVIEW', 'CONTENT_REVIEW', 'PUBLICATION_VERIFICATION',
  'PUBLICATION_ACTION', 'CONTENT_ISSUE', 'GEO_ACCURACY_ISSUE',
] as const satisfies readonly components['schemas']['WorkbenchAttentionItem']['category'][];

const aggregate = {
  generated_at: '2026-08-23T08:00:00Z',
  actionable_counts: {
    fact_reviews: { value: 3, href: '/products?workbench=fact-review' },
    content_reviews: { value: 4, href: '/content/tasks?workbench=content-review' },
    publication_verifications: { value: 2, href: '/publishing/work?workbench=verification' },
    publication_actions: { value: 5, links: [
      { label: '处理待开始发布', href: '/publishing/work?workbench=ready' },
      { label: '处理发布失败', href: '/publishing/work?workbench=failed' },
    ] },
    content_issues: { value: 1, href: '/publishing/issues?workbench=open' },
    geo_accuracy_issues: { value: 2, links: [
      { label: '检查准确性异常', href: '/geo/observations?workbench=accuracy' },
      { label: '检查缺失样本', href: '/geo/observations?workbench=missing' },
    ] },
  },
  workflow_health: {
    product_facts: { status: 'CLEAR', summary: '产品事实流程正常' },
    content: { status: 'ATTENTION', summary: '内容审核存在积压' },
    publication: { status: 'ATTENTION', summary: '发布流程需要处理' },
    geo: { status: 'CLEAR', summary: 'GEO 流程正常' },
  },
  geo_summary: {
    window: { date_from: '2026-07-25', date_to: '2026-08-23' },
    discovery_rate: { numerator: 1, denominator: 2, value: 0.5 },
    mention_rate: { numerator: 0, denominator: 2, value: 0 },
    accuracy_rate: { numerator: 0, denominator: 0, value: null },
  },
  recent_attention_items: categories.map((category, index) => ({
    category,
    resource_id: ids[index]!,
    title: `关注事项 ${index + 1}`,
    summary: `服务端摘要 ${index + 1}`,
    occurred_at: `2026-08-23T0${index + 1}:00:00Z`,
    href: `/workbench-target/${index + 1}?canonical=server`,
  })),
} satisfies components['schemas']['WorkbenchAggregate'];

const emptyAggregate = {
  ...aggregate,
  actionable_counts: {
    fact_reviews: { ...aggregate.actionable_counts.fact_reviews, value: 0 },
    content_reviews: { ...aggregate.actionable_counts.content_reviews, value: 0 },
    publication_verifications: { ...aggregate.actionable_counts.publication_verifications, value: 0 },
    publication_actions: { ...aggregate.actionable_counts.publication_actions, value: 0 },
    content_issues: { ...aggregate.actionable_counts.content_issues, value: 0 },
    geo_accuracy_issues: { ...aggregate.actionable_counts.geo_accuracy_issues, value: 0 },
  },
  geo_summary: {
    ...aggregate.geo_summary,
    discovery_rate: { numerator: 0, denominator: 0, value: null },
    mention_rate: { numerator: 0, denominator: 0, value: null },
    accuracy_rate: { numerator: 0, denominator: 0, value: null },
  },
  recent_attention_items: [],
} satisfies components['schemas']['WorkbenchAggregate'];

function errorEnvelope(code: string, message: string, requestId: string) {
  return { error: { code, message, details: {}, request_id: requestId } } satisfies components['schemas']['ErrorEnvelope'];
}

const test = base.extend<{ workbenchApi: WorkbenchController }>({
  workbenchApi: [async ({ page }, use) => {
    let mode: WorkbenchMode = 'success';
    let releaseWorkbench: (() => void) | undefined;
    const requests: URL[] = [];
    const unexpected: string[] = [];
    const runtimeErrors: string[] = [];

    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('503 (Service Unavailable)')) {
        runtimeErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`));

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === 'GET' && url.pathname === '/api/v1/auth/me') return route.fulfill({ status: 200, json: user });
      if (method === 'GET' && url.pathname === '/api/v1/auth/csrf') return route.fulfill({ status: 200, json: { csrf_token: 'workbench-csrf' } satisfies components['schemas']['CsrfToken'] });
      if (method === 'GET' && url.pathname === '/api/v1/workbench') {
        requests.push(url);
        if (mode === 'loading') await new Promise<void>((resolve) => { releaseWorkbench = resolve; });
        if (mode === 'error') return route.fulfill({ status: 503, json: errorEnvelope('WORKBENCH_UNAVAILABLE', '工作台暂不可用', 'req-workbench') });
        return route.fulfill({ status: 200, json: mode === 'empty' ? emptyAggregate : aggregate });
      }
      unexpected.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 501, json: errorEnvelope('UNEXPECTED_API', 'Workbench 发起了未声明请求', 'req-unexpected') });
    });

    await use({
      requests,
      releaseLoading: () => { mode = 'success'; releaseWorkbench?.(); },
      setMode: (nextMode) => { mode = nextMode; },
    });
    expect(unexpected, 'Workbench 不得请求聚合端点以外的业务 API').toEqual([]);
    expect(runtimeErrors, 'Workbench 不得产生运行时错误').toEqual([]);
  }, { auto: true }],
});

export { aggregate, emptyAggregate, expect, test };
