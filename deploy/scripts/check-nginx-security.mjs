/** 校验主题脚本、DOM sink、CSP 和外层 Nginx 模板保持同一安全契约。 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url));
const ts = frontendRequire('typescript');
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

function isSanitizedInitializer(initializer) {
  const expression = unwrapExpression(initializer);
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapExpression(expression.expression);
  if (ts.isIdentifier(callee) && callee.text === 'renderSanitizedMarkdown') return true;
  if (!ts.isIdentifier(callee) || callee.text !== 'useMemo' || expression.arguments.length === 0) {
    return false;
  }
  const callback = unwrapExpression(expression.arguments[0]);
  return (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    && ts.isCallExpression(unwrapExpression(callback.body))
    && ts.isIdentifier(unwrapExpression(callback.body).expression)
    && unwrapExpression(callback.body).expression.text === 'renderSanitizedMarkdown';
}

function bindingContainsName(binding, name) {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some((element) => (
    !ts.isOmittedExpression(element) && bindingContainsName(element.name, name)
  ));
}

function assertMarkdownSinkOwnership(path, source, owner) {
  const scriptKind = ts.getScriptKindFromFileName(path);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const sinks = [];
  const declarations = new Map((owner?.values ?? []).map((value) => [value, []]));
  const mutations = new Set();
  const stringAliases = new Map();
  const documentAliases = new Set(['document']);
  const dangerousMethodAliases = new Set();
  let importsMarkdownBoundary = false;

  function visit(node) {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === '../../shared/markdown'
      && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((element) => (
        (element.propertyName ?? element.name).text === 'renderSanitizedMarkdown'
        && element.name.text === 'renderSanitizedMarkdown'
      ))
    ) {
      importsMarkdownBoundary = true;
    }

    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrapExpression(node.left);
      if (['innerHTML', 'outerHTML', 'srcdoc'].includes(memberName(left, stringAliases))) {
        throw new Error(`${path} 使用了未经共享 Markdown 边界持有的 DOM HTML sink`);
      }
      if (ts.isIdentifier(left) && declarations.has(left.text)) mutations.add(left.text);
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const calledMember = memberName(callee, stringAliases);
      if (
        ['insertAdjacentHTML', 'createContextualFragment', 'parseFromString'].includes(calledMember)
        || isDocumentWrite(callee, stringAliases, documentAliases)
        || (ts.isIdentifier(callee) && dangerousMethodAliases.has(callee.text))
      ) {
        throw new Error(`${path} 使用了未经共享 Markdown 边界持有的 DOM HTML sink`);
      }
    }

    if (ts.isJsxAttribute(node) && node.name.text === 'dangerouslySetInnerHTML') {
      const expression = node.initializer && ts.isJsxExpression(node.initializer)
        ? unwrapExpression(node.initializer.expression)
        : undefined;
      const property = expression && ts.isObjectLiteralExpression(expression)
        && expression.properties.length === 1
        && ts.isPropertyAssignment(expression.properties[0])
        && expression.properties[0].name.getText(sourceFile) === '__html'
        ? expression.properties[0]
        : undefined;
      const value = property ? unwrapExpression(property.initializer) : undefined;
      sinks.push(ts.isIdentifier(value) ? value.text : undefined);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (declarations.has(node.name.text)) {
        declarations.get(node.name.text).push(node.initializer);
      }
      if (node.initializer) {
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
    }
    if (
      ts.isParameter(node)
      && owner?.values.some((value) => bindingContainsName(node.name, value))
    ) {
      throw new Error(`${path} 的 Markdown sink 值不得由参数或解构别名注入`);
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (sinks.length === 0 && !owner) return;
  if (
    !owner
    || sinks.length !== owner.count
    || sinks.some((value) => !value || !owner.values.includes(value))
  ) {
    throw new Error(`${path} 的 dangerouslySetInnerHTML 未登记到共享 Markdown 安全边界`);
  }
  if (!importsMarkdownBoundary) {
    throw new Error(`${path} 的 Markdown sink 未导入 renderSanitizedMarkdown`);
  }
  for (const value of owner.values) {
    const valueDeclarations = declarations.get(value);
    if (
      valueDeclarations.length === 0
      || valueDeclarations.some((initializer) => !initializer || !isSanitizedInitializer(initializer))
      || mutations.has(value)
    ) {
      throw new Error(`${path} 的 ${value} 并非全部由 renderSanitizedMarkdown 生成`);
    }
  }
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

const sources = [
  ...await sourceFiles('frontend/src'),
  ...await sourceFiles('frontend/public'),
];
for (const path of sources) {
  const source = await read(path);
  assertMarkdownSinkOwnership(path, source, markdownSinkOwners.get(path));
}

const validFixture = `
  import { renderSanitizedMarkdown } from '../../shared/markdown';
  const safeHtml = renderSanitizedMarkdown(markdown);
  export const View = () => (
    <article dangerouslySetInnerHTML = {{ __html: safeHtml }} />
  );
`;
const fixtureOwner = { count: 1, values: ['safeHtml'] };
assert.doesNotThrow(() => assertMarkdownSinkOwnership('fixture.tsx', validFixture, fixtureOwner));
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    `${validFixture}\nsafeHtml = rawHtml;`,
    fixtureOwner,
  ),
  /并非全部由 renderSanitizedMarkdown 生成/,
);
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    validFixture.replace('__html: safeHtml', '__html: rawHtml'),
    fixtureOwner,
  ),
  /dangerouslySetInnerHTML 未登记/,
);
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    `const node = document.body;\nnode['innerHTML'] = rawHtml;`,
    undefined,
  ),
  /DOM HTML sink/,
);
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    `const sink = 'inner' + 'HTML';\nconst node = document.body;\nnode[sink] = rawHtml;`,
    undefined,
  ),
  /DOM HTML sink/,
);
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    `const method = 'insertAdjacentHTML';\ndocument.body[method]('beforeend', rawHtml);`,
    undefined,
  ),
  /DOM HTML sink/,
);
assert.throws(
  () => assertMarkdownSinkOwnership(
    'fixture.tsx',
    `const target = document;\nconst write = target.write;\nwrite(rawHtml);`,
    undefined,
  ),
  /DOM HTML sink/,
);

console.log('Nginx 安全头、外置主题脚本与 DOM sink 所有权校验通过');
