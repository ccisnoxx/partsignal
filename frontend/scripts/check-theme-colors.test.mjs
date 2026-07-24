/** 使用临时源码验证每类视觉契约都能稳定失败，合法例外保持可用。 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checker = new URL('./check-theme-colors.mjs', import.meta.url);

async function runFixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'partsignal-visual-contract-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source, 'utf8');
    }
    return spawnSync(process.execPath, [checker.pathname, root], { encoding: 'utf8' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const failures = [
  ['raw-color', '.panel { color: oklch(40% 0.1 20); }'],
  ['route-shell', '.app-shell-dashboard { padding: 8px; }'],
  ['page-token', '.panel { color: var(--um-text-primary); }'],
  ['page-font', "export const panel = <div style={{ fontFamily: 'Inter, sans-serif' }} />;"],
  ['external-visual', '@font-face { font-family: "Remote"; src: url(font.woff2); }'],
  ['arbitrary-radius', 'export const panel = <div style={{ borderRadius: 7 }} />;'],
  ['arbitrary-shadow', "export const panel = <div style={{ boxShadow: '0 8px 24px black' }} />;"],
  ['primary-gradient', '.ant-btn-primary {\n  background: linear-gradient(red, blue);\n}'],
  ['chart-color-mix', '.page-panel { background: color-mix(in srgb, var(--ps-chart-series-5) 20%, var(--ps-bg-surface)); }'],
];

for (const [rule, source] of failures) {
  test(`${rule} 会报告文件、行号和规则`, async () => {
    const name = source.startsWith('export') ? 'src/Feature.tsx' : 'src/styles/global.css';
    const result = await runFixture({ [name]: source });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${name.replaceAll('.', '\\.')}:1:${rule}:`));
  });
}

test('条件路由壳层和 index.html 非启动颜色不能绕过门禁', async () => {
  const result = await runFixture({
    'src/styles/global.css': '.app-shell:has(.products-page) .global-navigation-search { width: 20rem; }',
    'index.html': '<style>.promo { color: #fff; }</style>',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/styles\/global\.css:1:route-shell:/);
  assert.match(result.stderr, /index\.html:1:raw-color:/);
});

test('CSS font 简写不能绕过页面字体门禁', async () => {
  const result = await runFixture({ 'src/styles/global.css': '.panel { font: 14px Inter, sans-serif; }' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/styles\/global\.css:1:page-font:/);
});

test('紧凑状态圆角、胶囊圆角和 inset 不能放宽任意视觉值', async () => {
  const result = await runFixture({
    'src/styles/global.css': [
      '.panel { border-radius: 4px; }',
      '.panel-pill { border-radius: 999px; }',
      '.panel-shadow { box-shadow: 0 8px 24px var(--ps-bg-overlay), inset 0 0 0 1px var(--ps-action-primary); }',
      '.panel-inset { box-shadow: inset 0 0 0 2px var(--ps-action-primary); }',
    ].join('\n'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/styles\/global\.css:1:arbitrary-radius:/);
  assert.match(result.stderr, /src\/styles\/global\.css:2:arbitrary-radius:/);
  assert.match(result.stderr, /src\/styles\/global\.css:3:arbitrary-shadow:/);
  assert.match(result.stderr, /src\/styles\/global\.css:4:arbitrary-shadow:/);
});

test('theme.ts 只有 projectThemes 主题值区允许原始颜色', async () => {
  const result = await runFixture({
    'src/app/theme.ts': [
      "const pageAccent = '#123456';",
      'export const projectThemes: Record<ResolvedTheme, ProjectThemeTokens> = {',
      "  light: { actionPrimary: '#0066CC' },",
      '};',
    ].join('\n'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /src\/app\/theme\.ts:1:raw-color:/);
  assert.doesNotMatch(result.stderr, /src\/app\/theme\.ts:3:raw-color:/);
});

test('主题源、认证例外、语义变量和动态图形表达通过', async () => {
  const result = await runFixture({
    'src/app/theme.ts': [
      'export const projectThemes: Record<ResolvedTheme, ProjectThemeTokens> = {',
      "  light: { actionPrimary: '#123456' },",
      '};',
    ].join('\n'),
    'src/styles/global.css': [
      ':root { font-family: var(--ps-font-sans); }',
      '.panel { border-radius: var(--ps-radius-md); box-shadow: var(--ps-shadow-sm); }',
      '.status-tag-compact { border-radius: 4px; }',
      '.geo-insight-rate-bar-track { border-radius: 999px; }',
      '.review-queue-platform::before { box-shadow: 0 0 0 3px var(--ps-action-primary-soft); }',
      '.dashboard-metric-purple { background: color-mix(in srgb, var(--ps-chart-series-5) 14%, transparent); }',
      '.login-card { border-radius: 24px; box-shadow: 0 30px 90px var(--ps-bg-overlay); }',
      '.series { color: var(--ps-geo-series-green); width: var(--geo-rate-color); }',
    ].join('\n'),
    'index.html': '<meta name="theme-color" content="#fff"><script>const canvas = "#fff";</script>',
    'package.json': '{"name":"fixture"}',
  });
  assert.equal(result.status, 0, result.stderr);
});
