/** GEO-307：真实 DB/API/本地文件服务；目标业务写入全部经过运行中心。 */
import { randomInt, createHash } from 'node:crypto';
import { expect, test, type APIResponse, type Response } from '@playwright/test';
import { defaultParseSearch } from '@tanstack/react-router';
import type { components } from '../../src/shared/api/generated/schema';
import {
  createAuthTrafficScope,
  createRealStackRuntimeAudit,
  trafficExpectationErrors,
  type RuntimeCancellation,
  type TrafficExpectation,
} from './real-stack-runtime';
import { registerCurrentRealStackCookies, registerRealStackLoginSecrets } from './real-stack-session';
const api = process.env.PARTSIGNAL_E2E_API_BASE_URL ?? 'http://127.0.0.1:8000';
const apiOrigin = new URL(api).origin;
const runs = '/api/v1/geo/observation-runs';
const batches = '/api/v1/geo/observation-batches';
const plans = '/api/v1/geo/monitoring-plans';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
  'base64',
);
test.skip(process.env.PARTSIGNAL_E2E_REAL_STACK !== '1', '只由隔离真实栈入口运行');
test.setTimeout(150_000);
test.use({ trace: 'off', video: 'off' });
test.afterEach(async ({ context }) => registerCurrentRealStackCookies(context, api));
async function body<T>(response: APIResponse | Response, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
test('人工批次三次采样、URL、dirty、草稿刷新、截图、引用与不可变详情', async ({ page }, testInfo) => {
  // 每次覆盖数字形式的搜索词，避免只在随机 UUID 恰好像 JSON 数字时发现回归。
  const suffix = randomInt(10_000_000, 100_000_000).toString();
  const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('真实栈必须提供管理员验收密码');
  const auth = await body<components['schemas']['AuthSession']>(
    await page.request.post(`${api}/api/v1/auth/login`, { data: { username: 'admin', password } }),
  );
  await registerRealStackLoginSecrets(page.context(), api, auth.csrf_token);
  const headers = { 'X-CSRF-Token': auth.csrf_token };
  // API 仅准备已由先行任务验收的配置；批次、草稿、上传、提交通过本任务 UI。
  const subject = await body<components['schemas']['GeoSubjectOut']>(
    await page.request.post(`${api}/api/v1/geo/subjects`, {
      headers,
      data: {
        subject_type: 'REFERENCE_PART',
        canonical_name: `GEO307 ${suffix}`,
        display_name: `GEO307 ${suffix}`,
        parent_subject_id: null,
        description: '',
      },
    }),
    201,
  );
  const surface = await body<components['schemas']['GeoEngineSurfaceRead']>(
    await page.request.post(`${api}/api/v1/geo/engine-surfaces`, {
      headers,
      data: {
        name: `GEO307 ${suffix}`,
        slug: `geo307-${suffix}`,
        surface_kind: 'CONSUMER_UI',
        provider_brand: 'CUSTOM',
        website_url: null,
        compliance_status: 'APPROVED',
        capabilities: {
          answer_text: true,
          citations: true,
          web_search_signal: true,
          model_version: false,
          usage: false,
          cost: false,
        },
      } satisfies components['schemas']['GeoEngineSurfaceCreate'],
    }),
    201,
  );
  await body(
    await page.request.post(`${api}/api/v1/geo/engine-surfaces/${surface.summary.id}/enable`, {
      headers,
      data: { expected_revision: surface.summary.revision },
    }),
  );
  const profile = await body<components['schemas']['GeoCollectionProfileRead']>(
    await page.request.post(`${api}/api/v1/geo/collection-profiles`, {
      headers,
      data: {
        name: `GEO307 ${suffix}`,
        engine_surface_id: surface.summary.id,
        collection_mode: 'MANUAL',
        adapter_key: 'manual',
        language_code: 'zh-CN',
        region_code: 'CN',
        ai_channel_id: null,
        ai_model_id: null,
        login_state: 'ANONYMOUS',
        web_search_policy: 'UNKNOWN',
        settings: { require_screenshot: true },
      } satisfies components['schemas']['GeoManualProfileCreate'],
    }),
    201,
  );
  await body(
    await page.request.post(`${api}/api/v1/geo/collection-profiles/${profile.summary.id}/enable`, {
      headers,
      data: { expected_revision: profile.summary.revision },
    }),
  );
  const topic = await body<components['schemas']['QueryTopic']>(
    await page.request.post(`${api}/api/v1/query-topics`, {
      headers,
      data: {
        canonical_question: `GEO307 冻结问题 ${suffix}`,
        intent_type: 'REPLACEMENT',
        variants: [`GEO307 ${suffix} 是否适合替代？`],
      },
    }),
    201,
  );
  const prompt = await body<components['schemas']['GeoPromptVariantOut']>(
    await page.request.post(`${api}/api/v1/geo/query-topics/${topic.id}/prompt-variants`, {
      headers,
      data: {
        query_topic_id: topic.id,
        prompt_text: `GEO307 完整问题 ${suffix}`,
        mention_mode: 'UNBRANDED',
        priority: 'CORE',
        language_code: 'zh-CN',
        region_code: 'CN',
      } satisfies components['schemas']['GeoPromptVariantCreate'],
    }),
    201,
  );
  const plan = await body<components['schemas']['GeoMonitoringPlanDetail']>(
    await page.request.post(`${api}${plans}`, {
      headers,
      data: {
        name: `GEO307 人工计划 ${suffix}`,
        description: '',
        subjects: [{ subject_id: subject.id, role: 'PRIMARY' }],
        prompt_variant_ids: [prompt.id],
        collection_profile_ids: [profile.summary.id],
        repeat_count: 3,
        schedule_kind: 'MANUAL_ONLY',
        timezone: 'Asia/Shanghai',
        cron_expression: null,
        budget_limit: null,
        rule_set_revision: 1,
      } satisfies components['schemas']['GeoMonitoringPlanCreate'],
    }),
    201,
  );
  let phase = 'open';
  const expectations: TrafficExpectation[] = [];
  const cancellations: RuntimeCancellation[] = [
    { phase: 'batch', method: 'GET', origin: apiOrigin, pathname: runs, reason: 'net::ERR_ABORTED' },
  ];
  const audit = createRealStackRuntimeAudit({ apiOrigin, getPhase: () => phase, allowedCancellations: cancellations });
  audit.watch(page);
  // Chromium 的204空响应可能随后报 ERR_ABORTED；仅在确实收到唯一204后精确记录此现象。
  // 下方仍严格验证PUT一次、complete成功、实际图片和服务端SHA，不接受没有响应的写取消。
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      response.status() === 204 &&
      response.request().method() === 'PUT' &&
      url.origin === apiOrigin &&
      /^\/api\/v1\/files\/[0-9a-f-]+\/content$/.test(url.pathname)
    ) {
      cancellations.push({
        phase,
        method: 'PUT',
        origin: apiOrigin,
        pathname: url.pathname,
        reason: 'net::ERR_ABORTED',
      });
    }
  });
  const write = async <T>(
    next: string,
    method: string,
    pathname: string,
    action: () => Promise<unknown>,
    status = 200,
  ) => {
    await page.waitForLoadState('networkidle');
    phase = next;
    expectations.push({ phase, method, pathname, origin: apiOrigin, attempts: 1, responses: 1, status });
    const response = page.waitForResponse(
      (item) => item.request().method() === method && new URL(item.url()).pathname === pathname,
    );
    await action();
    return body<T>(await response, status);
  };
  await page.goto('/geo/runs');
  await page.getByRole('button', { name: '创建运行批次', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索可选计划' }).fill(suffix);
  await page.getByRole('button', { name: '搜索计划', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`GEO307 人工计划 ${suffix} · Revision`) }).click();
  const created = await write<components['schemas']['GeoBatchCreated']>(
    'batch',
    'POST',
    `${plans}/${plan.id}/run`,
    () => page.getByRole('button', { name: '确认创建批次' }).click(),
    201,
  );
  const batchId = created.batch_id;
  await expect(page).toHaveURL(new RegExp(`batch_id=${batchId}`));
  await page.getByRole('textbox', { name: '搜索冻结问题' }).fill(suffix);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await page.getByRole('combobox', { name: '采集方式', exact: true }).click();
  await page.getByRole('option', { name: '人工录入', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索冻结问题' })).toHaveValue(suffix);
  await expect(page.getByRole('combobox', { name: '采集方式', exact: true })).toContainText('人工录入');
  const ids = (
    await body<components['schemas']['GeoRunListPage']>(await page.request.get(`${api}${runs}?batch_id=${batchId}`))
  ).items.map((run) => run.id);
  expect(ids).toHaveLength(3);
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    await page
      .getByRole('row')
      .filter({ has: page.getByText(id, { exact: true }) })
      .getByRole('button', { name: '人工录入', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: '回答原文', exact: true })).toBeVisible();
    const answer = `人工回答 ${index + 1} ${suffix}\n<script>window.__geoUnsafe = true</script>`;
    await page.getByRole('textbox', { name: '回答原文', exact: true }).fill(answer);
    await page.getByRole('textbox', { name: '实际采集时间', exact: true }).fill(new Date().toISOString());
    if (index === 0) {
      await page.getByRole('button', { name: '添加引用', exact: true }).click();
      await page.getByRole('textbox', { name: '引用 1 URL', exact: true }).fill('https://EXAMPLE.test/spec#first');
      await page.getByRole('textbox', { name: '引用 1 标题', exact: true }).fill('原始参考来源');
      await page.getByRole('button', { name: '添加引用', exact: true }).click();
      await page.getByRole('textbox', { name: '引用 2 URL', exact: true }).fill('https://example.test/spec#second');
      await page.getByRole('spinbutton', { name: '引用 2 位置', exact: true }).fill('3');
      await page.getByRole('button', { name: '关闭运行详情', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: '继续编辑', exact: true }).click();
      await write(`draft-${index}`, 'PUT', `${runs}/${id}/manual-draft`, () =>
        page.getByRole('button', { name: '保存人工草稿', exact: true }).click(),
      );
      await expect(page.getByRole('button', { name: '保存人工草稿', exact: true })).toBeDisabled();
      await page.reload();
      await expect(page.getByRole('textbox', { name: '回答原文', exact: true })).toHaveValue(answer);
      await expect(page.getByRole('textbox', { name: '引用 2 URL', exact: true })).toHaveValue(
        'https://example.test/spec#second',
      );
      expect(new URL(page.url()).searchParams.get('batch_id')).toBe(batchId);
      // 数字形式的字符串会被 Router 以 JSON 引号编码，验收解析后的 URL 状态。
      expect(defaultParseSearch(new URL(page.url()).search)).toMatchObject({ q: suffix });
    }
    if (index === 0) {
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await expect(page.getByRole('button', { name: '正式提交人工观测', exact: true })).toBeVisible();
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('2');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.getByRole('textbox', { name: '回答原文', exact: true }).focus();
      await expect(page.getByRole('textbox', { name: '回答原文', exact: true })).toBeFocused();
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
      await page.screenshot({ path: testInfo.outputPath('geo307-manual-editor.png'), fullPage: true });
    }
    const intent = await write<components['schemas']['UploadIntent']>(
      `upload-${index}`,
      'POST',
      '/api/v1/files/upload-intents',
      () =>
        page
          .getByLabel('上传人工采集截图', { exact: true })
          .setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: png }),
      201,
    );
    // 上传的传输和 complete 由组件连续执行，仅声明确实发出的 API 写入。
    expectations.push({
      phase,
      method: 'PUT',
      origin: apiOrigin,
      pathname: `/api/v1/files/${intent.file.id}/content`,
      attempts: 1,
      responses: 1,
      status: 204,
    });
    expectations.push({
      phase,
      method: 'POST',
      origin: apiOrigin,
      pathname: `/api/v1/files/${intent.file.id}/complete`,
      attempts: 1,
      responses: 1,
      status: 200,
    });
    await expect(page.getByText(`已校验截图：${intent.file.id}`, { exact: true })).toBeVisible();
    await write(`draft-file-${index}`, 'PUT', `${runs}/${id}/manual-draft`, () =>
      page.getByRole('button', { name: '保存人工草稿', exact: true }).click(),
    );
    await expect(page.getByRole('button', { name: '保存人工草稿', exact: true })).toBeDisabled();
    if (index === 0) {
      await page.reload();
      await expect(page.getByText(`已校验截图：${intent.file.id}`, { exact: true })).toBeVisible();
    }
    const receipt = await write<components['schemas']['GeoManualObservationSubmitted']>(
      `submit-${index}`,
      'POST',
      `${runs}/${id}/manual-submit`,
      () => page.getByRole('button', { name: '正式提交人工观测', exact: true }).click(),
      201,
    );
    expect(receipt.answer_sha256).toBe(createHash('sha256').update(answer).digest('hex'));
    expect(receipt.analysis_dispatch).toBe('NOT_IMPLEMENTED');
    await expect(page.getByRole('region', { name: '运行详情', exact: true })).toBeVisible();
    const region = page.getByRole('region', { name: '运行详情', exact: true });
    await expect(region.getByText(answer, { exact: true })).toBeVisible();
    await expect(region.getByRole('img', { name: '人工采集截图证据' })).toBeVisible();
    await expect
      .poll(() => region.getByRole('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => '__geoUnsafe' in window)).toBe(false);
    if (index === 0) {
      await expect(region.getByText('1 / 1, 3', { exact: true })).toBeVisible();
      await expect(region.getByRole('link', { name: '原始参考来源' })).toHaveAttribute(
        'href',
        'https://example.test/spec',
      );
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: '关闭运行详情', exact: true }).click();
    await page.waitForLoadState('networkidle');
  }
  // R4 的后台分析以实际完成投影验收，不能要求瞬时 COLLECTED 持续不变。
  await expect.poll(async () => (await body<components['schemas']['GeoBatchDetail']>(
    await page.request.get(`${api}${batches}/${batchId}`),
  )).summary.status_counts.completed, { timeout: 90_000 }).toBe(3);
  const final = await body<components['schemas']['GeoBatchDetail']>(
    await page.request.get(`${api}${batches}/${batchId}`),
  );
  expect(final.summary.pending_manual_count).toBe(0);
  expect(final.summary.status_counts.collected).toBe(0);
  expect(final.summary.status_counts.completed).toBe(3);
  expect(final.summary.cost.unknown_attempt_count).toBe(3);
  await page.getByRole('button', { name: '批次视图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '运行中心', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(
    trafficExpectationErrors(audit.attempts, audit.responses, expectations, createAuthTrafficScope(apiOrigin)),
  ).toEqual([]);
  expect(audit.errors).toEqual([]);
});
