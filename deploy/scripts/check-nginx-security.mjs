/** 校验 canonical Frontend 的 HTML、Markdown、DOM sink、CSP 和 Nginx 安全合同。 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url));
const ts = frontendRequire('typescript');

async function sourceFiles(path) {
  const entries = await readdir(`${root}/${path}`, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [child] : [];
  }));
  return nested.flat();
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticString(expression, aliases) {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isIdentifier(value)) return aliases.get(value.text);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(value.left, aliases);
    const right = staticString(value.right, aliases);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function memberName(expression, aliases = new Map()) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return staticString(expression.argumentExpression, aliases);
  }
  return undefined;
}

function isDocumentWrite(expression, stringAliases = new Map(), documentAliases = new Set(['document'])) {
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) {
    return false;
  }
  const owner = unwrapExpression(expression.expression);
  return ts.isIdentifier(owner)
    && documentAliases.has(owner.text)
    && ['write', 'writeln'].includes(memberName(expression, stringAliases));
}

function assertNoUnsafeDomSinks(path, source) {
  const scriptKind = ts.getScriptKindFromFileName(path);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const stringAliases = new Map();
  const documentAliases = new Set(['document']);
  const dangerousMethodAliases = new Set();

  function visit(node) {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrapExpression(node.left);
      if (['innerHTML', 'outerHTML', 'srcdoc'].includes(memberName(left, stringAliases))) {
        throw new Error(`${path} 使用了未登记的 DOM HTML sink`);
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const calledMember = memberName(callee, stringAliases);
      if (
        ['insertAdjacentHTML', 'createContextualFragment', 'parseFromString'].includes(calledMember)
        || isDocumentWrite(callee, stringAliases, documentAliases)
        || (ts.isIdentifier(callee) && dangerousMethodAliases.has(callee.text))
      ) {
        throw new Error(`${path} 使用了未登记的 DOM HTML sink`);
      }
    }

    if (ts.isJsxAttribute(node) && node.name.text === 'dangerouslySetInnerHTML') {
      throw new Error(`${path} 使用了未登记的 dangerouslySetInnerHTML`);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      const staticValue = staticString(initializer, stringAliases);
      if (staticValue !== undefined) stringAliases.set(node.name.text, staticValue);
      if (ts.isIdentifier(initializer) && documentAliases.has(initializer.text)) {
        documentAliases.add(node.name.text);
      }
      if (ts.isIdentifier(initializer) && dangerousMethodAliases.has(initializer.text)) {
        dangerousMethodAliases.add(node.name.text);
      }
      if (
        (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer))
        && (
          ['insertAdjacentHTML', 'createContextualFragment', 'parseFromString']
            .includes(memberName(initializer, stringAliases))
          || isDocumentWrite(initializer, stringAliases, documentAliases)
        )
      ) {
        dangerousMethodAliases.add(node.name.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const [
  html,
  markdownEditor,
  snippet,
  maintenanceTemplate,
  productionTemplate,
  stagingTemplate,
  containerConfig,
] = await Promise.all([
  read('frontend/index.html'),
  read('frontend/src/design-system/editor/markdown-editor.tsx'),
  read('deploy/nginx/partsignal-security-headers.conf'),
  read('deploy/nginx/partsignal-maintenance.conf.template'),
  read('deploy/nginx/partsignal.conf.template'),
  read('deploy/nginx/partsignal.staging.conf.template'),
  read('frontend/nginx.conf'),
]);

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/(?:^|\s)src\s*=/.test(attributes));
if (inlineScripts.length !== 0) {
  throw new Error(`frontend/index.html 不得包含内联脚本，当前为 ${inlineScripts.length} 个`);
}

for (const marker of [
  "import ReactMarkdown from 'react-markdown';",
  "import rehypeSanitize from 'rehype-sanitize';",
  'rehypePlugins={previewPlugins}',
  'skipHtml',
  'disallowedElements={blockedPreviewElements}',
]) {
  if (!markdownEditor.includes(marker)) {
    throw new Error(`canonical Markdown 预览缺少安全边界：${marker}`);
  }
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
  throw new Error('CSP 不得保留内联脚本哈希');
}

for (const [path, template] of [
  ['deploy/nginx/partsignal-maintenance.conf.template', maintenanceTemplate],
  ['deploy/nginx/partsignal.conf.template', productionTemplate],
  ['deploy/nginx/partsignal.staging.conf.template', stagingTemplate],
]) {
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

for (const path of await sourceFiles('frontend/src')) {
  assertNoUnsafeDomSinks(path, await read(path));
}

assert.doesNotThrow(() => assertNoUnsafeDomSinks('fixture.tsx', 'export const View = () => <article />;'));
for (const fixture of [
  `const node = document.body;\nnode['innerHTML'] = rawHtml;`,
  `const sink = 'inner' + 'HTML';\nconst node = document.body;\nnode[sink] = rawHtml;`,
  `const method = 'insertAdjacentHTML';\ndocument.body[method]('beforeend', rawHtml);`,
  `const target = document;\nconst write = target.write;\nwrite(rawHtml);`,
  `export const View = () => <article dangerouslySetInnerHTML={{ __html: rawHtml }} />;`,
]) {
  assert.throws(() => assertNoUnsafeDomSinks('fixture.tsx', fixture), /DOM HTML sink|dangerouslySetInnerHTML/);
}

console.log('canonical Frontend Nginx 安全头、Markdown、HTML 与 DOM sink 校验通过');
