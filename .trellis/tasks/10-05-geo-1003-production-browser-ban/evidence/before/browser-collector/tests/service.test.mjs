import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { admissionCode, claimRun, createHealthServer, readConfiguration } from '../src/service.mjs';

const runId = '7fca3868-ad19-44ef-9d81-deb3d595ed29';

test('默认关闭与父子配置拒绝；未知值不回退', () => {
  assert.equal(admissionCode(readConfiguration({})), 'COLLECTOR_DISABLED');
  for (const value of ['', 'unknown', 'false ']) {
    assert.throws(() => readConfiguration({ GEO_MONITORING_ENABLED: value }),
      /BROWSER_CONFIGURATION_INVALID/);
  }
  assert.throws(() => readConfiguration({ GEO_BROWSER_COLLECTION_ENABLED: 'true' }),
    /BROWSER_CONFIGURATION_INVALID/);
  assert.throws(() => readConfiguration({ GEO_BROWSER_KILL_SWITCH_FILE: 'relative' }),
    /BROWSER_CONFIGURATION_INVALID/);
});

test('仅 UUID 入口；开关和热停止不领取 lease；未实现采集显式拒绝', () => {
  const directory = mkdtempSync(join(tmpdir(), 'geo801-'));
  const marker = join(directory, 'STOP');
  const configuration = readConfiguration({
    GEO_MONITORING_ENABLED: 'true', GEO_BROWSER_COLLECTION_ENABLED: 'true',
    GEO_BROWSER_KILL_SWITCH_FILE: marker,
  });
  try {
    assert.throws(() => claimRun(runId, configuration), /BROWSER_ADAPTER_NOT_IMPLEMENTED/);
    for (const value of [null, { run_id: runId, prompt: '禁止正文' }, runId + '?secret=canary']) {
      assert.throws(() => claimRun(value, configuration), /BROWSER_TASK_INVALID/);
    }
    writeFileSync(marker, '');
    assert.throws(() => claimRun(runId, configuration), /COLLECTOR_DISABLED/);
    rmSync(marker);
    assert.throws(() => claimRun(runId, configuration), /BROWSER_ADAPTER_NOT_IMPLEMENTED/);
    symlinkSync(join(directory, 'missing'), marker);
    assert.throws(() => claimRun(runId, configuration), /COLLECTOR_DISABLED/);
    rmSync(marker);
    rmSync(directory, { recursive: true });
    assert.throws(() => claimRun(runId, configuration), /COLLECTOR_DISABLED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('健康需要实际 runtime 结果；失败摘要不暴露异常；无任务 HTTP 入口', async () => {
  let unavailable = false;
  const server = createHealthServer(readConfiguration({}), async () => {
    if (unavailable) throw new Error('Cookie canary /secret/path');
    return 'unit-runtime-version';
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(url + '/health')).json();
    assert.equal(health.collection, 'COLLECTOR_DISABLED');
    assert.equal(health.session_probe, 'NOT_IMPLEMENTED');
    assert.equal(health.browser_runtime, 'unit-runtime-version');
    assert.equal((await fetch(url + '/claim', { method: 'POST' })).status, 404);
    unavailable = true;
    const failure = await fetch(url + '/health');
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { status: 'error', code: 'BROWSER_RUNTIME_UNAVAILABLE' });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
