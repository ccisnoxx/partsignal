/** CORE-06生产页面；API/Worker状态变化为显式夹具，服务端行为由真实PG另证。 */
import { test, expect } from './fixtures/foundation.fixture';
import {
  detail,
  runId,
  batchId,
  asOf,
} from '../../src/domains/geo-runs/runs.test-support';
import type { components } from '../../src/shared/api/generated/schema';

const firstId = '10000000-0000-4000-8000-000000000030';
const nextId = '10000000-0000-4000-8000-000000000031';
test('管理员键盘发起、目标进展和历史导航保留失败采集与原回答', async ({
  page,
}, info) => {
  const data = detail();
  data.evidence_files = [];
  data.run = {
    ...data.run,
    status: 'FAILED',
    revision: 7,
    collected_at: asOf,
    finished_at: asOf,
    workflow_stage: 'HISTORICAL_FAILURE',
    primary_task: 'VIEW_FAILURE',
    available_actions: [],
    error_stage: 'ANALYSIS',
    error_code: 'ANALYSIS_FAILED',
  };
  const first: components['schemas']['GeoAnalysisResult'] = {
    analysis: {
      id: firstId,
      run_id: runId,
      answer_snapshot_id: batchId,
      revision: 1,
      status: 'FAILED',
      analyzer_type: 'DETERMINISTIC',
      analyzer_version: 'r4-1',
      input_snapshot: {
        schema_version: 1,
        answer_sha256: 'b'.repeat(64),
        subjects: data.run.input_snapshot.subjects,
        fact_versions: [],
        configuration: {
          rule_set_version: '1',
          model_name: null,
          model_version: null,
          prompt_template_version: null,
          prompt_sha256: null,
          parameters: {
            temperature: null,
            top_p: null,
            max_output_tokens: null,
            seed: null,
          },
        },
      },
      input_sha256: 'd'.repeat(64),
      confidence_summary: {
        mentions: null,
        recommendations: null,
        claims: null,
      },
      review_required_reasons: [],
      error_code: 'ANALYSIS_FAILED',
      error_summary: '虚构首次分析失败',
      created_at: asOf,
      finished_at: asOf,
    },
    mentions: [],
    recommendations: [],
    claims: [],
    citations: [],
    citation_classification_complete: false,
  };
  data.analysis = {
    ...data.analysis,
    revisions: [first],
    available_actions: ['REANALYZE'],
  };
  const writes: { body: unknown; headers: Record<string, string> }[] = [];
  let acceptedReads = 0;
  let finished = false;
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.route('**/api/v1/geo/observation-runs**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/reanalyze') && request.method() === 'POST') {
      writes.push({ body: request.postDataJSON(), headers: request.headers() });
      const next = structuredClone(first);
      next.analysis = {
        ...next.analysis,
        id: nextId,
        revision: 2,
        status: 'PENDING',
        finished_at: null,
        error_code: null,
        error_summary: null,
      };
      data.analysis.revisions.unshift(next);
      return route.fulfill({
        json: {
          run_id: runId,
          analysis_revision_id: nextId,
          request_id: request.headers()['x-request-id'],
        } satisfies components['schemas']['GeoRunReanalysisAccepted'],
      });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/api/v1/geo/observation-runs')
      return route.fulfill({
        json: {
          items: [data.run],
          total: 1,
          page: 1,
          page_size: 20,
          as_of: asOf,
        },
      });
    if (url.pathname === `/api/v1/geo/observation-runs/${runId}`) {
      if (writes.length && ++acceptedReads >= 2) {
        data.analysis.revisions[0]!.analysis.status = 'COMPLETED';
        data.analysis.revisions[0]!.analysis.finished_at = asOf;
        data.analysis.selection.current_analysis_revision_id = nextId;
        data.run.revision = 8;
        finished = true;
      }
      return route.fulfill({ json: data });
    }
    return route.fallback();
  });
  await page.goto(`/geo/runs?view=runs&run_id=${runId}`);
  const entry = page.getByRole('button', { name: '显式重新分析' });
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: '确认重新分析' }),
  ).toBeDisabled();
  const reason = page.getByRole('combobox', { name: '重新分析原因' });
  await reason.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: '显式重试失败分析' }).click();
  const submit = page.getByRole('button', { name: '确认重新分析' });
  await submit.focus();
  await page.keyboard.press('Enter');
  const receipt = page.getByRole('region', { name: '本次重新分析回执' });
  await expect(receipt).toBeFocused();
  await expect(receipt.getByText(/目标状态：待处理/)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body).toEqual({
    expected_revision: 7,
    reason: 'RETRY_FAILED',
  });
  expect(writes[0]!.headers['x-csrf-token']).toBe('foundation-csrf');
  expect(writes[0]!.headers['idempotency-key']).toBeUndefined();
  await expect(receipt.getByText('目标状态：已完成 · 当前分析')).toBeVisible({
    timeout: 10_000,
  });
  expect(finished).toBe(true);
  expect(writes).toHaveLength(1);
  const widths =
    info.project.name === 'foundation-mobile' ? [375, 768] : [1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  const historyLink = receipt.getByRole('link', {
    name: '在历史中查看本次分析',
  });
  await historyLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#analysis-revision-${nextId}$`));
  const history = page.locator(`#analysis-revision-${nextId}`);
  await history.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(history.getByText('分析状态 / 完成时间')).toBeVisible();
  expect(data.run.status).toBe('FAILED');
  await expect(
    page
      .getByRole('region', { name: '数据质量与后续导航' })
      .getByText('通用资格：已排除'),
  ).toBeVisible();
  await expect(
    page.getByText(data.answer!.answer_text, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`#analysis-revision-${firstId}`).locator('summary'),
  ).toContainText('FAILED');
  expect(runtimeErrors).toEqual([]);
});
