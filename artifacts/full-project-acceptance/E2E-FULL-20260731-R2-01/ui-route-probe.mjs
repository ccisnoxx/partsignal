/** 以项目 Playwright 只读扫描全部当前路由的桌面、移动、请求和控制台状态。 */
import { createRequire } from 'node:module';

const frontendRequire = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { chromium } = frontendRequire('@playwright/test');

const origin = 'http://127.0.0.1:5173';
const password = process.env.PARTSIGNAL_SEED_ADMIN_PASSWORD;
if (!password) throw new Error('缺少 PARTSIGNAL_SEED_ADMIN_PASSWORD，拒绝猜测开发登录凭据');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL(url => url.pathname === '/');
  const authCookies = await context.cookies();

  const getItems = async path => {
    const response = await page.request.get(`${origin}${path}`);
    if (!response.ok()) throw new Error(`准备数据失败：${path} -> ${response.status()}`);
    return (await response.json()).items ?? [];
  };
  const products = await getItems('/api/v1/products?page=1&page_size=100');
  const tasks = await getItems('/api/v1/content-tasks');
  const publications = await getItems('/api/v1/publication-records?page=1&page_size=10');
  const attentions = await getItems('/api/v1/publication-attentions');
  const observations = await getItems('/api/v1/geo-observations?page=1&page_size=20&sort_order=DESC');
  const channels = await getItems('/api/v1/ai-channels?page=1&page_size=10');
  if (!products[0] || !tasks[0] || !publications[0] || !attentions[0] || !observations[0] || !channels[0]) {
    throw new Error('共享开发数据不足，无法解析全部动态路由');
  }
  let task;
  let versions = [];
  for (const candidate of tasks) {
    const items = await getItems(`/api/v1/content-tasks/${candidate.id}/content-versions`);
    if (items[0]) {
      task = candidate;
      versions = items;
      break;
    }
  }
  if (!task || !versions[0]) throw new Error('共享开发数据缺少内容版本');

  const targets = [
    ['/change-password', '/change-password'], ['/', '/'], ['/products', '/products'],
    ['/products/:productId', `/products/${products[0].id}`], ['/tasks', '/tasks'],
    ['/tasks/:taskId', `/tasks/${task.id}`], ['/content/:contentVersionId', `/content/${versions[0].id}`],
    ['/publications', '/publications'], ['/publications/:publicationId', `/publications/${publications[0].id}`],
    ['/publication-attentions/:attentionId', `/publication-attentions/${attentions[0].id}`],
    ['/publication-attentions/:attentionId/repair', `/publication-attentions/${attentions[0].id}/repair`],
    ['/observations', '/observations'], ['/observations/insights', '/observations/insights'],
    ['/observations/insights/print', '/observations/insights/print'], ['/observations/topics', '/observations/topics'],
    ['/observations/:observationId/correct', `/observations/${observations[0].id}/correct`],
    ['/settings', '/settings'], ['/users', '/users'], ['/audit', '/audit'],
    ['/configuration', '/configuration'], ['/configuration/ai', '/configuration/ai'],
    ['/configuration/ai/channels/:channelId', `/configuration/ai/channels/${channels[0].id}`],
    ['/configuration/platform-types', '/configuration/platform-types'],
    ['/configuration/platforms', '/configuration/platforms'], ['/configuration/prompts', '/configuration/prompts'],
    ['*', '/qa2-route-not-found'],
  ];
  const results = [];
  let active;
  const sanitize = value => String(value)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/([?&](?:token|key|password)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 180);
  page.on('console', message => {
    if (active && message.type() === 'error') active.signals.push(`console:${sanitize(message.text())}`);
  });
  page.on('pageerror', error => active?.signals.push(`pageerror:${sanitize(error.message)}`));
  page.on('requestfailed', request => {
    const error = request.failure()?.errorText ?? '';
    if (!active || error.includes('ERR_ABORTED')) return;
    active.signals.push(`requestfailed:${request.method()} ${new URL(request.url()).pathname} ${sanitize(error)}`);
  });
  page.on('response', response => {
    if (!active) return;
    const url = new URL(response.url());
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return;
    active.apiRequests += 1;
    if (response.status() >= 400) active.apiFailures.push(`${response.status()} ${sanitize(url.pathname)}`);
  });

  const scan = async (pattern, path, viewport) => {
    active = { apiRequests: 0, apiFailures: [], signals: [] };
    await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.route-loading').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await page.locator('.ant-spin-spinning').first().waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.locator('h1:visible').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    const layout = await page.evaluate(() => {
      const button = document.querySelector('[aria-label="切换导航"]');
      const box = button?.getBoundingClientRect();
      const visibleHeadings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .filter(element => getComputedStyle(element).display !== 'none');
      return {
        headings: visibleHeadings.map(element => `${element.tagName}:${element.textContent?.trim() ?? ''}`),
        h1: visibleHeadings.filter(element => element.tagName === 'H1').map(element => element.textContent?.trim() ?? ''),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        touch: box ? Math.min(Math.round(box.width), Math.round(box.height)) : null,
      };
    });
    results.push({ pattern, viewport, finalPath: new URL(page.url()).pathname, ...layout, ...active });
    active = undefined;
  };

  for (const [width, height] of [[1440, 1000], [375, 900]]) {
    const viewport = `${width}x${height}`;
    await page.setViewportSize({ width, height });
    await context.clearCookies();
    await scan('/login', '/login', viewport);
    await context.addCookies(authCookies);
    for (const [pattern, path] of targets) await scan(pattern, path, viewport);
  }
  const summary = {
    routePatterns: 26,
    scans: results.length,
    overflowFailures: results.filter(item => item.overflow > 0).map(item => `${item.pattern}@${item.viewport}`),
    missingHeadings: results.filter(item => item.headings.length === 0).map(item => `${item.pattern}@${item.viewport}`),
    touchFailures: results.filter(item => item.touch !== null && item.touch < 44).map(item => `${item.pattern}@${item.viewport}:${item.touch}`),
    apiFailures: results.flatMap(item => item.apiFailures.map(failure => `${item.pattern}@${item.viewport}:${failure}`)),
    signals: results.flatMap(item => item.signals.map(signal => `${item.pattern}@${item.viewport}:${signal}`)),
    results: results.map(({ headings: _headings, ...item }) => item),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.overflowFailures.length || summary.missingHeadings.length || summary.touchFailures.length
    || summary.apiFailures.length || summary.signals.length) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
