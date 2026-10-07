import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { ANSWER, CITATIONS, startBrowserFixture } from '../../../tests/browser-fixture/server.mjs';

export const CANARIES = Object.freeze(JSON.parse(process.env.GEO_BROWSER_TEST_CANARIES ??
  '["fixture-account-canary","fixture-payment-canary","fixture-cookie-canary"]'));

export class BrowserContractViolation extends Error {}
export function requireContract(condition, rule) {
  // 不使用会展开实际值的matcher；错误诊断不能把DOM/secret打印出来。
  if (!condition) throw new BrowserContractViolation(`Browser合同不符合：${rule}`);
}
export function requireSafe(value) {
  const encoded = JSON.stringify(value);
  const variants = CANARIES.flatMap(value => [value, encodeURIComponent(value), Buffer.from(value).toString('base64')]);
  requireContract(variants.every(value => !encoded.includes(value)), '敏感值外泄');
}

export const FAILURE_CASES = Object.freeze([
  ['expired-login', 'PROFILE_NEEDS_REAUTH', 'CONFIGURATION', 'NOT_STARTED', 0],
  ['selector-changed', 'PROVIDER_RESPONSE_INVALID', 'CONFIGURATION', 'NOT_STARTED', 0],
  ['challenge', 'PROVIDER_AUTH_FAILED', 'CONFIGURATION', 'NOT_STARTED', 0],
  ['answer-selector-changed', 'PROVIDER_RESPONSE_INVALID', 'PARSE', 'COMPLETED', 1],
  ['duplicate-answer', 'PROVIDER_RESPONSE_INVALID', 'PARSE', 'COMPLETED', 1],
  ['challenge-after-send', 'PROVIDER_AUTH_FAILED', 'RECEIVE', 'UNKNOWN', 1],
  ['login-after-send', 'PROFILE_NEEDS_REAUTH', 'RECEIVE', 'UNKNOWN', 1],
  ['timeout', 'COLLECTOR_UNKNOWN_OUTCOME', 'RECEIVE', 'UNKNOWN', 1],
  ['empty-answer', 'PROVIDER_RESPONSE_INVALID', 'PARSE', 'COMPLETED', 1],
]);

