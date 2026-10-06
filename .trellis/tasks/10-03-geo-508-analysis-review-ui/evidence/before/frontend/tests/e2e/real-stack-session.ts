import type { BrowserContext } from '@playwright/test';

import { registerArtifactSecrets } from './secret-artifact';

const sessionCookieNames = new Set(['partsignal_session', 'partsignal_csrf']);

async function registerCurrentRealStackCookies(
  context: BrowserContext,
  apiBaseUrl: string,
): Promise<string[]> {
  const values = (await context.cookies(apiBaseUrl))
    .filter((cookie) => sessionCookieNames.has(cookie.name) && cookie.value.length > 0)
    .map((cookie) => cookie.value);
  await registerArtifactSecrets(values);
  return values;
}

async function registerRealStackLoginSecrets(
  context: BrowserContext,
  apiBaseUrl: string,
  csrfToken: string,
): Promise<string[]> {
  if (!csrfToken) throw new Error('真实栈登录响应缺少 CSRF，无法登记敏感值');
  const cookies = await context.cookies(apiBaseUrl);
  const session = cookies.find((cookie) => cookie.name === 'partsignal_session');
  const csrf = cookies.find((cookie) => cookie.name === 'partsignal_csrf');
  if (!session?.value || !csrf?.value) {
    throw new Error('真实栈登录成功后缺少 session/CSRF Cookie，无法登记敏感值');
  }
  const values = [csrfToken, session.value, csrf.value];
  await registerArtifactSecrets(values);
  return Array.from(new Set(values));
}

export { registerCurrentRealStackCookies, registerRealStackLoginSecrets };
