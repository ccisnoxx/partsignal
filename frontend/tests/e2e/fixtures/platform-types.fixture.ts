/** Platform Type production-artifact fixture；在 Platform Workspace fixture 上补充唯一新合同。 */
import { test as base, expect } from './platform-workspace.fixture';
import type { components } from '../../../src/shared/api/generated/schema';

type PlatformType = components['schemas']['PlatformType'];
type PlatformTypeRequest = {
  body?: unknown;
  csrfToken: string | null;
  expectedRevision?: number;
  method: string;
  path: string;
};

type PlatformTypesApiController = {
  blockNextDelete: () => void;
  conflictNextDelete: () => void;
  conflictNextUpdate: () => void;
  failNextList: () => void;
  requests: PlatformTypeRequest[];
  setEngineer: () => void;
  removeType: (platformTypeId: string) => void;
  setProjection: (platformTypeId: string, changes: Partial<PlatformType>) => void;
};

type PlatformTypeFixtures = { platformTypesApi: PlatformTypesApiController };

const admin = {
  id: '00000000-0000-4000-8000-000000000099',
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
} satisfies components['schemas']['User'];

function initialPlatformTypes(): PlatformType[] {
  return [
    {
      id: '10000000-0000-4000-8000-000000000002',
      name: '行业媒体',
      slug: 'industry-media',
      platform_count: 0,
      available_actions: ['UPDATE', 'DELETE'],
      deletion: { blockers: [] },
      primary_task: 'EDIT_CATEGORY',
      revision: 1,
      created_by: admin.id,
      created_at: '2026-08-10T00:00:00Z',
      updated_at: '2026-08-10T00:00:00Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000001',
      name: '技术社区',
      slug: 'technical-community',
      platform_count: 2,
      available_actions: ['UPDATE'],
      deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 2 }] },
      primary_task: 'EDIT_CATEGORY',
      revision: 4,
      created_by: admin.id,
      created_at: '2026-08-09T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
    },
  ];
}

function errorEnvelope(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details, request_id: `req-platform-type-${code}` } };
}

