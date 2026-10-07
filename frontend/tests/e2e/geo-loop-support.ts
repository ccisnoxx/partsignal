/** GEO-707 的虚构输入与既有页面旅程；业务状态始终由真实领域服务裁决。 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, type Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, batches, body, detail, runs, uiCommand } from './geo-api-support';

type Schema = components['schemas'];
export const opportunities = '/api/v1/geo/opportunities';
export const sourceEnvironment = {
  source_product: 'GEO707虚构观测产品',
  source_model: 'geo707-fictional-model',
  source_version: 'geo707-fixture-v1',
} as const;

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function enableConfiguration(page: Page, path: string, label: string) {
  await page.getByRole('region', { name: /^(观测面|采集配置)详情$/ }).getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await uiCommand(page, path, () => page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click());
}

export async function loopConfiguration(page: Page, csrfToken: string) {
  const suffix = randomUUID().slice(0, 8);
  const partNumber = `GEO707-${suffix}`;
  const brand = 'GEO707虚构品牌';
  await page.goto('/products/new');
  await page.getByRole('textbox', { name: '产品型号', exact: true }).fill(partNumber);
  await page.getByRole('textbox', { name: '品牌', exact: true }).fill(brand);
  await page.getByRole('textbox', { name: '类别', exact: true }).fill('本地虚构低功耗传感器');
  const product = await uiCommand<Schema['Product']>(page, '/api/v1/products', () => page.getByRole('button', { name: '创建产品', exact: true }).click(), 201);
  await expect(page).toHaveURL(`/products/${product.id}`);
  await page.getByRole('link', { name: '录入事实', exact: true }).click();
  await page.getByRole('textbox', { name: '事实 Markdown', exact: true }).fill(`# ${partNumber}\n\n- 工作电压：3.3 V\n- 数据性质：GEO707 本地虚构验收`);
  await choose(page, '数据级别', '公开');
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/products/${product.id}/facts`);
  await page.getByRole('button', { name: '保存事实', exact: true }).click();
  const draft = await body<Schema['ProductFactsDraft']>(await saved);
  expect(draft.classification).toBe('PUBLIC');
  await page.getByRole('button', { name: '提交事实审核', exact: true }).click();
  const submission = page.getByRole('dialog', { name: '提交事实审核', exact: true });
  await submission.getByRole('textbox', { name: '变更摘要', exact: true }).fill('GEO707 冻结本地虚构公开事实');
  const pendingFact = await uiCommand<Schema['FactVersion']>(page, `/api/v1/products/${product.id}/fact-review-submissions`, () => submission.getByRole('button', { name: '确认提交审核', exact: true }).click(), 201);
  await expect(submission).toBeHidden();
  await page.waitForLoadState('networkidle');
  await page.goto(`/products/${product.id}/facts/review`);
  await page.getByRole('button', { name: '批准事实', exact: true }).click();
  const fact = await uiCommand<Schema['FactVersion']>(page, `/api/v1/fact-versions/${pendingFact.id}/approve`, () => page.getByRole('dialog', { name: /批准事实版本 v\d+？/ }).getByRole('button', { name: '确认批准', exact: true }).click());
  expect(fact).toMatchObject({ status: 'APPROVED', classification: 'PUBLIC' });
  await page.waitForLoadState('networkidle');

  await page.goto('/configuration/geo-entities');
  await page.getByRole('button', { name: '新建监测对象', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索现有产品', exact: true }).fill(partNumber);
  await choose(page, '现有产品', `${brand} ${partNumber}`);
  const subject = await uiCommand<Schema['GeoSubjectOut']>(page, '/api/v1/geo/subjects', () => page.getByRole('button', { name: '创建监测对象', exact: true }).click(), 201);
  expect(subject).toMatchObject({ subject_type: 'OWN_PRODUCT', product_id: product.id });
  await page.waitForLoadState('networkidle');
  await page.goto('/configuration/geo-surfaces');
  await page.getByRole('button', { name: '新建观测面', exact: true }).click();
  await page.getByRole('textbox', { name: '观测面名称', exact: true }).fill(`GEO707 人工观测面 ${suffix}`);
  await page.getByRole('textbox', { name: '观测面标识', exact: true }).fill(`geo707-${suffix}`);
  await choose(page, '合规状态', '已批准');
  const surface = await uiCommand<Schema['GeoEngineSurfaceRead']>(page, '/api/v1/geo/engine-surfaces', () => page.getByRole('button', { name: '创建观测面', exact: true }).click(), 201);
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await enableConfiguration(page, `/api/v1/geo/engine-surfaces/${surface.summary.id}/enable`, '启用观测面');
  await page.getByRole('button', { name: '查看此观测面的采集配置', exact: true }).click();
  await page.getByRole('button', { name: '新建采集配置', exact: true }).click();
  await page.getByRole('textbox', { name: '所属观测面 ID', exact: true }).fill(surface.summary.id);
  const profileName = `GEO707 人工采集 ${suffix}`;
  await page.getByRole('textbox', { name: '采集配置名称', exact: true }).fill(profileName);
  await expect(page.getByRole('combobox', { name: '要求截图', exact: true })).toContainText('是');
  const profile = await uiCommand<Schema['GeoCollectionProfileRead']>(page, '/api/v1/geo/collection-profiles', () => page.getByRole('button', { name: '创建采集配置', exact: true }).click(), 201);
  expect(profile.configuration).toMatchObject({ collection_mode: 'MANUAL', settings: { require_screenshot: true } });
  await page.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await enableConfiguration(page, `/api/v1/geo/collection-profiles/${profile.summary.id}/enable`, '启用采集配置');
  await page.waitForLoadState('networkidle');

  const topicName = `GEO707 虚构低功耗传感器选型 ${suffix}`;
  const promptName = `GEO707 请介绍低功耗传感器的选型方法 ${suffix}`;
  await page.goto('/geo/topics');
  await page.getByRole('button', { name: '创建 Query Topic', exact: true }).click();
  const topicDialog = page.getByRole('dialog', { name: '创建 Query Topic', exact: true });
  await topicDialog.getByRole('textbox', { name: '标准问题', exact: true }).fill(topicName);
  await topicDialog.getByRole('textbox', { name: '变体 1', exact: true }).fill(promptName);
  const topic = await uiCommand<Schema['QueryTopic']>(page, '/api/v1/query-topics', () => topicDialog.getByRole('button', { name: '创建', exact: true }).click(), 201);
  await expect(topicDialog).toBeHidden();
  await page.waitForLoadState('networkidle');
  await page.goto('/geo/questions?new=1');
  await choose(page, '问题主题', topicName);
  await page.getByRole('textbox', { name: '完整问题文本', exact: true }).fill(promptName);
  await choose(page, '点名属性', '非点名');
  await choose(page, '优先级', '核心');
  await page.getByRole('textbox', { name: '语言代码', exact: true }).fill('zh-CN');
  await page.getByRole('textbox', { name: '地区代码', exact: true }).fill('CN');
  const prompt = await uiCommand<Schema['GeoPromptVariantOut']>(page, `/api/v1/geo/query-topics/${topic.id}/prompt-variants`, () => page.getByRole('button', { name: '创建变体', exact: true }).click(), 201);
  expect(prompt).toMatchObject({ mention_mode: 'UNBRANDED', priority: 'CORE' });
  await page.waitForLoadState('networkidle');
  await page.goto('/geo/plans?new=1');
  const planName = `GEO707 五次人工基线 ${suffix}`;
  await page.getByRole('textbox', { name: '计划名称', exact: true }).fill(planName);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索监测对象选项', exact: true }).fill(suffix);
  await choose(page, `选择对象角色：${subject.display_name}`, '主要监测对象');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索问题变体选项', exact: true }).fill(suffix);
  await page.getByRole('button', { name: `选择问题变体：${promptName}`, exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索采集配置选项', exact: true }).fill(suffix);
  await page.getByRole('button', { name: `选择采集配置：${profileName}`, exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('spinbutton', { name: '重复次数', exact: true }).fill('5');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const preview = await uiCommand<Schema['GeoMonitoringPlanPreview']>(page, '/api/v1/geo/monitoring-plans/preview', () => page.getByRole('button', { name: '预览当前配置', exact: true }).click());
  expect(preview).toMatchObject({ run_count: 5, manual_run_count: 5, blockers: [] });
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const plan = await uiCommand<Schema['GeoMonitoringPlanDetail']>(page, '/api/v1/geo/monitoring-plans', () => page.getByRole('button', { name: '创建监测计划', exact: true }).click(), 201);
  expect(plan).toMatchObject({ repeat_count: 5, subjects: [{ subject_id: subject.id, role: 'PRIMARY' }] });
  await page.waitForLoadState('networkidle');

  // 发布平台及账号仅是本闭环的虚构独立前置，发布写入在既有 Workspace 页面执行。
  const headers = { 'X-CSRF-Token': csrfToken };
  const domain = `geo707-${suffix}.example.invalid`;
  const platformType = await body<Schema['PlatformType']>(await page.request.post(`${api}/api/v1/platform-types`, {
    headers, data: { name: `GEO707 ${suffix}`, slug: `geo707-${suffix}` } satisfies Schema['PlatformTypeCreate'],
  }), 201);
  const platform = await body<Schema['PlatformProfile']>(await page.request.post(`${api}/api/v1/platform-profiles`, {
    headers, data: { name: `GEO707 ${suffix}`, slug: `geo707-${suffix}`, platform_type_id: platformType.id, platform_prompt_id: null, allowed_domains: [domain], website_url: `https://${domain}` } satisfies Schema['PlatformProfileCreate'],
  }), 201);
  const account = await body<Schema['PlatformAccount']>(await page.request.post(`${api}/api/v1/platform-accounts`, {
    headers, data: { platform_profile_id: platform.id, label: 'GEO707 虚构发布账号', account_identifier: `geo707-${suffix}` } satisfies Schema['PlatformAccountCreate'],
  }), 201);
  return { suffix, partNumber, product, fact, subject, profile, prompt, plan, planName, platform, account, domain };
}

export async function createLoopBaseline(page: Page, graph: Awaited<ReturnType<typeof loopConfiguration>>) {
  await page.goto('/geo/runs?create=1');
  await page.getByRole('textbox', { name: '搜索可选计划', exact: true }).fill(graph.planName);
  await page.getByRole('button', { name: '搜索计划', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`${graph.planName} · Revision`) }).click();
  const batch = await uiCommand<Schema['GeoBatchCreated']>(page, `/api/v1/geo/monitoring-plans/${graph.plan.id}/run`, () => page.getByRole('button', { name: '确认创建批次', exact: true }).click(), 201);
  expect(batch.requested_run_count).toBe(5);
  await expect(page).toHaveURL(new RegExp(`batch_id=${batch.batch_id}`));
  return batch;
}

export async function submitLoopBatch(page: Page, batchId: string, partNumber: string, phase: 'baseline' | 'retest', allowRead: (path: string) => void) {
  const list = await body<Schema['GeoRunListPage']>(await page.request.get(`${api}${runs}`, { params: { batch_id: batchId } }));
  expect(list.items).toHaveLength(5);
  const observations: Schema['GeoRunDetail'][] = [];
  for (const run of [...list.items].sort((a, b) => a.repeat_index - b.repeat_index)) {
    allowRead(`${runs}/${run.id}`);
    allowRead(`${runs}/${run.id}/manual-entry`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/geo/runs?batch_id=${batchId}&run_id=${run.id}&edit=1`);
    const answer = phase === 'baseline'
      ? '可以先比较安装环境与维护要求，再筛选适合的器件。此回答仅为本地虚构测试。'
      : `推荐顺序：\n1. ${partNumber}。\n此回答仅为本地虚构测试。`;
    const text = page.getByRole('textbox', { name: '回答原文', exact: true });
    await text.fill(answer);
    await page.getByRole('textbox', { name: '来源产品', exact: true }).fill(sourceEnvironment.source_product);
    await page.getByRole('textbox', { name: '来源模型', exact: true }).fill(sourceEnvironment.source_model);
    await page.getByRole('textbox', { name: '来源版本', exact: true }).fill(sourceEnvironment.source_version);
    await choose(page, '实际观察到联网搜索', '否');
    await page.getByRole('textbox', { name: '实际采集时间', exact: true }).fill(new Date().toISOString());
    // 本地虚构回答的真实 PNG 字节走 canonical 上传、摘要和 complete 校验。
    const screenshot = await text.screenshot({ animations: 'disabled' });
    const upload = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/files/upload-intents');
    await page.getByLabel('上传人工采集截图', { exact: true }).setInputFiles({ name: `geo707-${phase}-${run.repeat_index}.png`, mimeType: 'image/png', buffer: screenshot });
    const intent = await body<Schema['UploadIntent']>(await upload, 201);
    allowRead(`/api/v1/files/${intent.file.id}/download-url`);
    await expect(page.getByText(`已校验截图：${intent.file.id}`, { exact: true })).toBeVisible();
    const file = await body<Schema['FileRecord']>(await page.request.get(`${api}/api/v1/files/${intent.file.id}`));
    expect(file).toMatchObject({ status: 'VERIFIED', size: screenshot.length, sha256: createHash('sha256').update(screenshot).digest('hex') });
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `${runs}/${run.id}/manual-draft`);
    await page.getByRole('button', { name: '保存人工草稿', exact: true }).click();
    await body(await saved);
    const receipt = await uiCommand<Schema['GeoManualObservationSubmitted']>(page, `${runs}/${run.id}/manual-submit`, () => page.getByRole('button', { name: '正式提交人工观测', exact: true }).click(), 201);
    expect(receipt.answer_sha256).toBe(createHash('sha256').update(answer).digest('hex'));
    await expect.poll(async () => (await detail(page, run.id)).run.status, { timeout: 90_000 }).toMatch(/^(COMPLETED|NEEDS_REVIEW|FAILED|CANCELLED|BUDGET_BLOCKED)$/);
    const machine = await detail(page, run.id);
    if (machine.run.status === 'NEEDS_REVIEW') {
      expect(machine.analysis.review_required).toBe(true);
      expect(machine.analysis.revisions[0]?.claims.filter((claim) => ['HIGH', 'CRITICAL'].includes(claim.severity))).toEqual([]);
      await page.getByRole('button', { name: '开始人工复核', exact: true }).click();
      await choose(page, '复核结论', 'CONFIRMED · 确认机器结论');
      await page.getByRole('form', { name: '人工复核表单', exact: true }).getByRole('textbox', { name: '复核说明', exact: true }).fill('GEO707 已人工核对本地虚构原文、型号提及及推荐顺序，确认机器结果。');
      await uiCommand(page, `${runs}/${run.id}/review`, () => page.getByRole('button', { name: '提交人工复核', exact: true }).click(), 201);
    }
    const observation = await detail(page, run.id);
    expect(observation.run.status).toBe('COMPLETED');
    expect(observation.analysis.selection.current_analysis_revision_id).not.toBeNull();
    expect(observation.answer).toMatchObject({ ...sourceEnvironment, answer_text: answer, screenshot_file_id: file.id });
    expect(observation.analysis.review_gate_passed).toBe(true);
    const mentions = observation.analysis.effective_results?.mentions;
    if (!mentions) throw new Error('GEO707 运行缺少真实分析有效结果');
    expect(mentions.length > 0).toBe(phase === 'retest');
    observations.push(observation);
  }
  await expect.poll(async () => (await body<Schema['GeoBatchDetail']>(await page.request.get(`${api}${batches}/${batchId}`))).batch.status).toBe('COMPLETED');
  return observations;
}

export async function evaluateLoopBaseline(batchId: string) {
  const evaluated = await promisify(execFile)(resolve(process.cwd(), '../backend/.venv/bin/python'), ['-m', 'tests.geo_loop_e2e_seed', batchId], {
    cwd: process.cwd(), timeout: 40_000, env: { ...process.env, GEO_OPPORTUNITY_EVALUATION_ENABLED: 'true' },
  });
  return JSON.parse(evaluated.stdout) as { opportunity_id: string; request_id: string };
}

export async function completeLoopContent(page: Page, taskId: string, graph: Awaited<ReturnType<typeof loopConfiguration>>, allowRead: (path: string) => void) {
  const title = `${graph.partNumber} 虚构选型说明`;
  allowRead(`/api/v1/content-tasks/${taskId}/detail`);
  allowRead(`/api/v1/content-tasks/${taskId}/editor-context`);
  allowRead(`/api/v1/content-tasks/${taskId}/review-context`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/content/tasks/${taskId}`);
  await page.getByRole('link', { name: '创建初稿', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill(title);
  await page.getByRole('textbox', { name: '摘要', exact: true }).fill('GEO707 本地虚构公开说明');
  await page.getByRole('textbox', { name: '标签', exact: true }).fill('虚构验收');
  await page.getByRole('textbox', { name: '变更说明', exact: true }).fill('GEO707 按冻结批准事实人工创建');
  await page.getByRole('textbox', { name: '内容 Markdown', exact: true }).fill(`# ${title}\n\n${graph.partNumber} 的工作电压为 3.3 V。\n\n仅用于本地虚构闭环验收。`);
  const version = await uiCommand<Schema['ContentVersion']>(page, `/api/v1/content-tasks/${taskId}/manual-versions`, () => page.getByRole('button', { name: '创建人工首稿', exact: true }).click(), 201);
  allowRead(`/api/v1/content-versions/${version.id}/publication-package`);
  expect(version).toMatchObject({ fact_version_id: graph.fact.id, source_type: 'HUMAN' });
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await uiCommand(page, `/api/v1/content-versions/${version.id}/submit-review`, () => page.getByRole('dialog', { name: '提交内容审核', exact: true }).getByRole('button', { name: '确认提交审核', exact: true }).click());
  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await page.getByRole('link', { name: '审核内容', exact: true }).click();
  await expect(page.locator('#content-review-title')).toHaveText(title);
  await page.getByRole('button', { name: '批准内容', exact: true }).click();
  await uiCommand(page, `/api/v1/content-versions/${version.id}/approve`, () => page.getByRole('dialog', { name: /批准内容版本 v\d+？/ }).getByRole('button', { name: '确认批准', exact: true }).click());
  await page.getByRole('link', { name: '返回任务详情', exact: true }).click();
  await page.getByRole('link', { name: '开始发布', exact: true }).click();
  const card = page.locator('article').filter({ hasText: title });
  await card.getByRole('button', { name: '开始发布', exact: true }).click();
  const start = page.getByRole('dialog', { name: `开始发布“${title}”`, exact: true });
  await start.getByRole('combobox', { name: '发布账号', exact: true }).click();
  await page.getByRole('option', { name: `${graph.account.label} · ${graph.account.account_identifier}`, exact: true }).click();
  const work = await uiCommand<Schema['PublicationWork']>(page, '/api/v1/publication-works', () => start.getByRole('button', { name: '确认开始', exact: true }).click(), 201);
  allowRead(`/api/v1/publication-works/${work.id}/workspace-context`);
  await page.locator('tbody tr').filter({ hasText: title }).getByRole('link', { name: '继续准备', exact: true }).click();
  await expect(page.locator('#publication-workspace-title')).toHaveText(title);
  await page.getByRole('button', { name: '登记发布结果', exact: true }).click();
  const result = page.getByRole('dialog', { name: '登记发布结果', exact: true });
  await result.getByRole('textbox', { name: '实际发布标题', exact: true }).fill(title);
  await result.getByRole('textbox', { name: '最终 URL', exact: true }).fill(`https://${graph.domain}/articles/${graph.suffix}`);
  await result.getByLabel('发布时间', { exact: true }).fill(new Date().toISOString().slice(0, 16));
  await result.getByRole('textbox', { name: '备注', exact: true }).fill('GEO707 登记本地虚构发布结果，正文保持批准版本。');
  const registered = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/publication-works/${work.id}/result`);
  await result.getByRole('button', { name: '确认提交', exact: true }).click();
  await body(await registered);
  await expect(result).toBeHidden();
  await page.getByRole('button', { name: '核验发布结果', exact: true }).click();
  const verification = page.getByRole('dialog', { name: '核验发布结果', exact: true });
  await verification.getByRole('radio', { name: '一致，通过本次核验', exact: true }).check();
  await verification.getByRole('textbox', { name: '核验说明', exact: true }).fill('GEO707 本地模拟发布页面，人工确认冻结稿一致；不访问外部平台。');
  const completed = await uiCommand<Schema['PublicationWork']>(page, `/api/v1/publication-works/${work.id}/verifications`, () => verification.getByRole('button', { name: '确认提交', exact: true }).click());
  expect(completed.status).toBe('COMPLETED');
  const task = await body<Schema['ContentTaskDetail']>(await page.request.get(`${api}/api/v1/content-tasks/${taskId}/detail`));
  expect(task.task).toMatchObject({ status: 'COMPLETED', workflow_stage: 'VERIFIED' });
  const article = await body<Schema['PublishedArticle']>(await page.request.get(`${api}/api/v1/published-articles/${work.id}`));
  expect(article.source_content.content).toMatchObject({ id: version.id, fact_version_id: graph.fact.id, body_markdown: version.body_markdown });
  await page.waitForLoadState('networkidle');
  return { task, version, work: completed, article };
}
