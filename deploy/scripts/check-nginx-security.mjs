/** 校验主题脚本、DOM sink、CSP 和外层 Nginx 模板保持同一安全契约。 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');
const markdownSinkOwners = new Map([
  ['frontend/src/features/configuration/PromptOutputPreview.tsx', { count: 1, values: ['safeHtml'] }],
  ['frontend/src/features/content-editor/ContentEditorPage.tsx', { count: 2, values: ['safeHtml'] }],
  ['frontend/src/features/content-editor/RevisionForm.tsx', { count: 1, values: ['preview'] }],
  ['frontend/src/features/content-tasks/ContentTasksPage.tsx', { count: 1, values: ['preview'] }],
  ['frontend/src/features/product-facts/ProductFactsPage.tsx', { count: 1, values: ['safeHtml'] }],
]);

async function sourceFiles(path) {
  const entries = await readdir(`${root}/${path}`, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [child] : [];
  }));
  return nested.flat();
}

const [html, themeScript, snippet, productionTemplate, stagingTemplate, containerConfig] = await Promise.all([
  read('frontend/index.html'),
  read('frontend/public/theme-init.js'),
  read('deploy/nginx/partsignal-security-headers.conf'),
  read('deploy/nginx/partsignal.conf.template'),
  read('deploy/nginx/partsignal.staging.conf.template'),
  read('frontend/nginx.conf'),
]);
const templates = [productionTemplate, stagingTemplate];

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/(?:^|\s)src\s*=/.test(attributes));
if (inlineScripts.length !== 0) {
  throw new Error(`frontend/index.html 不得包含内联脚本，当前为 ${inlineScripts.length} 个`);
}

const themeScriptTag = '<script src="/theme-init.js"></script>';
if (!html.includes(themeScriptTag) || html.indexOf(themeScriptTag) > html.indexOf('<script type="module" src="/src/main.tsx"></script>')) {
  throw new Error('frontend/index.html 必须在 React 入口前同步加载 /theme-init.js');
}
if (!themeScript.includes("'partsignal.theme-mode'")) {
  throw new Error('frontend/public/theme-init.js 缺少主题偏好恢复逻辑');
}

const csp = `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; trusted-types dompurify; require-trusted-types-for 'script'`;
const requiredLines = [
  `add_header Content-Security-Policy "${csp}" always;`,
  'add_header Strict-Transport-Security "max-age=31536000" always;',
  'add_header Cross-Origin-Opener-Policy "same-origin" always;',
  'add_header X-Frame-Options "DENY" always;',
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
];

for (const line of requiredLines) {
  if (!snippet.split('\n').includes(line)) throw new Error(`项目安全头缺失或已漂移：${line}`);
}
if (snippet.trim().split('\n').length !== requiredLines.length) {
  throw new Error('项目安全头只能包含经过检查的六项响应头');
}
if (/script-src[^;]*'unsafe-inline'/.test(snippet)) {
  throw new Error("CSP script-src 不得使用 'unsafe-inline'");
}
if (/script-src[^;]*'unsafe-eval'/.test(snippet)) {
  throw new Error("CSP script-src 不得使用 'unsafe-eval'");
}
if (/script-src[^;]*'sha256-/.test(snippet)) {
  throw new Error('外置主题脚本后 CSP 不得保留脚本哈希');
}

for (const [index, template] of templates.entries()) {
  const path = index === 0
    ? 'deploy/nginx/partsignal.conf.template'
    : 'deploy/nginx/partsignal.staging.conf.template';
  if (!template.includes('include /etc/nginx/snippets/partsignal-security-headers.conf;')) {
    throw new Error(`${path} 未引用 PartSignal 项目安全头`);
  }
  if (!template.includes('add_header_inherit merge;')) {
    throw new Error(`${path} 未启用 add_header 合并继承`);
  }
  if (template.includes('security-headers-web.conf')) {
    throw new Error(`${path} 仍依赖宿主机共享安全头`);
  }
  if (/add_header\s+(?:Content-Security-Policy|Strict-Transport-Security|Cross-Origin-Opener-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy)\b/.test(template)) {
    throw new Error(`${path} 重复定义了项目安全头`);
  }
}
if (/add_header\s+(?:Content-Security-Policy|Strict-Transport-Security|Cross-Origin-Opener-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy)\b/.test(containerConfig)) {
  throw new Error('frontend/nginx.conf 不得重复定义由外层站点持有的安全头');
}

const sources = await sourceFiles('frontend/src');
const dangerousDomApis = [
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /\.insertAdjacentHTML\s*\(/,
  /\bdocument\.write(?:ln)?\s*\(/,
  /\.createContextualFragment\s*\(/,
];
for (const path of sources) {
  const source = await read(path);
  for (const pattern of dangerousDomApis) {
    if (pattern.test(source)) throw new Error(`${path} 使用了未经共享 Markdown 边界持有的 DOM HTML sink`);
  }

  const sinkCount = [...source.matchAll(/dangerouslySetInnerHTML\s*=/g)].length;
  if (sinkCount === 0) continue;
  const sinks = [...source.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([A-Za-z_$][\w$]*)\s*\}\}/g)];
  const owner = markdownSinkOwners.get(path);
  if (!owner || sinks.length !== sinkCount || sinkCount !== owner.count || sinks.some((match) => !owner.values.includes(match[1]))) {
    throw new Error(`${path} 的 dangerouslySetInnerHTML 未登记到共享 Markdown 安全边界`);
  }
  if (!source.includes("from '../../shared/markdown'") || !source.includes('renderSanitizedMarkdown(')) {
    throw new Error(`${path} 的 Markdown sink 未调用 renderSanitizedMarkdown`);
  }
  for (const value of owner.values) {
    const assignments = [...source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${value}\\s*=`, 'g'))].length;
    const sanitizedAssignments = [...source.matchAll(new RegExp(
      `\\b(?:const|let|var)\\s+${value}\\s*=\\s*(?:renderSanitizedMarkdown\\(|useMemo\\(\\s*\\(\\)\\s*=>\\s*renderSanitizedMarkdown\\()`,
      'g',
    ))].length;
    if (assignments !== sanitizedAssignments) {
      throw new Error(`${path} 的 ${value} 并非全部由 renderSanitizedMarkdown 生成`);
    }
  }
}
for (const [path, owner] of markdownSinkOwners) {
  const source = await read(path);
  const sinkCount = [...source.matchAll(/dangerouslySetInnerHTML\s*=/g)].length;
  if (sinkCount !== owner.count) throw new Error(`${path} 的 Markdown sink 数量已漂移`);
}

console.log('Nginx 安全头、外置主题脚本与 DOM sink 所有权校验通过');