const test = base.extend<PlatformTypeFixtures>({
  platformTypesApi: [async ({ page, platformsApi }, use) => {
    let items = initialPlatformTypes();
    let engineer = false;
    let nextListFailure = false;
    let nextUpdateConflict = false;
    let nextDeleteConflict = false;
    let nextDeleteBlocker = false;
    const requests: PlatformTypeRequest[] = [];

    await page.route('**/api/v1/**', async (route, request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({
          status: 200,
          json: engineer ? { ...admin, account_type: 'ENGINEER' } : admin,
        });
        return;
      }

      if (url.pathname === '/api/v1/platform-types' && request.method() === 'GET') {
        requests.push({ method: 'GET', path: url.pathname, csrfToken: null });
        if (nextListFailure) {
          nextListFailure = false;
          await route.fulfill({
            status: 500,
            json: errorEnvelope('PLATFORM_TYPES_UNAVAILABLE', '平台类型服务暂不可用'),
          });
          return;
        }
        await route.fulfill({ status: 200, json: { items } satisfies components['schemas']['PlatformTypeList'] });
        return;
      }

      if (url.pathname === '/api/v1/platform-types' && request.method() === 'POST') {
        const body = request.postDataJSON() as components['schemas']['PlatformTypeCreate'];
        requests.push({
          method: 'POST',
          path: url.pathname,
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        if (items.some((item) => item.slug === body.slug)) {
          await route.fulfill({
            status: 409,
            json: errorEnvelope('PLATFORM_TYPE_SLUG_EXISTS', '平台类型 slug 已存在', {
              errors: [{ loc: ['body', 'slug'], msg: '平台类型 slug 已存在', type: 'platform_type_slug_exists' }],
            }),
          });
          return;
        }
        const created: PlatformType = {
          ...body,
          id: '10000000-0000-4000-8000-000000000099',
          platform_count: 0,
          available_actions: ['UPDATE', 'DELETE'],
          deletion: { blockers: [] },
          primary_task: 'EDIT_CATEGORY',
          revision: 0,
          created_by: admin.id,
          created_at: '2026-08-13T00:00:00Z',
          updated_at: '2026-08-13T00:00:00Z',
        };
        items = [...items, created].sort((left, right) => (
          left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
        ));
        await route.fulfill({ status: 201, json: created });
        return;
      }

      const itemMatch = url.pathname.match(/^\/api\/v1\/platform-types\/([^/]+)$/);
      if (itemMatch && (request.method() === 'PATCH' || request.method() === 'DELETE')) {
        const index = items.findIndex((item) => item.id === itemMatch[1]);
        if (index < 0) {
          await route.fulfill({ status: 404, json: errorEnvelope('NOT_FOUND', '平台类型不存在') });
          return;
        }
        const current = items[index]!;
        const body = request.method() === 'PATCH'
          ? request.postDataJSON() as components['schemas']['PlatformTypeUpdate']
          : undefined;
        const expectedRevision = body?.expected_revision
          ?? Number(url.searchParams.get('expected_revision'));
        requests.push({
          method: request.method(),
          path: url.pathname,
          body,
          expectedRevision,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });

        if (request.method() === 'PATCH' && nextUpdateConflict) {
          nextUpdateConflict = false;
          items[index] = {
            ...current,
            name: '服务端并发名称',
            revision: current.revision + 1,
            updated_at: '2026-08-13T01:00:00Z',
          };
          await route.fulfill({
            status: 409,
            json: errorEnvelope('REVISION_CONFLICT', '平台类型已被其他请求修改'),
          });
          return;
        }
        if (request.method() === 'DELETE' && nextDeleteConflict) {
          nextDeleteConflict = false;
          items[index] = { ...current, revision: current.revision + 1 };
          await route.fulfill({
            status: 409,
            json: errorEnvelope('REVISION_CONFLICT', '平台类型已被其他请求修改'),
          });
          return;
        }
        if (expectedRevision !== current.revision) {
          await route.fulfill({
            status: 409,
            json: errorEnvelope('REVISION_CONFLICT', '平台类型已被其他请求修改'),
          });
          return;
        }
        if (request.method() === 'PATCH' && body) {
          items[index] = {
            ...current,
            name: body.name,
            slug: body.slug,
            revision: current.revision + 1,
            updated_at: '2026-08-13T02:00:00Z',
          };
          await route.fulfill({ status: 200, json: items[index] });
          return;
        }
        if (nextDeleteBlocker) {
          nextDeleteBlocker = false;
          items[index] = {
            ...current,
            platform_count: 1,
            available_actions: ['UPDATE'],
            deletion: { blockers: [{ type: 'PLATFORM_PROFILE', count: 1 }] },
          };
          await route.fulfill({
            status: 409,
            json: errorEnvelope('PLATFORM_TYPE_IN_USE', '平台类型仍被具体平台引用', {
              references: [{ type: 'PLATFORM_PROFILE', count: 1 }],
            }),
          });
          return;
        }
        items.splice(index, 1);
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      await route.fallback();
    });

    await use({
      requests,
      blockNextDelete: () => {
        nextDeleteBlocker = true;
        platformsApi.allowHttpError(409);
      },
      conflictNextDelete: () => {
        nextDeleteConflict = true;
        platformsApi.allowHttpError(409);
      },
      conflictNextUpdate: () => {
        nextUpdateConflict = true;
        platformsApi.allowHttpError(409);
      },
      failNextList: () => {
        nextListFailure = true;
        platformsApi.allowHttpError(500);
      },
      setEngineer: () => {
        engineer = true;
      },
      removeType: (platformTypeId) => { items = items.filter((item) => item.id !== platformTypeId); },
      setProjection: (platformTypeId, changes) => {
        const index = items.findIndex((item) => item.id === platformTypeId);
        if (index < 0) throw new Error(`未知平台类型：${platformTypeId}`);
        items[index] = { ...items[index]!, ...changes };
      },
    });
  }, { auto: true }],
});

export { expect, test };
export type { PlatformTypesApiController, PlatformTypeRequest };
