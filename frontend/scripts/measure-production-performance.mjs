/** 在固定生产网络条件下分离路由代码、API、渲染和主线程耗时。 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const sampleCount = Number.parseInt(process.env.PARTSIGNAL_PERF_SAMPLES ?? '5', 10);
const baseUrl = process.env.PARTSIGNAL_PERF_BASE_URL ?? 'http://127.0.0.1:4173';
const shouldStartPreview = !process.env.PARTSIGNAL_PERF_BASE_URL;
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

async function waitForPreview() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // preview 启动期间连接失败是预期状态，达到上限后再显式报错。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`生产预览未在限定时间内就绪：${baseUrl}`);
}

function installConnectionPolicy(page, allowIdlePrefetch) {
  return page.addInitScript((allowIdle) => {
    const connection = { saveData: !allowIdle, effectiveType: allowIdle ? '3g' : '2g' };
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  }, allowIdlePrefetch);
}

async function installApiFixture(page, apiDurations) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const started = performance.now();
    const response = path.endsWith('/auth/me') ? json(user)
      : path.endsWith('/auth/csrf') ? json({ csrf_token: 'x'.repeat(32) })
      : path.endsWith('/dashboard/summary') ? json({ pending_fact_reviews: 7, pending_content_reviews: 4, pending_publications: 3, publication_attention: 2, recent_accuracy_errors: 5 })
      : path.endsWith('/geo-metrics') ? json({ sample_count: 48, mention_rate: 0.79, recommendation_rate: 0.46, citation_rate: 0.63, accuracy_rate: 0.92 })
      : path === '/api/v1/products' ? json({ items: [product], page: 1, page_size: 100, total: 1 })
      : { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PERF_FIXTURE_MISSING', message: `缺少性能夹具：${path}` } }) };
    await route.fulfill(response);
    apiDurations.push({ path, duration: performance.now() - started });
  });
}

async function clickMenuItemWithoutHover(page, label) {
  const item = page.getByRole('link', { name: label, exact: true }).first();
  await item.evaluate((element) => element.click());
}

async function measureContext(browser, allowIdlePrefetch) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const apiDurations = [];
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: 'cellular3g',
  });
  await installConnectionPolicy(page, allowIdlePrefetch);
  await installApiFixture(page, apiDurations);
  await page.addInitScript(() => {
    globalThis.__partsignalLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__partsignalLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.getByRole('heading', { name: '今天的内容链路' }).waitFor({ timeout: 120_000 });
  if (allowIdlePrefetch) await page.waitForTimeout(1_000);

  const navigationStart = await page.evaluate(() => performance.now());
  const coldStarted = performance.now();
  await clickMenuItemWithoutHover(page, '产品事实');
  await page.getByRole('heading', { name: '产品事实', exact: true }).waitFor({ timeout: 120_000 });
  const cold = performance.now() - coldStarted;

  await clickMenuItemWithoutHover(page, '工作台');
  await page.getByRole('heading', { name: '今天的内容链路' }).waitFor({ timeout: 120_000 });
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

let preview;
try {
  if (shouldStartPreview) {
    preview = spawn('npm', ['exec', '--', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
      stdio: 'ignore',
      env: process.env,
    });
  }
  await waitForPreview();
  const browser = await chromium.launch({ headless: true });
  const rawColdSamples = [];
  const productionPrefetchSamples = [];
  for (let index = 0; index < sampleCount; index += 1) rawColdSamples.push(await measureContext(browser, false));
  for (let index = 0; index < sampleCount; index += 1) productionPrefetchSamples.push(await measureContext(browser, true));
  await browser.close();
  console.log(JSON.stringify({
    conditions: { samples: sampleCount, latencyMs: 100, downloadBps: 200_000, viewport: '1440x1000' },
    rawCold: summarize(rawColdSamples),
    productionPrefetch: summarize(productionPrefetchSamples),
  }, null, 2));
} finally {
  preview?.kill('SIGTERM');
}
