/** 校验主题启动脚本、CSP 和外层 Nginx 模板保持同一安全契约。 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');
const [html, snippet, productionTemplate, stagingTemplate, containerConfig] = await Promise.all([
  read('frontend/index.html'),
  read('deploy/nginx/partsignal-security-headers.conf'),
  read('deploy/nginx/partsignal.conf.template'),
  read('deploy/nginx/partsignal.staging.conf.template'),
  read('frontend/nginx.conf'),
]);
const templates = [productionTemplate, stagingTemplate];

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/(?:^|\s)src\s*=/.test(attributes));
if (inlineScripts.length !== 1) {
  throw new Error(`frontend/index.html 必须只有一个无 src 的内联脚本，当前为 ${inlineScripts.length} 个`);
}

const hash = createHash('sha256').update(inlineScripts[0][2], 'utf8').digest('base64');
const csp = `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:`;
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

console.log(`Nginx 安全头与主题脚本校验通过：sha256-${hash}`);
