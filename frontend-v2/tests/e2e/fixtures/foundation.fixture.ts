/** 显式隔离 Foundation smoke 与真实后端；未声明 API 请求必须暴露为失败。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

type FoundationFixtures = {
  foundationApi: undefined;
};

const test = base.extend<FoundationFixtures>({
  foundationApi: [async ({ page }, use) => {
    const unexpectedRequests: string[] = [];

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (request.method() === 'GET' && pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 204, body: '' });
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
