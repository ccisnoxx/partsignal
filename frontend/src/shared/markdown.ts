/** Markdown 到安全 HTML 的唯一边界，并在 Chromium 中返回 DOMPurify 签发的 TrustedHTML。 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderSanitizedMarkdown(markdown: string): string | TrustedHTML {
  const html = marked.parse(markdown, { async: false });
  return DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true });
}
