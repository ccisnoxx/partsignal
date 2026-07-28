/** 校验公开发现资产、完整 source map 与发布前敏感信息边界。 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const distRoot = process.argv[2] ? resolve(process.argv[2]) : join(frontendRoot, 'dist');
const expectedRobots = 'User-agent: *\nAllow: /\n';
const expectedLlms = [
  '# PartSignal',
  '',
  'PartSignal 是面向已授权用户的 GEO 内容运营系统。',
  '',
  '- [PartSignal 入口](https://geo.962850.xyz/)',
  '- [PartSignal 登录](https://geo.962850.xyz/login)',
  '',
].join('\n');
const expectedDescription = 'PartSignal 是面向已授权用户的多平台 GEO 内容运营系统，提供内容运营、发布与效果观测入口。';
const sensitivePatterns = [
  ['private-key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ['credential-url', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i],
  ['openai-api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['sensitive-vite-env', /\bVITE_[A-Z0-9_]*(?:API_KEY|CREDENTIAL|PASSWORD|PRIVATE|SECRET|TOKEN)[A-Z0-9_]*\b/],
  ['assigned-credential', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|authorization)\b\s*[:=]\s*["'`](?!\s*(?:<[^>]+>|\$\{|process\.env|import\.meta\.env|redacted|placeholder))[^"'`\r\n]{8,}["'`]/i],
];
const localPathPattern = /(?:file:\/\/\/|\/(?:Users|home|root|tmp|var\/(?:folders|tmp)|private\/var\/folders|Volumes|workspace|workspaces|mnt)\/[^\s"'`]+|(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s"'`]+)/;
const envPathPattern = /(?:^|[/\\])\.env(?:$|[./\\])/i;
const sensitiveEnvNames = /(?:API_KEY|CREDENTIAL|PASSWORD|PRIVATE|SECRET|TOKEN)/i;
const sensitiveEnvValues = Object.entries(process.env)
  .filter(([name, value]) => sensitiveEnvNames.test(name) && (value?.length ?? 0) >= 12);
const violations = [];

function report(name, rule) {
  violations.push(`${name}: ${rule}`);
}

function inspectSensitiveText(name, source) {
  if (localPathPattern.test(source)) report(name, 'absolute-local-path');
  for (const [rule, pattern] of sensitivePatterns) {
    if (pattern.test(source)) report(name, rule);
  }
  for (const [envName, envValue] of sensitiveEnvValues) {
    const escapedEnvValue = JSON.stringify(envValue).slice(1, -1);
    if (source.includes(envValue) || source.includes(escapedEnvValue)) {
      report(name, `environment-credential:${envName}`);
    }
  }
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

async function readRequired(name) {
  try {
    return await readFile(join(distRoot, name), 'utf8');
  } catch {
    report(name, 'missing');
    return '';
  }
}

const indexHtml = await readRequired('index.html');
const robots = await readRequired('robots.txt');
const llms = await readRequired('llms.txt');

const robotsMatches = indexHtml.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']\s*\/?>/gi) ?? [];
if (robotsMatches.length !== 1 || !/content=["']index,follow["']/.test(robotsMatches[0])) {
  report('index.html', 'robots-meta');
}
const descriptionMatches = indexHtml.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']\s*\/?>/gi) ?? [];
if (descriptionMatches.length !== 1 || !descriptionMatches[0].includes(`content="${expectedDescription}"`)) {
  report('index.html', 'meta-description');
}
if (robots !== expectedRobots) report('robots.txt', 'unexpected-content');
if (llms !== expectedLlms) report('llms.txt', 'unexpected-content');

let files = [];
try {
  files = await listFiles(distRoot);
} catch {
  report(relative(frontendRoot, distRoot), 'missing-directory');
}

const mapPaths = files.filter((path) => path.endsWith('.map'));
if (mapPaths.length === 0) report('assets', 'missing-source-maps');
for (const path of files.filter((candidate) => (
  candidate.endsWith('.js') && relative(distRoot, candidate).startsWith(`assets${process.platform === 'win32' ? '\\' : '/'}`)
))) {
  if (!mapPaths.includes(`${path}.map`)) report(relative(distRoot, path), 'missing-source-map');
}

for (const path of files) {
  const name = relative(distRoot, path);
  if (envPathPattern.test(name)) report(name, 'env-file');
  const source = await readFile(path, 'utf8');
  inspectSensitiveText(name, source);
  if (!path.endsWith('.map')) continue;

  let map;
  try {
    map = JSON.parse(source);
  } catch {
    report(name, 'invalid-json');
    continue;
  }
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const sourcesContent = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
  if (map.version !== 3) report(name, 'source-map-version');
  if (sources.length === 0) report(name, 'missing-sources');
  if (!Array.isArray(map.names)) report(name, 'invalid-names');
  if (typeof map.mappings !== 'string') report(name, 'invalid-mappings');
  if (
    !Array.isArray(map.sourcesContent)
    || sourcesContent.length !== sources.length
    || sourcesContent.some((content) => typeof content !== 'string')
  ) {
    report(name, 'incomplete-sources-content');
  }
  if (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string') {
    report(name, 'invalid-source-root');
  } else if (typeof map.sourceRoot === 'string') {
    if (envPathPattern.test(map.sourceRoot)) report(name, 'env-source-root');
    if (
      localPathPattern.test(map.sourceRoot)
      || map.sourceRoot.startsWith('/')
      || /^[A-Za-z]:[\\/]/.test(map.sourceRoot)
    ) {
      report(name, 'absolute-source-root');
    }
  }
  for (const sourcePath of sources) {
    if (typeof sourcePath !== 'string') {
      report(name, 'invalid-source-path');
      continue;
    }
    if (envPathPattern.test(sourcePath)) report(name, 'env-source');
    if (localPathPattern.test(sourcePath) || sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(sourcePath)) {
      report(name, 'absolute-source-path');
    }
  }
  for (const [index, content] of sourcesContent.entries()) {
    if (typeof content === 'string') inspectSensitiveText(`${name}#sourcesContent[${index}]`, content);
  }

  const compiledPath = path.slice(0, -'.map'.length);
  if (map.file !== basename(compiledPath)) report(name, 'source-map-file');
  let compiled = '';
  try {
    compiled = await readFile(compiledPath, 'utf8');
  } catch {
    report(name, 'missing-compiled-asset');
  }
  const sourceMappingUrls = [
    ...compiled.matchAll(/(?:\/\/[#@]\s*|\/\*[#@]\s*)sourceMappingURL=([^\s*]+)/g),
  ].map((match) => match[1]);
  if (sourceMappingUrls.length !== 1 || sourceMappingUrls[0] !== basename(path)) {
    report(name, 'missing-source-mapping-url');
  }
}

if (violations.length > 0) {
  console.error(`生产公开资产检查失败：\n${[...new Set(violations)].join('\n')}`);
  process.exitCode = 1;
}
