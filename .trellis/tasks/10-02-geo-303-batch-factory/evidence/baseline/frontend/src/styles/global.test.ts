import { describe, expect, it } from 'vitest';

import css from './global.css?raw';

const requiredTokens = [
  'surface-app',
  'surface-panel',
  'surface-raised',
  'surface-overlay',
  'surface-selected',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-disabled',
  'text-danger',
  'border-subtle',
  'border-default',
  'border-strong',
  'border-focus',
  'success',
  'warning',
  'danger',
  'info',
  'radius-control',
  'radius-panel',
  'radius-overlay',
  'focus-ring-width',
  'focus-ring-offset',
  'type-display-size',
  'type-page-title-size',
  'type-section-title-size',
  'type-body-size',
  'type-body-sm-size',
  'type-label-size',
  'type-mono-size',
] as const;

const printShellMatch = css.match(
  /@media print\s*\{\s*\.geo-insights-print-shell\s*\{([\s\S]*?)\n\s*\}/,
);
const printShell = printShellMatch?.[1] ?? '';
const globalCss = css.replace(printShell, '');

describe('Design System token contract', () => {
  it.each(requiredTokens)('定义唯一的 --%s 权威值', (token) => {
    expect(globalCss.match(new RegExp(`\\s--${token}:`, 'g'))).toHaveLength(1);
  });

  it('仅在 GEO 打印作用域定义批准的高对比 token 覆盖', () => {
    expect(printShellMatch).not.toBeNull();
    expect(printShell.match(/^\s*--[\w-]+:\s*[^;]+;/gm)?.map((declaration) => declaration.trim())).toEqual([
      '--surface-panel: #fff;',
      '--surface-raised: #f2f2f2;',
      '--text-primary: #000;',
      '--text-secondary: #171717;',
      '--text-tertiary: #262626;',
      '--border-subtle: #777;',
      '--border-strong: #333;',
      '--warning: #5c2b00;',
    ]);
  });

  it('让 Tailwind 与 shadcn 语义引用 PartSignal token', () => {
    expect(css).toContain('--color-background: var(--surface-app);');
    expect(css).toContain('--color-popover: var(--surface-overlay);');
    expect(css).toContain('--color-destructive: var(--danger);');
    expect(css).toContain('--color-ring: var(--border-focus);');
  });

  it('不创建第二套字体或深色主题值', () => {
    expect(css).not.toContain('@fontsource');
    expect(css).not.toMatch(/\.dark\s*\{/);
  });
});
