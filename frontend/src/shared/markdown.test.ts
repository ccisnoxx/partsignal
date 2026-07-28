/** 验证共享 Markdown 边界清洗恶意 HTML、SVG 和危险链接。 */
import { expect, test } from 'vitest';

test('无 Trusted Types 支持时仍清洗 HTML、SVG 和危险 URL', async () => {
  const { renderSanitizedMarkdown } = await import('./markdown');
  const html = renderSanitizedMarkdown([
    '# 安全标题',
    '<img src="x" onerror="alert(1)">',
    '<svg><g onload="alert(2)"><script>alert(3)</script></g></svg>',
    '[危险链接](javascript:alert(4))',
    '[安全链接](https://example.com/docs)',
  ].join('\n\n'));

  expect(typeof html).toBe('string');
  const document = new DOMParser().parseFromString(html as string, 'text/html');
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('[onerror], [onload]')).toBeNull();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(document.querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
  expect(document.querySelector('h1')?.textContent).toBe('安全标题');
});
