import { chromium } from 'playwright';
import { claimRun, createHealthServer, readConfiguration } from './service.mjs';

async function main() {
  const configuration = readConfiguration(process.env);
  if (process.argv[2] === 'claim' && process.argv.length === 4) {
    claimRun(process.argv[3], configuration);
  }
  if (process.argv.length !== 2) throw new Error('BROWSER_TASK_INVALID');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000 });
  let probing = false;
  const server = createHealthServer(configuration, async () => {
    if (probing || !browser.isConnected()) throw new Error('BROWSER_RUNTIME_UNAVAILABLE');
    probing = true;
    try {
      const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        await page.setContent('<p>GEO801_RUNTIME_PROBE</p>', { timeout: 2000 });
        if (await page.textContent('p', { timeout: 2000 }) !== 'GEO801_RUNTIME_PROBE') {
          throw new Error('BROWSER_RUNTIME_UNAVAILABLE');
        }
        return browser.version();
      } finally {
        await context.close();
      }
    } finally {
      probing = false;
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(8090, '127.0.0.1', () => resolve(undefined));
    });
  } catch (error) {
    await browser.close();
    throw error;
  }
  console.log('BROWSER_SKELETON_STARTED');
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    try {
      server.close();
      server.closeAllConnections();
      await browser.close();
      clearTimeout(deadline);
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  browser.on('disconnected', () => {
    if (!closing) {
      server.close();
      server.closeAllConnections();
      process.exitCode = 1;
    }
  });
}

main().catch((error) => {
  const safeCodes = ['BROWSER_CONFIGURATION_INVALID', 'BROWSER_TASK_INVALID',
    'COLLECTOR_DISABLED', 'BROWSER_ADAPTER_NOT_IMPLEMENTED'];
  console.error(error instanceof Error && safeCodes.includes(error.message)
    ? error.message : 'BROWSER_STARTUP_FAILED');
  process.exitCode = 1;
});
