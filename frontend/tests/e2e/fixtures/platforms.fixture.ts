/** Platform List production artifact fixture；显式隔离真实后端。 */
import { expect, test as base } from '@playwright/test';
import { URL } from 'node:url';

import type { components } from '../../../src/shared/api/generated/schema';
import { emptyAggregate } from './workbench.fixture';

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileList = components['schemas']['PlatformProfileList'];
type PlatformTypeSummary = components['schemas']['PlatformTypeSummary'];

type PlatformCommandRequest = {
  command: 'enable' | 'disable' | 'delete';
  csrfToken: string | null;
  expectedRevision: number | null;
  platformId: string;
};

type PlatformsApiController = {
  allowHttpError: (status: number) => void;
  commandRequests: PlatformCommandRequest[];
  listRequests: URL[];
  removePlatform: (platformId: string) => void;
  setProjection: (platformId: string, changes: Partial<PlatformProfile>) => void;
  conflictNextDelete: () => void;
};

type PlatformFixtures = { platformsApi: PlatformsApiController };

const user = {
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

const platformTypes = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: '技术社区',
    slug: 'technical-community',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: '行业媒体',
    slug: 'industry-media',
  },
] satisfies PlatformTypeSummary[];

const fixtureLogo = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"%3E%3Crect width="16" height="16" fill="%232563eb"/%3E%3C/svg%3E';

function createPlatformProfiles(count = 45): PlatformProfile[] {
  return Array.from({ length: count }, (_, index) => {
    const disabled = index === 2;
    const readiness = index % 3 === 0
      ? 'COMPLETE'
      : index % 3 === 1 ? 'MISSING_PROMPT' : 'MISSING_ACCOUNT';
    const platformType = platformTypes[index % platformTypes.length];
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: index === 0
        ? '工程师社区 001 超长平台名称用于响应式验证'
        : `工程师社区 ${String(index + 1).padStart(3, '0')}`,
      slug: `engineer-community-${index + 1}`,
      allowed_domains: [`community-${index + 1}.example.invalid`],
      platform_type_id: platformType.id,
      platform_type: platformType,
      website_url: null,
      logo: index === 1 ? null : {
        source: 'EXTERNAL',
        url: fixtureLogo,
      },
      revision: index + 1,
      is_active: !disabled,
      platform_prompt: readiness === 'MISSING_PROMPT' ? null : {
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `平台 Prompt ${index + 1}`,
        revision: 1,
        updated_at: '2026-08-09T00:00:00Z',
      },
      configuration_complete: readiness !== 'MISSING_PROMPT',
      platform_account_count: readiness === 'MISSING_ACCOUNT' ? 2 : 3,
      enabled_platform_account_count: readiness === 'MISSING_ACCOUNT' ? 0 : 2,
      readiness_status: readiness,
      workflow_stage: disabled
        ? 'DISABLED'
        : readiness === 'MISSING_PROMPT' ? 'GENERATION_UNCONFIGURED' : 'OPERATIONAL',
      primary_task: disabled
        ? 'ENABLE_PLATFORM'
        : readiness === 'MISSING_PROMPT' ? 'CONFIGURE_GENERATION' : 'VIEW_PLATFORM_OPERATION',
      available_actions: disabled ? ['UPDATE', 'ENABLE', 'DELETE'] : ['UPDATE', 'DISABLE'],
      deletion: disabled
        ? { blockers: [] }
        : index === 0 ? { blockers: [{ type: 'CONTENT_TASK', count: 2 }] } : null,
      updated_at: index === 1 ? null : new Date(Date.UTC(2026, 7, 9) - index * 60_000).toISOString(),
    } satisfies PlatformProfile;
  });
}

function listPlatforms(items: PlatformProfile[], url: URL): PlatformProfileList {
  const query = url.searchParams.get('q')?.toLocaleLowerCase('zh-CN');
  const typeId = url.searchParams.get('platform_type_id');
  const status = url.searchParams.get('status');
  const readiness = url.searchParams.get('readiness_status');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('page_size') ?? 20);
  const filtered = items.filter((item) => {
    const text = `${item.name} ${item.platform_type?.name ?? ''}`.toLocaleLowerCase('zh-CN');
    return (!query || text.includes(query))
      && (!typeId || item.platform_type_id === typeId)
      && (!status || (item.is_active ? 'ENABLED' : 'DISABLED') === status)
      && (!readiness || item.readiness_status === readiness);
  });
  filtered.sort((left, right) => (
    left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id)
  ));
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    page,
    page_size: pageSize,
    total: filtered.length,
    summary: {
      platform_total: items.length,
      enabled_total: items.filter((item) => item.is_active).length,
      missing_prompt_total: items.filter((item) => !item.configuration_complete).length,
      configuration_complete_total: items.filter((item) => item.configuration_complete).length,
      readiness_complete_total: items.filter((item) => item.readiness_status === 'COMPLETE').length,
      missing_account_total: items.filter((item) => item.readiness_status === 'MISSING_ACCOUNT').length,
    },
    platform_type_options: platformTypes,
  };
}

