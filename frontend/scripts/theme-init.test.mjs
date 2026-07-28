/** 验证外置主题启动脚本在 React 启动前独立处理全部持久化边界。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');

function runThemeInit({ stored, dark, storage = 'available' }) {
  const root = { dataset: {}, style: {} };
  const meta = { content: '' };
  const removed = [];
  const warnings = [];
  const context = {
    console: { warn: (...args) => warnings.push(args) },
    document: {
      documentElement: root,
      querySelector: () => meta,
    },
    matchMedia: () => ({ matches: dark }),
  };
  if (storage === 'available') {
    context.localStorage = {
      getItem: () => stored,
      removeItem: (key) => removed.push(key),
    };
  } else if (storage === 'throws') {
    context.localStorage = {
      getItem: () => { throw new Error('storage blocked'); },
      removeItem: () => undefined,
    };
  }
  vm.runInNewContext(source, context);
  return { root, meta, removed, warnings };
}

test('显式浅色和深色不受系统配色影响', () => {
  const light = runThemeInit({ stored: 'light', dark: true });
  assert.deepEqual(light.root.dataset, { themeMode: 'light', theme: 'light' });
  assert.equal(light.meta.content, '#F4F7FC');

  const dark = runThemeInit({ stored: 'dark', dark: false });
  assert.deepEqual(dark.root.dataset, { themeMode: 'dark', theme: 'dark' });
  assert.equal(dark.meta.content, '#111827');
});

test('跟随系统模式按媒体查询解析首帧', () => {
  const light = runThemeInit({ stored: 'system', dark: false });
  const dark = runThemeInit({ stored: 'system', dark: true });
  assert.deepEqual(light.root.dataset, { themeMode: 'system', theme: 'light' });
  assert.deepEqual(dark.root.dataset, { themeMode: 'system', theme: 'dark' });
});

test('无 localStorage 时回到跟随系统且不中断启动', () => {
  const result = runThemeInit({ dark: true, storage: 'missing' });
  assert.deepEqual(result.root.dataset, { themeMode: 'system', theme: 'dark' });
  assert.equal(result.warnings.length, 1);
});

test('存储访问异常和无效值分别显式告警或清理', () => {
  const blocked = runThemeInit({ dark: false, storage: 'throws' });
  assert.deepEqual(blocked.root.dataset, { themeMode: 'system', theme: 'light' });
  assert.equal(blocked.warnings.length, 1);

  const invalid = runThemeInit({ stored: 'midnight', dark: false });
  assert.deepEqual(invalid.removed, ['partsignal.theme-mode']);
  assert.deepEqual(invalid.root.dataset, { themeMode: 'system', theme: 'light' });
});
