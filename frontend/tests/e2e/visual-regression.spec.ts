/** 用契约形状的只读夹具锁定核心页面在四档宽度下的视觉与严重级无障碍基线。 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const now = '2026-07-10T08:00:00+08:00';
const userId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000001';
const taskId = '30000000-0000-4000-8000-000000000001';
const factId = '40000000-0000-4000-8000-000000000001';
const contentId = '50000000-0000-4000-8000-000000000001';
const jobId = '60000000-0000-4000-8000-000000000001';
const aiChannelId = '98000000-0000-4000-8000-000000000001';

const user = { id: userId, username: 'reviewer', display_name: '审核工程师', account_type: 'ADMIN', is_active: true, must_change_password: false, revision: 1, created_at: now };
const product = { id: productId, part_number: 'PS-AX7421', brand: 'PartSignal Labs', category: '工业接口芯片', status: 'ACTIVE', revision: 3, created_at: now, updated_at: now };
const factsBody = {
  reference_parts: [{ client_key: 'ref-a', part_number: 'REF-7421', manufacturer: 'Reference Corp', category: '接口芯片' }],
  parameters: [{ client_key: 'voltage', owner_key: 'product', key: 'voltage', name: '工作电压', value_type: 'NUMERIC', min_value: 3, typical_value: 3.3, max_value: 3.6, text_value: null, unit: 'V', test_conditions: 'TA = 25°C', is_critical: true, evidence_keys: ['datasheet'] }],
  replacement_relations: [{ client_key: 'relation-a', reference_part_key: 'ref-a', replacement_level: 'PARAMETER_COMPATIBLE', conditions: '额定工作电压与接口模式一致', exclusions: '高温环境需重新验证', evidence_keys: ['datasheet'] }],
  evidences: [{ client_key: 'datasheet', type: 'DATASHEET', title: 'PS-AX7421 数据手册', version: 'Rev 1.2', source_url: 'https://docs.example.invalid/ps-ax7421.pdf', file_id: null, confidentiality: 'PUBLIC' }],
  claims: [{ client_key: 'claim-a', type: 'APPROVED', text: '可在已验证条件下作为参数兼容候选。', evidence_keys: ['datasheet'] }],
};
const factVersion = { id: factId, product_id: productId, version: 3, status: 'APPROVED', snapshot: factsBody, change_summary: '补充高温排除边界', revision: 4, created_by: userId, approved_by: userId, created_at: now, approved_at: now };
const task = { id: taskId, query_topic_id: '70000000-0000-4000-8000-000000000001', product_id: productId, fact_version_id: factId, platform_profile_version_id: '80000000-0000-4000-8000-000000000001', platform_type_id: '81000000-0000-4000-8000-000000000001', platform_type_snapshot: { name: '技术社区' }, user_prompt_markdown: '围绕替代条件和排除边界生成工程说明。', generation_data_classification: 'PUBLIC', generation_data_classified_by: userId, generation_data_classified_at: now, source_publication_attention_id: null, available_actions: ['CANCEL'], target_audience: '硬件工程师', content_angle: '替代边界与验证条件', conversion_goal: '查看数据手册', desired_format: '工程说明', desired_length_min: 800, desired_length_max: 1400, canonical_url: 'https://product.example.invalid/ps-ax7421', status: 'OPEN', revision: 2, created_by: userId, created_at: now };
const content = { id: contentId, task_id: taskId, fact_version_id: factId, source_job_id: jobId, based_on_id: null, version: 2, source_type: 'AI', title: 'PS-AX7421 替代边界与验证条件', summary: '基于已批准事实说明参数兼容范围。', body_markdown: '# 替代结论\n\nPS-AX7421 可作为参数兼容候选，但高温环境必须重新验证。\n\n## 关键参数\n\n| 参数 | 数值 |\n| --- | --- |\n| 工作电压 | 3.0–3.6 V |', tags: ['替代方案', '工程验证'], content_hash: 'abc1234567890abc1234567890abc1234567890abc1234567890abc1234', status: 'PENDING_REVIEW', revision: 2, quality_issues: [{ code: 'VERIFY_HIGH_TEMPERATURE', severity: 'WARNING', message: '高温排除边界需要在发布正文中保持可见。' }], created_by: userId, created_at: now };
const attention = { id: '90000000-0000-4000-8000-000000000001', publication_record_id: '91000000-0000-4000-8000-000000000001', original_task_id: taskId, trigger_status: 'VERIFICATION_FAILED', status: 'OPEN', revision: 1, opened_at: now, resolved_at: null, resolved_by: null, resolution_comment: null, repair_task_id: null, available_actions: ['CREATE_REPAIR_TASK', 'RESOLVE'] };
const publication = { id: attention.publication_record_id, content_version_id: contentId, task_id: taskId, platform_account_id: '92000000-0000-4000-8000-000000000001', section_url: 'https://community.example.invalid/hardware', actual_title: content.title, final_url: 'https://community.example.invalid/posts/7421', published_at: now, status: 'VERIFICATION_FAILED', content_hash: content.content_hash, created_by: userId, created_at: now, status_events: [{ status: 'PUBLISHED', comment: '已登记人工发布', actor_id: userId, created_at: now }, { status: 'VERIFICATION_FAILED', comment: '正文边界缺失', actor_id: userId, created_at: now }], attachments: [], available_actions: ['remove'] };
const aiChannel = { id: aiChannelId, name: '受控模型渠道', base_url: 'https://provider.example.invalid/openai-compatible/v1', timeout_seconds: 60, is_enabled: true, api_key_configured: true, api_key_updated_at: now, headers: [{ id: '98100000-0000-4000-8000-000000000001', name: 'X-Public-Region', is_sensitive: false, is_configured: true, value: 'cn-east' }, { id: '98200000-0000-4000-8000-000000000001', name: 'X-Provider-Secret', is_sensitive: true, is_configured: true, value: null }], revision: 3, created_by: userId, created_at: now, updated_at: now };
const aiModel = { id: '98300000-0000-4000-8000-000000000001', channel_id: aiChannelId, display_name: '工程内容生成模型', model_id: 'provider/model-with-a-very-long-identifier', request_parameters: { temperature: 0.2, max_tokens: 4096 }, is_enabled: true, test_status: 'PASSED', last_tested_at: now, last_test_error_summary: null, revision: 2, created_by: userId, created_at: now, updated_at: now };

type Scenario = 'login' | 'dashboard' | 'error' | 'facts' | 'task' | 'review' | 'publications' | 'publication-empty' | 'geo' | 'configuration-ai' | 'configuration-channel';
type VisualTheme = 'light' | 'dark';

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function mockApi(page: Page, scenario: Scenario) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(scenario === 'login' ? json({ error: { code: 'AUTH_REQUIRED', message: '请先登录', request_id: 'visual-login' } }, 401) : json(user));
    if (path.endsWith('/auth/csrf')) return route.fulfill(json({ csrf_token: 'x'.repeat(32) }));
    if (path === '/api/v1/ai-channels') return route.fulfill(json({ items: [aiChannel] }));
    if (path === `/api/v1/ai-channels/${aiChannelId}`) return route.fulfill(json(aiChannel));
    if (path === `/api/v1/ai-channels/${aiChannelId}/models`) return route.fulfill(json({ items: [aiModel] }));
    if (scenario === 'error' && path.endsWith('/dashboard/summary')) return route.fulfill(json({ error: { code: 'DASHBOARD_UNAVAILABLE', message: '工作台汇总暂时不可用', request_id: 'visual-error-001' } }, 500));
    if (path.endsWith('/dashboard/summary')) return route.fulfill(json({ pending_fact_reviews: 7, pending_content_reviews: 4, pending_publications: 3, publication_attention: 2, recent_accuracy_errors: 5 }));
    if (path.endsWith('/geo-metrics')) return route.fulfill(json(scenario === 'geo' ? { sample_count: 1, mention_rate: 1, recommendation_rate: 0, citation_rate: 1, accuracy_rate: null } : { sample_count: 48, mention_rate: .79, recommendation_rate: .46, citation_rate: .63, accuracy_rate: .92 }));
    if (path === '/api/v1/products') return route.fulfill(json({ items: [product], page: 1, page_size: 100, total: 1 }));
    if (path.endsWith('/query-topics')) return route.fulfill(json({ items: [{ id: task.query_topic_id, canonical_question: 'PS-AX7421 是否可以替代 REF-7421？', intent_type: 'REPLACEMENT', variants: [] }] }));
    if (path === `/api/v1/products/${productId}`) return route.fulfill(json(product));
    if (path === `/api/v1/products/${productId}/facts`) return route.fulfill(json({ product_id: productId, revision: 3, ...factsBody }));
    if (path === `/api/v1/products/${productId}/fact-versions`) return route.fulfill(json({ items: [factVersion] }));
    if (path === `/api/v1/content-tasks/${taskId}`) return route.fulfill(json(task));
    if (path === `/api/v1/content-tasks/${taskId}/content-versions`) return route.fulfill(json({ items: [content] }));
    if (path === `/api/v1/content-tasks/${taskId}/generation-jobs`) return route.fulfill(json({ items: [{ id: jobId, content_task_id: taskId, status: 'FAILED', attempt_count: 2, content_version_id: null, retry_of_id: null, error_code: 'PROVIDER_TIMEOUT', error_summary: '模型供应商响应超时，可重试冻结快照。', provider_request_id: 'req_visual_7421', response_duration_ms: 60000, prompt_tokens: 812, completion_tokens: 0, total_tokens: 812, created_at: now, started_at: now, finished_at: now }] }));
    if (path === `/api/v1/content-tasks/${taskId}/generation-options`) return route.fulfill(json({ platform_profile_version_id: task.platform_profile_version_id, platform_profile_name: '工程师社区', platform_type_id: task.platform_type_id, platform_type_name: '技术社区', platform_type_slug: 'technical-community', system_prompt_markdown: '只依据已批准事实，明确适用条件与排除边界。', models: [{ id: '93000000-0000-4000-8000-000000000001', channel_id: '94000000-0000-4000-8000-000000000001', channel_name: '受控模型渠道', display_name: '工程内容模型', model_id: 'model-visual' }] }));
    if (path === `/api/v1/generation-jobs/${jobId}`) return route.fulfill(json({ id: jobId, content_task_id: taskId, status: 'FAILED', attempt_count: 2, content_version_id: null, retry_of_id: null, error_code: 'PROVIDER_TIMEOUT', error_summary: '模型供应商响应超时，可重试冻结快照。', provider_request_id: 'req_visual_7421', response_duration_ms: 60000, prompt_tokens: 812, completion_tokens: 0, total_tokens: 812, created_at: now, started_at: now, finished_at: now, input_snapshot: { adapter_name: 'openai-compatible', contract_version: 'v1', channel: { name: '受控模型渠道' }, model: { model_id: 'model-visual', request_parameters: { temperature: 0.2 } }, platform_type: { name: '技术社区' }, system_message: '只依据已批准事实。', user_prompt_markdown: task.user_prompt_markdown, approved_facts: { fact_version_id: factId }, task_requirements: {}, user_message: '生成工程说明' } }));
    if (path === `/api/v1/content-versions/${contentId}/review-context`) return route.fulfill(json({ content, task, fact_version: factVersion, evidence_statuses: [{ client_key: 'datasheet', file_id: null, file_status: null }], diff: { left_id: contentId, right_id: contentId, lines: [{ kind: 'EQUAL', old_line: 1, new_line: 1, text: '# 替代结论' }, { kind: 'ADD', old_line: null, new_line: 2, text: '补充高温排除边界。' }] }, generation_trace: { job_id: jobId, input_snapshot: { adapter_name: 'openai-compatible', contract_version: 'v1', channel: { name: '受控模型渠道' }, model: { model_id: 'model-visual' }, platform_type: { name: '技术社区' }, system_message: '只依据批准事实', user_prompt_markdown: task.user_prompt_markdown, approved_facts: { fact_version_id: factId }, task_requirements: {}, user_message: '生成工程说明' } }, available_actions: ['APPROVE', 'REQUEST_CHANGES'], review_history: [{ id: '95000000-0000-4000-8000-000000000001', target_id: contentId, target_version: 1, action: 'request-changes', comment: '请保留高温排除边界。', actor: { id: userId, username: user.username, display_name: user.display_name }, created_at: now }] }));
    if (path.endsWith('/publication-candidates')) return route.fulfill(json({ items: scenario === 'publication-empty' ? [] : [{ content_version: { ...content, status: 'APPROVED' }, task_id: taskId, platform_profile_id: '96000000-0000-4000-8000-000000000001', platform_profile_name: '工程师社区', platform_profile_version_id: task.platform_profile_version_id, platform_profile_version: 4, matching_accounts: [{ id: publication.platform_account_id, platform_profile_id: '96000000-0000-4000-8000-000000000001', label: '企业技术账号', account_identifier: 'partsignal-labs', is_active: true }] }] }));
    if (path.endsWith('/publication-records')) return route.fulfill(json({ items: scenario === 'publication-empty' ? [] : [publication], page: 1, page_size: 100, total: scenario === 'publication-empty' ? 0 : 1 }));
    if (path.endsWith('/publication-attentions')) return route.fulfill(json({ items: scenario === 'publication-empty' ? [] : [attention] }));
    if (path.endsWith('/geo-observations')) return route.fulfill(json({ items: [{ id: '97000000-0000-4000-8000-000000000001', query_topic_id: task.query_topic_id, product_id: productId, actual_prompt: 'PS-AX7421 是否可以替代 REF-7421？', model_name: 'E2E-Observed', model_version: '2026-07', tested_at: now, web_search_enabled: true, answer_summary: '模型提及产品并引用公开资料，但未对高温条件作出准确判断。', mentioned: true, recommendation: 'CANDIDATE', accuracy: 'UNJUDGEABLE', citations: [{ url: 'https://docs.example.invalid/ps-ax7421.pdf', source_type: 'OFFICIAL', publication_record_id: null }], publication_record_ids: [], attachment_file_ids: [], notes: '需要追加高温测试观测', supersedes_id: null, tested_by: userId, created_at: now }] }));
    return route.fulfill(json({ error: { code: 'VISUAL_FIXTURE_MISSING', message: `未声明视觉夹具：${path}` } }, 500));
  });
}

const viewports = [
  { name: '375', width: 375, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 1000 },
];

async function capture(page: Page, scenario: Scenario, path: string, readyText: string, selectedViewports = viewports) {
  await mockApi(page, scenario);
  await page.addInitScript(() => {
    const selected = new URLSearchParams(window.location.search).get('visual-theme');
    if (selected === 'light' || selected === 'dark') localStorage.setItem('partsignal.theme-mode', selected);
  });
  for (const visualTheme of ['light', 'dark'] as const) {
    for (const viewport of selectedViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const separator = path.includes('?') ? '&' : '?';
      // 顶部栏标题会早于懒加载页面出现；关键接口完成后才允许记录业务完成态。
      const readyApiPaths = scenario === 'geo'
        ? ['/api/v1/geo-metrics', '/api/v1/geo-observations']
        : scenario === 'publications' || scenario === 'publication-empty'
          ? ['/api/v1/publication-candidates', '/api/v1/publication-records', '/api/v1/publication-attentions']
          : [];
      const readyResponses = readyApiPaths.map((apiPath) => page.waitForResponse((response) => new URL(response.url()).pathname === apiPath));
      await page.goto(`${path}${separator}visual-theme=${visualTheme}`);
      await Promise.all(readyResponses);
      const readyContent = scenario === 'login' ? page : page.locator('.app-content');
      await expect(readyContent.getByText(readyText, { exact: false }).first()).toBeVisible();
      await expect(page.locator('.route-loading')).toHaveCount(0);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', visualTheme);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const snapshot = visualTheme === 'light' ? `${scenario}-${viewport.name}.png` : `${scenario}-dark-${viewport.name}.png`;
      await expect(page).toHaveScreenshot(snapshot, { fullPage: true });
      if (viewport.width === 1440) {
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
      }
    }
  }
}

test('登录页双主题视觉基线', async ({ page }) => capture(page, 'login', '/login', '进入工作台'));
test('工作台成功态视觉基线', async ({ page }) => capture(page, 'dashboard', '/', '今天的内容链路'));
test('共享查询失败视觉基线', async ({ page }) => capture(page, 'error', '/', '加载失败'));
test('产品事实长表单视觉基线', async ({ page }) => capture(page, 'facts', `/products/${productId}`, 'PS-AX7421'));
test('内容任务作业失败视觉基线', async ({ page }) => capture(page, 'task', `/tasks/${taskId}`, '替代边界与验证条件'));
test('内容审核驾驶舱视觉基线', async ({ page }) => capture(page, 'review', `/content/${contentId}`, 'PS-AX7421 替代边界'));
test('人工发布异常工作台视觉基线', async ({ page }) => capture(page, 'publications', '/publications', '人工发布'));
test('人工发布空状态视觉基线', async ({ page }) => capture(page, 'publication-empty', '/publications', '人工发布'));
test('GEO 无可判断样本视觉基线', async ({ page }) => capture(page, 'geo', '/observations', 'GEO 观测'));
test('AI 渠道卡片双主题视觉基线', async ({ page }) => capture(page, 'configuration-ai', '/configuration/ai', '受控模型渠道'));
test('AI 渠道详情双主题视觉基线', async ({ page }) => capture(page, 'configuration-channel', `/configuration/ai/channels/${aiChannelId}`, '工程内容生成模型'));

const interactionViewports = [
  { name: '375', width: 375, height: 900 },
  { name: '1440', width: 1440, height: 1000 },
];

async function installThemeSelection(page: Page) {
  await page.addInitScript(() => {
    const selected = new URLSearchParams(window.location.search).get('visual-theme');
    if (selected === 'light' || selected === 'dark') localStorage.setItem('partsignal.theme-mode', selected);
  });
}

function interactionSnapshot(name: string, visualTheme: VisualTheme, viewport: string) {
  return visualTheme === 'light' ? `${name}-${viewport}.png` : `${name}-dark-${viewport}.png`;
}

test('登录表单错误双主题基线', async ({ page }) => {
  await mockApi(page, 'login');
  await installThemeSelection(page);
  for (const visualTheme of ['light', 'dark'] as const) {
    for (const viewport of interactionViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/login?visual-theme=${visualTheme}`);
      await page.getByRole('button', { name: /登\s*录/ }).click();
      await expect(page.locator('.ant-form-item-explain-error')).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(interactionSnapshot('login-error', visualTheme, viewport.name), { fullPage: true });
    }
  }
});

test('移动导航 Drawer 双主题基线', async ({ page }) => {
  await mockApi(page, 'dashboard');
  await installThemeSelection(page);
  for (const visualTheme of ['light', 'dark'] as const) {
    for (const viewport of interactionViewports.filter((item) => item.width === 375)) {
      await page.setViewportSize(viewport);
      await page.goto(`/?visual-theme=${visualTheme}`);
      await page.getByRole('button', { name: '切换导航' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page).toHaveScreenshot(interactionSnapshot('navigation-drawer', visualTheme, viewport.name));
    }
  }
});

test('GEO Modal、上传与表单错误双主题基线', async ({ page }) => {
  await mockApi(page, 'geo');
  await installThemeSelection(page);
  for (const visualTheme of ['light', 'dark'] as const) {
    for (const viewport of interactionViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/observations?visual-theme=${visualTheme}`);
      await page.getByRole('button', { name: '登记观测' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('测试截图')).toBeVisible();
      await dialog.getByRole('button', { name: '追加观测' }).click();
      await expect(dialog.locator('.ant-form-item-explain-error').first()).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.ant-modal-wrap').evaluate((element) => element.scrollTo(0, 0));
      await page.locator('.ant-modal-container').evaluate((element) => element.scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(interactionSnapshot('observation-modal-error', visualTheme, viewport.name));
    }
  }
});
