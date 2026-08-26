/** Legacy routing fixture 只验证地址、Auth 与错误边界，不模拟领域业务成功。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';
import { createProductDetail, createProducts } from './products.fixture';

type AuthUser = components['schemas']['User'];
type SessionKind = 'admin' | 'engineer' | 'must-change' | 'anonymous';
type LegacySession = {
  set: (kind: SessionKind) => void;
};
type LegacyRoutingFixtures = {
  legacySession: LegacySession;
};

const loginPassword = 'legacy-routing-password';
const csrfToken = 'legacy-routing-csrf';
const product = createProducts(1)[0];

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  display_name: '系统管理员',
  account_type: 'ADMIN',
  is_active: true,
  must_change_password: false,
  workflow_stage: 'ACTIVE',
  primary_task: 'MANAGE_USER',
  available_actions: [],
  deletion: null,
  revision: 1,
  created_at: '2026-08-08T00:00:00Z',
};

const engineer: AuthUser = {
  ...admin,
  id: '00000000-0000-4000-8000-000000000002',
  username: 'engineer',
  display_name: '内容工程师',
  account_type: 'ENGINEER',
  primary_task: 'MANAGE_LOGIN_SECURITY',
};

function userFor(kind: SessionKind): AuthUser | null {
  if (kind === 'anonymous') return null;
  if (kind === 'engineer') return engineer;
  if (kind === 'must-change') {
    return {
      ...engineer,
      must_change_password: true,
      workflow_stage: 'FIRST_PASSWORD_CHANGE',
    };
  }
  return admin;
}

const test = base.extend<LegacyRoutingFixtures>({
  legacySession: [async ({ page }, use) => {
    const runtimeErrors: string[] = [];
    const unexpectedMutations: string[] = [];
    let currentUser: AuthUser | null = admin;

    page.on('console', (message) => {
      if (
        message.type() === 'error'
        && !/status of (404|503)/.test(message.text())
        && !message.text().includes('Routing fixture 不提供领域数据')
        && !message.text().includes('内容任务不存在')
      ) {
        runtimeErrors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText.includes('net::ERR_ABORTED')) return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`Legacy routing CSP violation: ${event.effectiveDirective} ${event.blockedURI}`);
      });
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();

      if (method === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill(currentUser
          ? { status: 200, json: currentUser }
          : { status: 204, body: '' });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/v1/auth/csrf' && currentUser) {
        await route.fulfill({ status: 200, json: { csrf_token: csrfToken } });
        return;
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const body = request.postDataJSON() as { username?: string; password?: string };
        if (body.username !== admin.username || body.password !== loginPassword) {
          await route.fulfill({
            status: 401,
            json: { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误', details: {}, request_id: 'req-legacy-login' } },
          });
          return;
        }
        currentUser = admin;
        await route.fulfill({ status: 200, json: { user: admin, csrf_token: csrfToken } });
        return;
      }
      if (
        method === 'GET'
        && url.pathname === `/api/v1/products/${product.id}/detail`
      ) {
        await route.fulfill({ status: 200, json: createProductDetail(product) });
        return;
      }
      if (method === 'GET') {
        const missingContentTask = url.pathname.includes('/content-tasks/missing-resource/detail');
        await route.fulfill({
          status: missingContentTask ? 404 : 503,
          json: {
            error: {
              code: missingContentTask ? 'NOT_FOUND' : 'ROUTING_FIXTURE_NO_DOMAIN_DATA',
              message: missingContentTask ? '内容任务不存在' : 'Routing fixture 不提供领域数据',
              details: {},
              request_id: missingContentTask ? 'req-legacy-not-found' : 'req-legacy-no-data',
            },
          },
        });
        return;
      }

      unexpectedMutations.push(`${method} ${url.pathname}`);
      await route.fulfill({
        status: 501,
        json: { error: { code: 'LEGACY_FIXTURE_UNEXPECTED_MUTATION', message: 'Legacy routing fixture 收到未声明写请求' } },
      });
    });

    await use({ set: (kind) => { currentUser = userFor(kind); } });
    expect(unexpectedMutations, 'Legacy routing 不得触发领域写请求').toEqual([]);
    expect(runtimeErrors, 'Legacy routing 不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { admin, engineer, expect, loginPassword, product, test };
