/** 在固定生产网络条件下分离路由代码、API、渲染和主线程耗时。 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const sampleCount = Number.parseInt(process.env.PARTSIGNAL_PERF_SAMPLES ?? '5', 10);
const baseUrl = process.env.PARTSIGNAL_PERF_BASE_URL ?? 'http://127.0.0.1:4173';
const shouldStartPreview = !process.env.PARTSIGNAL_PERF_BASE_URL;
const clsThreshold = 0.1;
const pageLongTaskThreshold = 50;
const initialTransferThreshold = 275 * 1024;
const entryCssTransferThreshold = 4 * 1024;
const domThreshold = { nodeCount: 128, maxDepth: 18, maxChildren: 9 };
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
  return cdp;
}

async function startCssCoverage(cdp) {
  const styleSheets = new Map();
  const onStyleSheet = ({ header }) => {
    if (header.origin !== 'regular' && header.origin !== 'injected') return;
    styleSheets.set(header.styleSheetId, {
      header,
      text: cdp.send('CSS.getStyleSheetText', { styleSheetId: header.styleSheetId })
        .then((result) => result.text),
    });
  };
  const onStyleSheetRemoved = ({ styleSheetId }) => styleSheets.delete(styleSheetId);
  cdp.on('CSS.styleSheetAdded', onStyleSheet);
  cdp.on('CSS.styleSheetRemoved', onStyleSheetRemoved);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await cdp.send('CSS.startRuleUsageTracking');
  return async () => {
    const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking');
    const usageByStyleSheet = new Map();
    for (const entry of ruleUsage) {
      const ranges = usageByStyleSheet.get(entry.styleSheetId) ?? [];
      ranges.push({
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        count: entry.used ? 1 : 0,
      });
      usageByStyleSheet.set(entry.styleSheetId, ranges);
    }
    const entries = await Promise.all([...styleSheets.values()].map(async ({ header, text }) => {
      return {
        url: header.sourceURL || `[inline:${header.styleSheetId}]`,
        text: await text,
        ranges: executedJsRanges([{ ranges: usageByStyleSheet.get(header.styleSheetId) ?? [] }]),
      };
    }));
    cdp.off('CSS.styleSheetAdded', onStyleSheet);
    cdp.off('CSS.styleSheetRemoved', onStyleSheetRemoved);
    await cdp.send('CSS.disable');
    await cdp.send('DOM.disable');
    return entries;
  };
}

function installPerformanceObservers(page, collectLayoutShifts = false) {
  return page.addInitScript((collectShifts) => {
    globalThis.__partsignalLongTasks = [];
    globalThis.__partsignalLongAnimationFrames = [];
    globalThis.__partsignalLayoutShifts = [];
    globalThis.__partsignalLcp = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__partsignalLongTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
          attribution: entry.attribution?.map((item) => ({
            name: item.name,
            containerType: item.containerType,
            containerName: item.containerName,
            containerId: item.containerId,
            containerSrc: item.containerSrc,
          })) ?? [],
        });
      }
    }).observe({ type: 'longtask', buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          globalThis.__partsignalLongAnimationFrames.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            renderStart: entry.renderStart,
            styleAndLayoutStart: entry.styleAndLayoutStart,
            scripts: entry.scripts.map((script) => ({
              invoker: script.invoker,
              invokerType: script.invokerType,
              sourceURL: script.sourceURL,
              sourceFunctionName: script.sourceFunctionName,
              duration: script.duration,
              executionStart: script.executionStart,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    }
    new PerformanceObserver((list) => {
      const entry = list.getEntries().at(-1);
      if (entry) {
        globalThis.__partsignalLcp = {
          startTime: entry.startTime,
          renderTime: entry.renderTime,
          loadTime: entry.loadTime,
          size: entry.size,
          tagName: entry.element?.tagName ?? null,
          id: entry.id,
          className: entry.element?.className ?? null,
          text: entry.element?.textContent?.trim().slice(0, 160) ?? null,
          url: entry.url,
        };
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
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

function mergeCoverageRanges(ranges) {
  const merged = [];
  for (const range of [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) merged.push({ start: range.start, end: range.end });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function executedJsRanges(functions) {
  const points = functions.flatMap((item) => item.ranges.flatMap((range) => [
    { offset: range.startOffset, start: true, range },
    { offset: range.endOffset, start: false, range },
  ]));
  points.sort((left, right) => {
    if (left.offset !== right.offset) return left.offset - right.offset;
    if (left.start !== right.start) return left.start ? 1 : -1;
    const leftLength = left.range.endOffset - left.range.startOffset;
    const rightLength = right.range.endOffset - right.range.startOffset;
    return left.start ? rightLength - leftLength : leftLength - rightLength;
  });
  const counts = [];
  const used = [];
  let previousOffset = 0;
  for (const point of points) {
    if (counts.at(-1) > 0 && previousOffset < point.offset) {
      const previous = used.at(-1);
      if (previous?.end === previousOffset) previous.end = point.offset;
      else used.push({ start: previousOffset, end: point.offset });
    }
    previousOffset = point.offset;
    if (point.start) counts.push(point.range.count);
    else counts.pop();
  }
  return used;
}

const coverageSelfCheck = executedJsRanges([{
  ranges: [
    { startOffset: 0, endOffset: 20, count: 1 },
    { startOffset: 5, endOffset: 15, count: 0 },
  ],
}]);
if (JSON.stringify(coverageSelfCheck) !== JSON.stringify([{ start: 0, end: 5 }, { start: 15, end: 20 }])) {
  throw new Error('JavaScript coverage 区间归并自检失败');
}

function summarizeCoverage(entries, resources) {
  return entries
    .filter((entry) => !entry.url || entry.url.startsWith(baseUrl) || entry.url.startsWith('[inline:'))
    .map((entry) => {
      const source = entry.source ?? entry.text;
      if (source === undefined) {
        throw new Error(`Coverage 缺少源码：${entry.url || '[inline]'}`);
      }
      const ranges = entry.functions ? executedJsRanges(entry.functions) : entry.ranges;
      const totalBytes = Buffer.byteLength(source);
      const usedBytes = mergeCoverageRanges(ranges)
        .reduce((total, range) => total + Buffer.byteLength(source.slice(range.start, range.end)), 0);
      const transferSize = resources.find((resource) => resource.name === entry.url)?.transferSize ?? 0;
      return {
        name: entry.url ? entry.url.split('/').pop() : '[inline-style]',
        totalBytes,
        usedBytes,
        unusedBytes: Math.max(0, totalBytes - usedBytes),
        transferSize,
        estimatedUnusedTransfer: totalBytes > 0
          ? Math.round(transferSize * Math.max(0, totalBytes - usedBytes) / totalBytes)
          : 0,
      };
    })
    .sort((left, right) => right.unusedBytes - left.unusedBytes);
}

function collectDomMetrics() {
  const body = globalThis.document.body;
  const elements = [body, ...body.querySelectorAll('*')];
  const depth = (element) => {
    let value = 0;
    let current = element;
    while (current.parentElement) {
      value += 1;
      current = current.parentElement;
    }
    return value;
  };
  return {
    nodeCount: elements.length,
    maxDepth: Math.max(0, ...elements.map(depth)),
    maxChildren: Math.max(0, ...elements.map((element) => element.children.length)),
  };
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

async function measureAnonymousBoot(browser, collectCoverage = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const apiDurations = [];
  let releaseSessionProbe;
  const authBootPainted = new Promise((resolve) => {
    releaseSessionProbe = resolve;
  });
  const cdp = await emulateNetwork(page);
  await installConnectionPolicy(page, false);
  await installApiFixture(page, apiDurations, true, authBootPainted);
  await installPerformanceObservers(page, true);
  const stopCssCoverage = collectCoverage ? await startCssCoverage(cdp) : null;
  if (collectCoverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });

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
  await page.waitForTimeout(250);

  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      layoutShifts: globalThis.__partsignalLayoutShifts,
      longTasks: globalThis.__partsignalLongTasks,
      longAnimationFrames: globalThis.__partsignalLongAnimationFrames,
      lcp: globalThis.__partsignalLcp,
      fcp: fcp?.startTime ?? null,
      navigation: navigation ? {
        responseStart: navigation.responseStart,
        responseEnd: navigation.responseEnd,
        domContentLoaded: navigation.domContentLoadedEventEnd,
      } : null,
      resources: performance.getEntriesByType('resource').map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        responseEnd: entry.responseEnd,
        transferSize: entry.transferSize,
      })),
    };
  });
  const dom = await page.evaluate(collectDomMetrics);
  const [jsCoverage, cssCoverage] = collectCoverage ? await Promise.all([
    page.coverage.stopJSCoverage(),
    stopCssCoverage(),
  ]) : [[], []];
  await context.close();
  return {
    cls: calculateCls(metrics.layoutShifts),
    tbt: metrics.longTasks.reduce((total, entry) => total + Math.max(0, entry.duration - 50), 0),
    authRequestCount: apiDurations.filter((item) => item.path === '/api/v1/auth/me').length,
    initialTransferSize: metrics.resources.reduce((total, entry) => total + entry.transferSize, 0),
    protectedResources: metrics.resources
      .filter((entry) => /AppLayout|ChangePasswordPage|workspace\.css/.test(entry.name))
      .map((entry) => entry.name),
    maxApi: Math.max(...apiDurations.map((item) => item.duration)),
    apiDurations,
    dom,
    coverage: {
      js: summarizeCoverage(jsCoverage, metrics.resources),
      css: summarizeCoverage(cssCoverage, metrics.resources),
    },
    ...metrics,
  };
}

async function measureControl(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await installPerformanceObservers(page);
  await page.goto(url);
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));
  const longTasks = await page.evaluate(() => globalThis.__partsignalLongTasks);
  await context.close();
  return longTasks;
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

function summarizeAnonymous(samples, coverageSample) {
  const sortedTbt = samples.map((item) => item.tbt).sort((left, right) => left - right);
  const longAnimationFrames = samples.flatMap((item) => item.longAnimationFrames);
  return {
    maxCls: Math.max(...samples.map((item) => item.cls)),
    maxLongTask: Math.max(0, ...samples.flatMap((item) => item.longTasks.map((entry) => entry.duration))),
    maxLongAnimationFrame: Math.max(0, ...longAnimationFrames.map((entry) => entry.duration)),
    scriptlessLongAnimationFrameCount: longAnimationFrames
      .filter((entry) => entry.duration > 50 && entry.scripts.length === 0).length,
    longAnimationFrameScripts: [...new Set(longAnimationFrames.flatMap((entry) => entry.scripts)
      .map((script) => `${script.sourceURL || '[inline]'}:${script.sourceFunctionName || script.invoker || '[anonymous]'}`))],
    maxLongTaskCount: Math.max(...samples.map((item) => item.longTasks.length)),
    maxTbt: Math.max(...samples.map((item) => item.tbt)),
    medianTbt: sortedTbt[Math.floor(sortedTbt.length / 2)],
    maxFcp: Math.max(0, ...samples.map((item) => item.fcp ?? 0)),
    maxLcp: Math.max(0, ...samples.map((item) => item.lcp?.startTime ?? 0)),
    maxLcpRenderDelay: Math.max(0, ...samples.map((item) => (
      item.lcp && item.navigation ? item.lcp.startTime - item.navigation.responseStart : 0
    ))),
    maxInitialTransferSize: Math.max(...samples.map((item) => item.initialTransferSize)),
    maxEntryCssTransferSize: Math.max(...samples.map((item) => item.resources
      .filter((entry) => entry.initiatorType === 'link' && new URL(entry.name).pathname.endsWith('.css'))
      .reduce((total, entry) => total + entry.transferSize, 0))),
    maxAuthRequestCount: Math.max(...samples.map((item) => item.authRequestCount)),
    maxDom: {
      nodeCount: Math.max(...samples.map((item) => item.dom.nodeCount)),
      maxDepth: Math.max(...samples.map((item) => item.dom.maxDepth)),
      maxChildren: Math.max(...samples.map((item) => item.dom.maxChildren)),
    },
    unusedJs: coverageSample.coverage.js.reduce((total, entry) => total + entry.unusedBytes, 0),
    estimatedUnusedJsTransfer: coverageSample.coverage.js
      .reduce((total, entry) => total + entry.estimatedUnusedTransfer, 0),
    observedUnusedCssSourceBytes: coverageSample.coverage.css
      .reduce((total, entry) => total + entry.unusedBytes, 0),
    protectedResources: [...new Set(samples.flatMap((item) => item.protectedResources))],
    samples,
  };
}

function summarizeControls(samples) {
  return {
    maxLongTask: Math.max(0, ...samples.flatMap((sample) => sample.map((entry) => entry.duration))),
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
  const blankControlSamples = [];
  const staticControlSamples = [];
  const anonymousCoverage = await measureAnonymousBoot(browser, true);
  for (let index = 0; index < sampleCount; index += 1) anonymousBootSamples.push(await measureAnonymousBoot(browser));
  for (let index = 0; index < sampleCount; index += 1) rawColdSamples.push(await measureContext(browser, false));
  for (let index = 0; index < sampleCount; index += 1) productionPrefetchSamples.push(await measureContext(browser, true));
  for (let index = 0; index < sampleCount; index += 1) blankControlSamples.push(await measureControl(browser, 'about:blank'));
  for (let index = 0; index < sampleCount; index += 1) {
    staticControlSamples.push(await measureControl(browser, 'data:text/html,<main><h1>PartSignal</h1><p>Static control</p></main>'));
  }
  const anonymousBoot = summarizeAnonymous(anonymousBootSamples, anonymousCoverage);
  const report = {
    conditions: { samples: sampleCount, latencyMs: 100, downloadBps: 200_000, viewport: '1440x1000' },
    anonymousBoot,
    anonymousCoverage,
    controls: {
      blank: summarizeControls(blankControlSamples),
      static: summarizeControls(staticControlSamples),
    },
    rawCold: summarize(rawColdSamples),
    productionPrefetch: summarize(productionPrefetchSamples),
  };
  console.log(JSON.stringify(report, null, 2));
  if (anonymousBoot.maxCls >= clsThreshold) {
    throw new Error(`匿名 / → /login CLS 必须小于 ${clsThreshold}，实际最大值为 ${anonymousBoot.maxCls}`);
  }
  if (
    anonymousBoot.maxLongTask > pageLongTaskThreshold
    || anonymousBoot.medianTbt > 50
    || anonymousBoot.maxTbt > 100
  ) {
    throw new Error(`匿名 / → /login 主线程超限：最长任务 ${anonymousBoot.maxLongTask}ms，TBT 中位数/最大值 ${anonymousBoot.medianTbt}/${anonymousBoot.maxTbt}ms`);
  }
  if (anonymousBoot.maxInitialTransferSize > initialTransferThreshold) {
    throw new Error(`匿名 / → /login 初始传输不得超过 ${initialTransferThreshold} B，实际为 ${anonymousBoot.maxInitialTransferSize} B`);
  }
  if (anonymousBoot.maxEntryCssTransferSize > entryCssTransferThreshold) {
    throw new Error(`匿名 / → /login 入口 CSS 不得超过 ${entryCssTransferThreshold} B，实际为 ${anonymousBoot.maxEntryCssTransferSize} B`);
  }
  for (const [metric, threshold] of Object.entries(domThreshold)) {
    if (anonymousBoot.maxDom[metric] > threshold) {
      throw new Error(`匿名 / → /login DOM ${metric} 不得超过 ${threshold}，实际为 ${anonymousBoot.maxDom[metric]}`);
    }
  }
  if (report.controls.blank.maxLongTask > 0 || report.controls.static.maxLongTask > 0) {
    throw new Error(`性能对照页不得出现 Long Task，空白/静态最大值为 ${report.controls.blank.maxLongTask}/${report.controls.static.maxLongTask}ms`);
  }
  if (anonymousBoot.protectedResources.length > 0) {
    throw new Error(`匿名 / → /login 不得加载受保护路由资源：${anonymousBoot.protectedResources.join(', ')}`);
  }
  if (anonymousBoot.maxAuthRequestCount !== 1) {
    throw new Error(`匿名 / → /login 必须且只能请求一次 /auth/me，实际最大值为 ${anonymousBoot.maxAuthRequestCount}`);
  }
} finally {
  await browser?.close();
  await stopPreview(preview);
}