const test = base.extend<PlatformFixtures>({
  platformsApi: [async ({ page }, use) => {
    let items = createPlatformProfiles();
    const listRequests: URL[] = [];
    const commandRequests: PlatformCommandRequest[] = [];
    const unexpectedRequests: string[] = [];
    const runtimeErrors: string[] = [];
    const allowedHttpErrors: number[] = [];
    let nextDeleteConflict = false;

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const expectedIndex = allowedHttpErrors.findIndex((status) => (
        text.includes(`status of ${status}`)
      ));
      if (expectedIndex >= 0) {
        allowedHttpErrors.splice(expectedIndex, 1);
        return;
      }
      runtimeErrors.push(`console.error: ${text}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      runtimeErrors.push(`requestfailed: ${request.method()} ${request.url()}`);
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/me') {
        await route.fulfill({ status: 200, json: user });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/auth/csrf') {
        await route.fulfill({
          status: 200,
          json: { csrf_token: 'platforms-e2e-csrf' } satisfies components['schemas']['CsrfToken'],
        });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/workbench') {
        await route.fulfill({ status: 200, json: emptyAggregate });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/platform-profiles') {
        listRequests.push(url);
        await route.fulfill({ status: 200, json: listPlatforms(items, url) });
        return;
      }

      const commandMatch = url.pathname.match(/^\/api\/v1\/platform-profiles\/([^/]+)(?:\/(enable|disable))?$/);
      if (commandMatch && (request.method() === 'POST' || request.method() === 'DELETE')) {
        const platformId = commandMatch[1];
        const command = request.method() === 'DELETE' ? 'delete' : commandMatch[2];
        const body = request.method() === 'POST'
          ? request.postDataJSON() as components['schemas']['RevisionRequest']
          : null;
        commandRequests.push({
          command: command as PlatformCommandRequest['command'],
          platformId,
          expectedRevision: body?.expected_revision
            ?? (url.searchParams.has('expected_revision')
              ? Number(url.searchParams.get('expected_revision'))
              : null),
          csrfToken: request.headers()['x-csrf-token'] ?? null,
        });
        const index = items.findIndex((item) => item.id === platformId);
        if (index < 0) {
          await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '平台不存在', details: {}, request_id: 'req-platform-missing' } } });
          return;
        }
        if (command === 'delete') {
          if (nextDeleteConflict) {
            nextDeleteConflict = false;
            await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: '平台已被其他请求修改', details: {}, request_id: 'req-platform-delete-conflict' } } });
            return;
          }
          items = items.filter((item) => item.id !== platformId);
          await route.fulfill({ status: 204 });
          return;
        }
        const enabled = command === 'enable';
        items[index] = {
          ...items[index],
          revision: items[index].revision + 1,
          is_active: enabled,
          workflow_stage: enabled ? 'OPERATIONAL' : 'DISABLED',
          primary_task: enabled ? 'VIEW_PLATFORM_OPERATION' : 'ENABLE_PLATFORM',
          available_actions: enabled ? ['UPDATE', 'DISABLE'] : ['UPDATE', 'ENABLE', 'DELETE'],
          deletion: enabled ? null : { blockers: [] },
        };
        await route.fulfill({ status: 200, json: items[index] });
        return;
      }

      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({
        status: 501,
        json: { error: { code: 'PLATFORMS_FIXTURE_UNEXPECTED_API', message: '平台列表发起了未声明的 API 请求' } },
      });
    });

    await use({
      allowHttpError: (status) => allowedHttpErrors.push(status),
      commandRequests,
      listRequests,
      removePlatform: (platformId) => { items = items.filter((item) => item.id !== platformId); },
      setProjection: (platformId, changes) => {
        const index = items.findIndex((item) => item.id === platformId);
        if (index < 0) throw new Error(`未知平台：${platformId}`);
        items[index] = { ...items[index]!, ...changes };
      },
      conflictNextDelete: () => {
        nextDeleteConflict = true;
        allowedHttpErrors.push(409);
      },
    });
    expect(unexpectedRequests, '平台列表不得依赖未声明的 API').toEqual([]);
    expect(runtimeErrors, '平台列表不得出现未处理浏览器错误').toEqual([]);
  }, { auto: true }],
});

export { createPlatformProfiles, expect, test };
export type { PlatformProfile, PlatformsApiController };
