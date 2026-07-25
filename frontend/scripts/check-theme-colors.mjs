/** 阻止业务代码绕过 PartSignal 的视觉 Token、统一壳层和既有技术栈。 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const customRoot = process.argv[2] ? resolve(process.argv[2]) : null;
const scanRoot = customRoot ?? frontendRoot;
const sourceExtensions = new Set(['.css', '.ts', '.tsx', '.html', '.json']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'playwright-report', 'test-results']);
const violations = [];

const rawColorPattern = /#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/i;
const forbiddenShellPattern = /\bapp-shell-(?:dashboard|geo|configuration|user-management|audit|platform-management|platform-rules|prompt-management)\b|\.app-shell:has\((?!\.geo-insights-print\b)/;
const forbiddenTokenPattern = /--(?:um-[\w-]+|audit-[\w-]+|geo-(?:border|surface(?:-strong)?|text-(?:primary|secondary|tertiary)|platform-[\w-]+))/;
const externalVisualPattern = /(?:@font-face|fonts\.(?:googleapis|gstatic)\.com|(?:from|require\s*\()\s*['"][^'"]*(?:tailwindcss|@tailwind|shadcn|lucide|phosphor|styled-components|@emotion)|"(?:tailwindcss|@tailwind|shadcn|lucide|phosphor|styled-components|@emotion)[^"]*"\s*:)/i;
const themeValuesDeclaration = 'export const projectThemes: Record<ResolvedTheme, ProjectThemeTokens> = {';
const approvedPrimaryGradientSelector = /^\.ant-btn\.ant-btn-primary:not\(\.ant-btn-dangerous\):not\(\.review-approve-button\)(?::(?:hover|active))?$/;

function isRawColorAllowed(name, line, insideThemeValues) {
  return (name === 'src/app/theme.ts' && insideThemeValues)
    || (name === 'index.html' && /(?:name=["']theme-color|const canvas\s*=)/.test(line));
}

function isRadiusAllowed(name, line, value) {
  if (value === '0') return true;
  if (name !== 'src/styles/global.css') return false;
  if (value === '4') {
    return /\.(?:status-tag-compact|dashboard-action-state|user-management-boolean|prompt-platform-status|prompt-editor-meta)\b|\.user-management-page \.status-tag\b/.test(line);
  }
  if (value === '999') {
    return /\.(?:geo-insight-rate-bar-track|review-queue-item::before|quality-issue-count|publication-tabs|publication-exception-card|dashboard-action-count|tasks-status-tabs|ai-rail-title)\b/.test(line);
  }
  return (value === '13' && /\.login-theme-control\b/.test(line))
    || ((value === '20' || value === '24') && /\.login-card\b/.test(line))
    || (value === '12' && /\.login-form\b/.test(line))
    || (value === '14' && /\.login-security-note\b/.test(line));
}

function isShadowAllowed(name, line, value) {
  if (/^none\b|^var\(--ps-shadow-(?:sm|md|lg)\)(?:\s*!important)?$/.test(value)) return true;
  if (name !== 'src/styles/global.css') return false;
  if (
    /\binset\b/.test(value)
    && /\.(?:geo-insight-filter-card\b|geo-insight-filter-grid\b|review-editor-frame\b|form-section-nav\b|diff-(?:add|delete)\b|ai-channel-table\b.*ai-channel-row-selected\b|prompt-platform-list\b.*is-selected\b|prompt-editor-surface\b.*focus-visible\b)/.test(line)
  ) return true;
  return /\.login-card\b|\.login-form .*?(?:ant-input-affix-wrapper(?:-focused|:focus-within)?|ant-btn-primary)\b|\.review-queue-platform::before/.test(line);
}

function inspectLine(name, line, lineNumber, insideThemeValues) {
  const report = (rule) => violations.push(`${name}:${lineNumber}:${rule}: ${line.trim()}`);

  if (!isRawColorAllowed(name, line, insideThemeValues) && rawColorPattern.test(line)) report('raw-color');
  if (forbiddenShellPattern.test(line)) report('route-shell');
  if (forbiddenTokenPattern.test(line)) report('page-token');
  if (externalVisualPattern.test(line)) report('external-visual');

  const fontShorthand = line.match(/\bfont\s*:\s*([^;}]+)/i)?.[1].trim();
  if (
    fontShorthand
    && !/var\(--ps-font-(?:sans|mono)\)|^(?:inherit|initial|unset)(?:\s*!important)?$/i.test(fontShorthand)
  ) report('page-font');

  const cssFont = line.match(/font-family\s*:\s*([^;}]+)/i)?.[1].trim();
  const scriptFont = line.match(/\bfontFamily\s*:\s*(?:['"`]([^'"`]+)['"`]|([^,;}]+))/)?.slice(1).find(Boolean)?.trim();
  const font = cssFont ?? scriptFont;
  if (
    font
    && !(name === 'src/app/theme.ts' && /^visualConstants\.font(?:Sans|Mono)$/.test(font))
    && !/^(?:var\(--ps-font-(?:sans|mono)\)|inherit|initial|unset)(?:\s*!important)?$/.test(font)
  ) report('page-font');

  const radius = line.match(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1]
    ?? line.match(/\bborderRadius\s*:\s*['"]?(\d+(?:\.\d+)?)(?:px)?['"]?/i)?.[1];
  if (radius && !isRadiusAllowed(name, line, radius)) report('arbitrary-radius');

  const shadow = line.match(/box-shadow\s*:\s*([^;}]+)/i)?.[1].trim()
    ?? line.match(/\bboxShadow\s*:\s*(?:['"`]([^'"`]+)['"`]|([^,;}]+))/)?.slice(1).find(Boolean)?.trim();
  if (shadow && !isShadowAllowed(name, line, shadow)) report('arbitrary-shadow');
}

async function inspectFile(path, name) {
  const source = await readFile(path, 'utf8');
  const lines = source.split('\n');
  let insideThemeValues = false;
  lines.forEach((line, index) => {
    if (name === 'src/app/theme.ts' && line.includes(themeValuesDeclaration)) insideThemeValues = true;
    inspectLine(name, line, index + 1, insideThemeValues);
    if (insideThemeValues && line === '};') insideThemeValues = false;
  });
  if (extname(name) !== '.css') return;
  const primaryGradientPattern = /([^{}]*(?:\.ant-btn-primary|primary-action)[^{}]*)\{([^{}]*linear-gradient[^{}]*)\}/gi;
  for (const match of source.matchAll(primaryGradientPattern)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (approvedPrimaryGradientSelector.test(selector)) continue;
    const lineNumber = source.slice(0, match.index).split('\n').length;
    violations.push(`${name}:${lineNumber}:primary-gradient: ${selector}`);
  }
  const chartColorMixPattern = /([^{}]+)\{([^{}]*color-mix\([^{}]*var\(--ps-(?:chart|geo)-series-[^{}]*)\}/gi;
  for (const match of source.matchAll(chartColorMixPattern)) {
    const selector = match[1].trim();
    if (/\.(?:login-|status-tag-admin\b)/.test(selector)) continue;
    const lineNumber = source.slice(0, match.index).split('\n').length;
    violations.push(`${name}:${lineNumber}:chart-color-mix: ${selector}`);
  }
}

async function inspectDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspectDirectory(path);
    else if (sourceExtensions.has(extname(entry.name))) {
      await inspectFile(path, relative(scanRoot, path));
    }
  }
}

if (customRoot) {
  await inspectDirectory(scanRoot);
} else {
  await inspectDirectory(join(frontendRoot, 'src'));
  await inspectFile(join(frontendRoot, 'index.html'), 'index.html');
  await inspectFile(join(frontendRoot, 'package.json'), 'package.json');
}

if (violations.length) {
  console.error(`发现违反视觉契约的实现：\n${violations.join('\n')}`);
  process.exitCode = 1;
}
