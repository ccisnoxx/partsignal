/** 在固定生产网络条件下分离路由代码、API、渲染和主线程耗时。 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const sampleCount = Number.parseInt(process.env.PARTSIGNAL_PERF_SAMPLES ?? '5', 10);
const baseUrl = process.env.PARTSIGNAL_PERF_BASE_URL ?? 'http://127.0.0.1:4173';
const shouldStartPreview = !process.env.PARTSIGNAL_PERF_BASE_URL;
const clsThreshold = 0.1;
const productId = '20000000-0000-4000-8000-000000000001';
const now = '2026-07-10T08:00:00+08:00';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'reviewer',
  display_name: '审核工程师',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  revision: 1,
  created_at: now,
};

const product = {
  id: productId,
  part_number: 'PS-AX7421',
  brand: 'PartSignal Labs',
  category: '工业接口芯片',
  status: 'ACTIVE',
  revision: 3,
  created_at: now,
  updated_at: now,
};

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function waitForPreview(previewProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (previewProcess && previewProcess.exitCode !== null) {
      throw new Error(`生产预览启动失败，退出码：${previewProcess.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        if (previewProcess && previewProcess.exitCode !== null) {
          throw new Error(`生产预览启动失败，退出码：${previewProcess.exitCode}`);
        }
        return;
      }
    } catch {
      // preview 启动期间连接失败是预期状态，达到上限后再显式报错。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`生产预览未在限定时间内就绪：${baseUrl}`);
}

async function stopPreview(previewProcess) {
  if (!previewProcess || previewProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => previewProcess.once('exit', resolve));
  previewProcess.kill('SIGTERM');
  await exited;
}

function installConnectionPolicy(page, allowIdlePrefetch) {
  return page.addInitScript((allowIdle) => {
    const connection = { saveData: !allowIdle, effectiveType: allowIdle ? '3g' : '2g' };
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  }, allowIdlePrefetch);
}

async function installApiFixture(page, apiDurations, anonymous = false, anonymousAuthGate = Promise.resolve()) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const started = performance.now();
    if (anonymous && path.endsWith('/auth/me')) await anonymousAuthGate;
    const response = path.endsWith('/auth/me') ? (anonymous ? { status: 204 } : json(user))
      : path.endsWith('/auth/csrf') ? json({ csrf_token: 'x'.repeat(32) })
      : path.endsWith('/dashboard/summary') ? json({ pending_fact_reviews: 7, pending_content_reviews: 4, pending_publications: 3, publication_attention: 2, recent_accuracy_errors: 5 })
      : path.endsWith('/geo-metrics') ? json({ sample_count: 48, mention_rate: 0.79, recommendation_rate: 0.46, citation_rate: 0.63, accuracy_rate: 0.92 })
      : path === '/api/v1/products' ? json({ items: [product], page: 1, page_size: 100, total: 1 })
      : { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PERF_FIXTURE_MISSING', message: `缺少性能夹具：${path}` } }) };
    await route.fulfill(response);
    apiDurations.push({ path, duration: performance.now() - started });
  });
}

async function emulateNetwork(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: 'cellular3g',
  });
}

function installPerformanceObservers(page, collectLayoutShifts = false) {
  return page.addInitScript((collectShifts) => {
    globalThis.__partsignalLongTasks = [];
    globalThis.__partsignalLayoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__partsignalLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
    if (collectShifts) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            globalThis.__partsignalLayoutShifts.push({ startTime: entry.startTime, value: entry.value });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    }
  }, collectLayoutShifts);
}

function calculateCls(entries) {
  let maximum = 0;
  let current = 0;
  let windowStart = null;
  let previous = null;
  for (const entry of entries) {
    if (windowStart === null || entry.startTime - previous > 1_000 || entry.startTime - windowStart > 5_000) {
      windowStart = entry.startTime;
      current = 0;
    }
    current += entry.value;
    previous = entry.startTime;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

async function clickMenuItemWithoutHover(page, label) {
  const item = page.getByRole('link', { name: label, exact: true }).first();
  await item.evaluate((element) => element.click());
}

async function measureContext(browser, allowIdlePrefetch) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const apiDurations = [];
  await emulateNetwork(page);
  await installConnectionPolicy(page, allowIdlePrefetch);
  await installApiFixture(page, apiDurations);
  await installPerformanceObservers(page);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.getByRole('heading', { name: '总览' }).waitFor({ timeout: 120_000 });
  if (allowIdlePrefetch) await page.waitForTimeout(1_000);

  const navigationStart = await page.evaluate(() => performance.now());
  const coldStarted = performance.now();
  await clickMenuItemWithoutHover(page, '产品事实');
  await page.getByRole('heading', { name: '产品事实', exact: true }).waitFor({ timeout: 120_000 });
  const cold = performance.now() - coldStarted;

  await clickMenuItemWithoutHover(page, '工作台');
  await page.getByRole('heading', { name: '总览' }).waitFor({ timeout: 120_000 });
  const warmStarted = performance.now();
  await clickMenuItemWithoutHover(page, '产品事实');
  await page.getByRole('heading', { name: '产品事实', exact: true }).waitFor({ timeout: 120_000 });
  const warm = performance.now() - warmStarted;

  const browserMetrics = await page.evaluate((started) => ({
    resources: performance.getEntriesByType('resource')
      .filter((entry) => /ProductsPage|StatusTag|TableRegion/.test(entry.name))
      .map((entry) => ({
        name: entry.name.split('/').pop(),
        duration: entry.duration,
        transferSize: entry.transferSize,
        responseEnd: entry.responseEnd,
      })),
    longTasks: globalThis.__partsignalLongTasks.filter((entry) => entry.startTime >= started),
  }), navigationStart);
  await context.close();
  return {
    cold,
    warm,
    maxApi: Math.max(...apiDurations.map((item) => item.duration)),
    apiDurations,
    ...browserMetrics,
  };
}

async function measureAnonymousBoot(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const apiDurations = [];
  let releaseSessionProbe;
  const authBootPainted = new Promise((resolve) => {
    releaseSessionProbe = resolve;
  });
  await emulateNetwork(page);
  await installConnectionPolicy(page, false);
  await installApiFixture(page, apiDurations, true, authBootPainted);
  await installPerformanceObservers(page, true);

  const sessionProbe = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/auth/me',
  );
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('.auth-boot').waitFor({ state: 'visible', timeout: 120_000 });
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));
  releaseSessionProbe();
  const sessionResponse = await sessionProbe;
  if (sessionResponse.status() !== 204) {
    throw new Error(`匿名会话探测必须返回 204，实际为 ${sessionResponse.status()}`);
  }
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 120_000 });
  await page.getByLabel('账号').waitFor({ state: 'visible', timeout: 120_000 });
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));

  const metrics = await page.evaluate(() => ({
    layoutShifts: globalThis.__partsignalLayoutShifts,
    longTasks: globalThis.__partsignalLongTasks,
    resources: performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: entry.transferSize,
    })),
  }));
  await context.close();
  return {
    cls: calculateCls(metrics.layoutShifts),
    tbt: metrics.longTasks.reduce((total, entry) => total + Math.max(0, entry.duration - 50), 0),
    protectedResources: metrics.resources
      .filter((entry) => /AppLayout|ChangePasswordPage|workspace\.css/.test(entry.name))
      .map((entry) => entry.name),
    maxApi: Math.max(...apiDurations.map((item) => item.duration)),
    apiDurations,
    ...metrics,
  };
}

function summarize(samples) {
  const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  return {
    medianCold: median(samples.map((item) => item.cold)),
    medianWarm: median(samples.map((item) => item.warm)),
    maxApi: Math.max(...samples.map((item) => item.maxApi)),
    maxLongTask: Math.max(0, ...samples.flatMap((item) => item.longTasks.map((entry) => entry.duration))),
    samples,
  };
}

function summarizeAnonymous(samples) {
  return {
    maxCls: Math.max(...samples.map((item) => item.cls)),
    maxLongTask: Math.max(0, ...samples.flatMap((item) => item.longTasks.map((entry) => entry.duration))),
    maxLongTaskCount: Math.max(...samples.map((item) => item.longTasks.length)),
    maxTbt: Math.max(...samples.map((item) => item.tbt)),
    protectedResources: [...new Set(samples.flatMap((item) => item.protectedResources))],
    samples,
  };
}

let preview;
let browser;
try {
  if (shouldStartPreview) {
    preview = spawn('npm', ['exec', '--', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
      stdio: 'ignore',
      env: process.env,
    });
  }
  await waitForPreview(preview);
  browser = await chromium.launch({ headless: true });
  const anonymousBootSamples = [];
  const rawColdSamples = [];
  const productionPrefetchSamples = [];
  for (let index = 0; index < sampleCount; index += 1) anonymousBootSamples.push(await measureAnonymousBoot(browser));
  for (let index = 0; index < sampleCount; index += 1) rawColdSamples.push(await measureContext(browser, false));
  for (let index = 0; index < sampleCount; index += 1) productionPrefetchSamples.push(await measureContext(browser, true));
  const anonymousBoot = summarizeAnonymous(anonymousBootSamples);
  const report = {
    conditions: { samples: sampleCount, latencyMs: 100, downloadBps: 200_000, viewport: '1440x1000' },
    anonymousBoot,
    rawCold: summarize(rawColdSamples),
    productionPrefetch: summarize(productionPrefetchSamples),
  };
  console.log(JSON.stringify(report, null, 2));
  if (anonymousBoot.maxCls >= clsThreshold) {
    throw new Error(`匿名 / → /login CLS 必须小于 ${clsThreshold}，实际最大值为 ${anonymousBoot.maxCls}`);
  }
  if (anonymousBoot.maxLongTaskCount > 0 || anonymousBoot.maxTbt > 0) {
    throw new Error(`匿名 / → /login 不得新增 Long Task 或 TBT，实际最大值为 ${anonymousBoot.maxLongTaskCount} 项 / ${anonymousBoot.maxTbt}ms`);
  }
  if (anonymousBoot.protectedResources.length > 0) {
    throw new Error(`匿名 / → /login 不得加载受保护路由资源：${anonymousBoot.protectedResources.join(', ')}`);
  }
} finally {
  await browser?.close();
  await stopPreview(preview);
}
