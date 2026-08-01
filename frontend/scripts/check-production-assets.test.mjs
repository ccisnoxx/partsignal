/** 使用最小构建夹具验证公开资产与 source map 门禁。 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const checker = new URL('./check-production-assets.mjs', import.meta.url);
const frontendRoot = new URL('../', import.meta.url);
const expectedFaviconLink = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
const expectedIndex = `<!doctype html><html><head>${expectedFaviconLink}<meta name="robots" content="index,follow"><meta name="description" content="PartSignal 是面向已授权用户的多平台 GEO 内容运营系统，提供内容运营、发布与效果观测入口。"></head></html>`;
const expectedFavicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28"><path d="M3 4h16" /></svg>\n';
const expectedRobots = 'User-agent: *\nAllow: /\n';
const expectedLlms = '# PartSignal\n\nPartSignal 是面向已授权用户的 GEO 内容运营系统。\n\n- [PartSignal 入口](https://geo.962850.xyz/)\n- [PartSignal 登录](https://geo.962850.xyz/login)\n';

async function runFixture(overrides = {}, environment = {}) {
  const root = await mkdtemp(join(tmpdir(), 'partsignal-production-assets-'));
  const files = {
    'index.html': expectedIndex,
    'favicon.svg': expectedFavicon,
    'robots.txt': expectedRobots,
    'llms.txt': expectedLlms,
    'assets/app.js': 'console.log("ok");\n//# sourceMappingURL=app.js.map\n',
    'assets/app.js.map': JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['../../src/app.ts'],
      sourcesContent: ['export const status = "ok";'],
      names: [],
      mappings: '',
    }),
    ...overrides,
  };
  try {
    for (const [name, source] of Object.entries(files)) {
      if (source === null) continue;
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, source, 'utf8');
    }
    return spawnSync(process.execPath, [checker.pathname, root], {
      encoding: 'utf8',
      env: { ...process.env, ...environment },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('完整且无敏感信息的公开资产通过', async () => {
  const result = await runFixture();
  assert.equal(result.status, 0, result.stderr);
});

test('favicon 声明或资源缺失会阻断构建', async () => {
  const missingLink = await runFixture({ 'index.html': expectedIndex.replace(expectedFaviconLink, '') });
  assert.notEqual(missingLink.status, 0);
  assert.match(missingLink.stderr, /index\.html: favicon-link/);

  const missingIcon = await runFixture({ 'favicon.svg': null });
  assert.notEqual(missingIcon.status, 0);
  assert.match(missingIcon.stderr, /favicon\.svg: missing/);
});

test('不完整 map、敏感凭据、env 和本机路径都会阻断构建', async () => {
  const failures = [
    { sourcesContent: [] },
    { sources: ['../../.env.production'] },
    { sourcesContent: ['const api_key = "actual-production-credential";'] },
    { sourcesContent: ['const key = "-----BEGIN PRIVATE KEY-----";'] },
    { sourcesContent: ['const path = "/Users/operator/project/file.ts";'] },
    { sourcesContent: ['const endpoint = "postgresql://partsignal:database-secret@db.invalid/app";'] },
    { sourcesContent: ['const providerCredential = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";'] },
    { sourceRoot: '/workspace/partsignal/frontend' },
    { names: null },
    { mappings: null },
  ];
  for (const mapOverride of failures) {
    const result = await runFixture({
      'assets/app.js.map': JSON.stringify({
        version: 3,
        file: 'app.js',
        sources: ['../../src/app.ts'],
        sourcesContent: ['export const status = "ok";'],
        names: [],
        mappings: '',
        ...mapOverride,
      }),
    });
    assert.notEqual(result.status, 0);
  }

  const missingMap = await runFixture({ 'assets/unmapped.js': 'console.log("unmapped");\n' });
  assert.notEqual(missingMap.status, 0);
  assert.match(missingMap.stderr, /assets\/unmapped\.js: missing-source-map/);

  const fakeMappingUrl = await runFixture({
    'assets/app.js': 'console.log("sourceMappingURL=app.js.map");\n',
  });
  assert.notEqual(fakeMappingUrl.status, 0);
  assert.match(fakeMappingUrl.stderr, /assets\/app\.js\.map: missing-source-mapping-url/);

  const ignoredExtension = await runFixture({
    'assets/server.pem': '-----BEGIN PRIVATE KEY-----',
  });
  assert.notEqual(ignoredExtension.status, 0);
  assert.match(ignoredExtension.stderr, /assets\/server\.pem: private-key/);

  const environmentSecret = 'runtime-secret-123';
  const leakedEnvironment = await runFixture(
    { 'assets/environment.bin': environmentSecret },
    { PARTSIGNAL_TEST_API_TOKEN: environmentSecret },
  );
  assert.notEqual(leakedEnvironment.status, 0);
  assert.match(leakedEnvironment.stderr, /environment-credential:PARTSIGNAL_TEST_API_TOKEN/);
  assert.doesNotMatch(leakedEnvironment.stderr, new RegExp(environmentSecret));
});

test('旧索引策略和非最小 llms 内容会阻断构建', async () => {
  const result = await runFixture({
    'index.html': '<meta name="robots" content="noindex,nofollow">',
    'llms.txt': `${expectedLlms}\n- /api/v1/internal\n`,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index\.html: robots-meta/);
  assert.match(result.stderr, /llms\.txt: unexpected-content/);
});

test('容器固定 map 的 JSON/缓存，外层统一提供 nosniff', async () => {
  const nginx = await readFile(new URL('nginx.conf', frontendRoot), 'utf8');
  const securityHeaders = await readFile(
    new URL('../deploy/nginx/partsignal-security-headers.conf', frontendRoot),
    'utf8',
  );
  assert.match(nginx, /location ~ \^\/assets\/\.\+\\\.map\$/);
  assert.match(nginx, /types \{ application\/json map; \}/);
  assert.match(nginx, /default_type application\/json;/);
  assert.match(nginx, /Cache-Control "public, max-age=31536000, immutable" always;/);
  assert.doesNotMatch(nginx, /X-Content-Type-Options/);
  assert.match(securityHeaders, /X-Content-Type-Options "nosniff" always;/);
});