/** Factory接收隔离Context；后续真实Adapter通过相同合同，而不是复制这些断言。 */
export async function assertAdapterCase({ browser, fixture, factory, mode, failure, login = false, deny = false, maxBytes = 2097152, persist = true }) {
  const runId = randomUUID();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = [];
  const request = {
    run_id: runId, url: fixture.configure(runId, mode),
    prompt_text: '虚构问题：LC-803 的公开替代条件是什么？',
    login_state: login ? 'AUTHENTICATED' : 'ANONYMOUS', timeout_ms: 1100,
    max_response_bytes: maxBytes,
  };
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === fixture.origin) await route.continue();
    else { blocked.push('EXTERNAL_REQUEST_BLOCKED'); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', route => route.close());
  if (login) await context.addCookies([
    { name: 'fixture-session', value: 'active', url: fixture.origin },
    { name: 'fixture-cookie', value: CANARIES[2], url: fixture.origin },
  ]);
  let callbacks = 0;
  let result;
  let error;
  const denied = new Error('发送授权拒绝');
  try {
    try {
      result = await factory(context).collect(request, { before_send: async () => {
        callbacks += 1;
        requireContract(fixture.stats(runId).count === 0, '授权早于请求');
        if (deny) throw denied;
      } });
    } catch (caught) { error = caught; }
    const expectedCount = deny ? 0 : failure?.[4] ?? 1;
    const stats = fixture.stats(runId);
    requireContract(stats.count === expectedCount, '单attempt真实提交次数');
    requireContract(callbacks === (deny ? 1 : expectedCount), '发送回调次数');
    for (const item of stats.requests) {
      requireContract(item.prompt_sha256 === createHash('sha256').update(request.prompt_text).digest('hex'), '仅提交原问题');
      requireContract(item.prompt_bytes === Buffer.byteLength(request.prompt_text), 'UTF8原文长度');
    }
    requireSafe({ result, failure: error?.failure, message: error?.message, stack: error?.stack, stats });
    if (deny) {
      requireContract(error === denied && !result, '授权拒绝原样传播且零发送');
    } else if (failure) {
      requireContract(!result && error?.failure, '故障不能返回成功');
      const [, code, stage, state] = failure;
      requireContract(error.failure.code === code && error.failure.stage === stage && error.failure.external_call_state === state, '稳定错误与发送状态');
      requireContract(error.failure.provider_status === null && error.failure.retry_after_seconds === null, '未知HTTP元数据不猜测');
    } else {
      requireContract(!error && result, '本地成功回答');
      requireContract(result.answer_text === ANSWER, '完整原文，不能提前结束流式回答');
      requireContract(result.answer_format === 'TEXT', '原始正文格式');
      requireContract(JSON.stringify(result.citations) === JSON.stringify(mode === 'no-citations' ? [] : CITATIONS), '晚到引用/重复URL/真实位置');
      const unknown = mode === 'unknown-metadata';
      requireContract(result.source_product === (unknown ? null : '虚构 AI') && result.source_model === (unknown ? null : 'fixture-model') && result.source_version === (unknown ? null : 'fixture-v1') && result.web_search_observed === (unknown ? null : true), '只报告观察到的元数据');
      requireContract(result.usage === null && result.cost === null && result.provider_request_id === null, '未知用量/费用/请求ID为null');
      requireContract(result.screenshot_bytes === null && result.raw_payload_bytes === null, '不保存全页或敏感DOM');
    }
    requireContract(context.pages().length === 0, 'Adapter完成/失败都关闭页面');
    if (persist && process.env.GEO_BROWSER_CONTRACT_OUTPUT && !deny) {
      await appendFile(process.env.GEO_BROWSER_CONTRACT_OUTPUT, JSON.stringify({ mode, result: result ?? null, failure: error?.failure ?? null }) + '\n');
    }
    return { result, error, stats, blocked };
  } finally {
    await context.close();
    requireContract(!browser.contexts().includes(context), '隔离context清理');
  }
}

export function registerBrowserAdapterContract(name, factory) {
  let browser;
  let fixture;
  before(async () => {
    fixture = await startBrowserFixture(CANARIES);
    try { browser = await chromium.launch({ headless: true, chromiumSandbox: true }); }
    catch (error) { await fixture.close(); throw error; }
  });
  after(async () => {
    try { if (browser) await browser.close(); }
    finally { if (fixture) await fixture.close(); }
  });
  const run = options => assertAdapterCase({ browser, fixture, factory, ...options });
  for (const mode of ['streaming', 'paused-stream', 'early-complete', 'no-citations', 'unknown-metadata', 'sensitive-ui']) {
    test(`${name}：${mode}完整结果`, () => run({ mode }));
  }
  test(`${name}：已登录context`, () => run({ mode: 'authenticated', login: true }));
  test(`${name}：匿名context不继承登录资料`, () => run({ mode: 'authenticated', failure: ['authenticated', 'PROFILE_NEEDS_REAUTH', 'CONFIGURATION', 'NOT_STARTED', 0] }));
  for (const failure of FAILURE_CASES) test(`${name}：${failure[0]}稳定失败`, () => run({ mode: failure[0], failure }));
  test(`${name}：发送授权拒绝`, () => run({ mode: 'streaming', deny: true }));
  test(`${name}：回答大小上限`, () => run({ mode: 'streaming', maxBytes: 8, failure: ['streaming', 'PROVIDER_RESPONSE_TOO_LARGE', 'PARSE', 'COMPLETED', 1] }));
  return { run, resources: () => ({ browser, fixture }) };
}
