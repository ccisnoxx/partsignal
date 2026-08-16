/** 显式隔离 Foundation smoke 与真实后端；未声明 API 请求必须暴露为失败。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';

type AuthUser = components['schemas']['User'];

type FoundationFixtures = {
  foundationApi: undefined;
};

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

const test = base.extend<FoundationFixtures>({
  foundationApi: [async ({ page }, use) => {
    const unexpectedRequests: string[] = [];

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (request.method() === 'GET' && pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: admin });
        return;
      }
      if (request.method() === 'GET' && pathname === '/api/v1/auth/csrf') {
        await route.fulfill({ status: 200, json: { csrf_token: 'foundation-csrf' } });
        return;
      }

      unexpectedRequests.push(`${request.method()} ${pathname}`);
      await route.fulfill({
        status: 501,
        json: {
          error: {
            code: 'FOUNDATION_FIXTURE_UNEXPECTED_API',
            message: 'V2 Foundation smoke 发起了未声明的 API 请求',
          },
        },
      });
    });

    await use(undefined);
    expect(unexpectedRequests, 'Foundation smoke 不得依赖未声明的业务 API').toEqual([]);
  }, { auto: true }],
});

export { expect, test };
