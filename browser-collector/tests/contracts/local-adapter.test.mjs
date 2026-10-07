import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { BrowserContractViolation, CANARIES, registerBrowserAdapterContract, requireContract, requireSafe } from '../support/adapter-contract.mjs';
import { ReferenceBrowserAdapter } from '../support/reference-adapter.mjs';
import { startBrowserFixture } from '../../../tests/browser-fixture/server.mjs';

const factory = context => new ReferenceBrowserAdapter(context);
const suite = registerBrowserAdapterContract('本地参考Adapter', factory);

async function rejectsViolation(operation, rule) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  requireContract(caught instanceof BrowserContractViolation && caught.message.includes(rule), `反例检测：${rule}`);
}

test('套件拒绝完成信号出现时立即返回的部分答案', async () => {
  const premature = context => ({ collect: async (...args) => {
    const result = await factory(context).collect(...args);
    return { ...result, answer_text: result.answer_text.slice(0, 10) };
  } });
  await rejectsViolation(() => suite.run({ mode: 'paused-stream', factory: premature, persist: false }), '完整原文');
});

test('套件拒绝丢失晚到引用或把重复URL静默合并', async () => {
  const missing = context => ({ collect: async (...args) => {
    const result = await factory(context).collect(...args);
    return { ...result, citations: result.citations.slice(0, 2) };
  } });
  await rejectsViolation(() => suite.run({ mode: 'streaming', factory: missing, persist: false }), '晚到引用');
});

test('套件以真实POST记录拒绝发送后自动重复调用', async () => {
  const retry = context => ({ collect: async (request, options) => {
    const result = await factory(context).collect(request, options);
    await factory(context).collect(request, { before_send: async () => {} });
    return result;
  } });
  await rejectsViolation(() => suite.run({ mode: 'streaming', factory: retry, persist: false }), '真实提交次数');
});

test('套件拒绝吞掉selector失败并伪装成功', async () => {
  const swallow = context => ({ collect: async (...args) => {
    try { return await factory(context).collect(...args); }
    catch { return { answer_text: '' }; }
  } });
  await rejectsViolation(() => suite.run({ mode: 'selector-changed', factory: swallow, failure: ['selector-changed', 'PROVIDER_RESPONSE_INVALID', 'CONFIGURATION', 'NOT_STARTED', 0], persist: false }), '故障不能返回成功');
});

test('套件拒绝异常摘要及编码形式敏感值泄漏', async () => {
  const leaking = context => ({ collect: async (...args) => {
    await factory(context).collect(...args);
    throw new Error(CANARIES[0]);
  } });
  await rejectsViolation(() => suite.run({ mode: 'sensitive-ui', factory: leaking, persist: false }), '敏感值外泄');
  for (const marker of CANARIES) {
    for (const value of [marker, encodeURIComponent(marker), Buffer.from(marker).toString('base64')]) {
      await rejectsViolation(async () => requireSafe({ nested: { value } }), '敏感值外泄');
    }
  }
});

test('敏感UI确实存在且登录/临时storage不跨context，未存截图或trace', async () => {
  const { browser, fixture } = suite.resources();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const runId = randomUUID();
  const url = fixture.configure(runId, 'sensitive-ui');
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
    const visible = await page.getByTestId('sensitive-ui').isVisible();
    const markers = await page.getByTestId('sensitive-ui').textContent();
    requireContract(visible && CANARIES.every(value => markers.includes(value)), '虚构账号/支付/Cookie UI可见');
    requireContract(await page.evaluate(() => localStorage.length) === 1, '测试storage确实存在');
  } finally { await context.close(); }
  const clean = await browser.newContext();
  try {
    const page = await clean.newPage();
    await page.goto(fixture.configure(randomUUID(), 'streaming'));
    requireContract(await page.evaluate(() => localStorage.length) === 0 && (await clean.cookies()).length === 0, '每次context隔离');
  } finally { await clean.close(); }
});

test('非fixture HTTP导航和WebSocket都在发包前被拒绝', async () => {
  const { browser, fixture } = suite.resources();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let blocked = 0;
  let sockets = 0;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
    blocked += 1;
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', route => { sockets += 1; return route.close(); });
  try {
    const page = await context.newPage();
    try { await page.goto('https://outside.geo-fixture.invalid/probe'); } catch { /* 预期网络拒绝；不输出URL或异常。 */ }
    requireContract(blocked === 1, '外部导航路由拒绝');
    // 被中止导航可能仍在提交浏览器错误页；新页面避免和后续本地导航竞争。
    await page.close();
    const local = await context.newPage();
    await local.goto(fixture.configure(randomUUID(), 'external-resource'));
    await local.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
    // about:blank不带站点CSP，用于直接验证WebSocket路由而不依赖CSP。
    const socketPage = await context.newPage();
    await socketPage.evaluate(() => new Promise(resolve => {
      const socket = new WebSocket('wss://outside.geo-fixture.invalid/socket');
      socket.onclose = () => resolve();
      socket.onerror = () => resolve();
    }));
    requireContract(sockets === 1, '外部WebSocket拒绝');
  } finally { await context.close(); }
});

test('模拟站多实例、attempt隔离；重复POST不去重且观测不保留正文', async () => {
  const { browser, fixture } = suite.resources();
  const second = await startBrowserFixture(CANARIES);
  const sharedId = randomUUID();
  const firstUrl = fixture.configure(sharedId, 'streaming');
  const secondUrl = second.configure(sharedId, 'streaming');
  const context = await browser.newContext();
  try {
    for (const url of [firstUrl, firstUrl, secondUrl]) {
      const page = await context.newPage();
      await page.goto(url);
      await page.evaluate(async () => {
        await fetch(location.pathname.replace('/chat/', '/submit/'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: '仅用于计数的虚构文本' }),
        });
      });
      await page.close();
    }
    requireContract(fixture.stats(sharedId).count === 2 && second.stats(sharedId).count === 1, '不同实例隔离且重复如实计数');
    requireContract(!JSON.stringify(fixture.stats(sharedId)).includes('虚构文本'), '统计不保存问题正文');
    requireSafe(fixture.stats(sharedId));
  } finally {
    await context.close();
    await second.close();
  }
});
