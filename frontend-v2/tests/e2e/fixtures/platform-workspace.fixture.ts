/** Platform Workspace production-artifact fixture；只声明 Workspace 实际请求。 */
import { expect, test as base, createPlatformProfiles } from './platforms.fixture';
import type { components } from '../../../src/shared/api/generated/schema';

type PlatformProfile = components['schemas']['PlatformProfile'];
type PlatformProfileUpdate = components['schemas']['PlatformProfileUpdate'];

type WorkspaceUpdateRequest = {
  body: PlatformProfileUpdate;
  csrfToken: string | null;
  platformId: string;
};

type PlatformWorkspaceApiController = {
  accountRequests: Array<{
    body?: unknown;
    expectedRevision?: number;
    method: string;
    path: string;
  }>;
  candidateRequests: string[];
  detailRequests: string[];
  uploadRequests: components['schemas']['UploadIntentCreate'][];
  updateRequests: WorkspaceUpdateRequest[];
  conflictNextUpdate: () => void;
  failNextDetail: (status: 403 | 404 | 500) => void;
  setReadOnly: (readOnly: boolean) => void;
};

type WorkspaceFixtures = { platformWorkspaceApi: PlatformWorkspaceApiController };

const promptOptions = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: '平台 Prompt 1',
    revision: 1,
    updated_at: '2026-08-09T00:00:00Z',
    updated_by: '00000000-0000-4000-8000-000000000099',
    bound_platform_count: 1,
    available_actions: ['UPDATE', 'DELETE'],
  },
  {
    id: '20000000-0000-4000-8000-000000000099',
    name: 'Workspace 备选 Prompt',
    revision: 4,
    updated_at: '2026-08-12T00:00:00Z',
    updated_by: '00000000-0000-4000-8000-000000000099',
    bound_platform_count: 0,
    available_actions: ['UPDATE', 'DELETE'],
  },
] satisfies components['schemas']['PlatformPromptListItem'][];

const candidatePreview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function errorEnvelope(status: number) {
  const forbidden = status === 403;
  return {
    error: {
      code: forbidden ? 'PERMISSION_DENIED' : 'WORKSPACE_UNAVAILABLE',
      message: forbidden ? '当前账号无法读取此平台' : 'Platform Workspace 暂不可用',
      details: {},
      request_id: `req-workspace-${status}`,
    },
  };
}

const test = base.extend<WorkspaceFixtures>({
  platformWorkspaceApi: [async ({ page, platformsApi }, use) => {
    const profiles: PlatformProfile[] = createPlatformProfiles().map((profile, index) => ({
      ...profile,
      website_url: `https://community-${index + 1}.example.invalid/`,
    }));
    let readOnly = false;
    let nextDetailFailure: 403 | 404 | 500 | undefined;
    let nextUpdateConflict = false;
    const detailRequests: string[] = [];
    const candidateRequests: string[] = [];
    const uploadRequests: components['schemas']['UploadIntentCreate'][] = [];
    const updateRequests: WorkspaceUpdateRequest[] = [];
    const accountRequests: PlatformWorkspaceApiController['accountRequests'] = [];
    const platformAccounts: components['schemas']['PlatformAccount'][] = [
      {
        platform_profile_id: profiles[0]!.id,
        label: 'Workspace 运营账号',
        account_identifier: 'workspace-main',
        id: '30000000-0000-4000-8000-000000000001',
        is_active: true,
        workflow_stage: 'OPERATIONAL',
        primary_task: 'MANAGE_ACCOUNT',
        available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
        deletion: { blockers: [] },
        revision: 2,
      },
      {
        platform_profile_id: profiles[0]!.id,
        label: 'Workspace 停用账号',
        account_identifier: 'workspace-disabled',
        id: '30000000-0000-4000-8000-000000000002',
        is_active: false,
        workflow_stage: 'ACCOUNT_DISABLED',
        primary_task: 'ENABLE_ACCOUNT',
        available_actions: ['UPDATE', 'ENABLE', 'DELETE'],
        deletion: { blockers: [] },
        revision: 1,
      },
    ];

    await page.route('**/workspace-logo-upload', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });

    await page.route('**/api/v1/**', async (route, request) => {
      const url = new URL(request.url());
      const detailMatch = url.pathname.match(/^\/api\/v1\/platform-profiles\/([^/]+)$/);

      if (request.method() === 'GET' && detailMatch) {
        const platformId = detailMatch[1]!;
        detailRequests.push(platformId);
        if (nextDetailFailure) {
          const status = nextDetailFailure;
          nextDetailFailure = undefined;
          await route.fulfill({ status, json: errorEnvelope(status) });
          return;
        }
        const profile = profiles.find((item) => item.id === platformId);
        if (!profile) {
          await route.fulfill({ status: 404, json: { error: { code: 'PLATFORM_NOT_FOUND', message: '平台不存在', details: {}, request_id: 'req-workspace-404' } } });
          return;
        }
        const projected = readOnly ? {
          ...profile,
          primary_task: null,
          available_actions: [],
          deletion: null,
        } satisfies PlatformProfile : profile;
        await route.fulfill({
          status: 200,
          json: {
            profile: projected,
            account_summary: {
              total: projected.platform_account_count,
              enabled: projected.enabled_platform_account_count,
              disabled: projected.platform_account_count - projected.enabled_platform_account_count,
            },
            reference_summary: {
              as_of: '2026-08-13T00:00:00Z',
              recent_30_days: 3,
              all_time: 8,
            },
            platform_type_options: [
              { id: '10000000-0000-4000-8000-000000000001', name: '技术社区', slug: 'technical-community' },
              { id: '10000000-0000-4000-8000-000000000002', name: '行业媒体', slug: 'industry-media' },
            ],
          } satisfies components['schemas']['PlatformProfileDetail'],
        });
        return;
      }

      if (request.method() === 'GET' && url.pathname === '/api/v1/platform-accounts') {
        const platformId = url.searchParams.get('platform_profile_id')!;
        await route.fulfill({
          status: 200,
          json: {
            items: platformAccounts
              .filter((account) => account.platform_profile_id === platformId)
              .map((account) => readOnly
                ? { ...account, available_actions: [], deletion: null }
                : account),
          } satisfies components['schemas']['PlatformAccountList'],
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/platform-accounts') {
        const body = request.postDataJSON() as components['schemas']['PlatformAccountCreate'];
        accountRequests.push({ method: 'POST', path: url.pathname, body });
        const created: components['schemas']['PlatformAccount'] = {
          ...body,
          id: '30000000-0000-4000-8000-000000000099',
          is_active: true,
          workflow_stage: 'OPERATIONAL',
          primary_task: 'MANAGE_ACCOUNT',
          available_actions: ['UPDATE', 'DISABLE', 'DELETE'],
          deletion: { blockers: [] },
          revision: 0,
        };
        platformAccounts.push(created);
        await route.fulfill({ status: 201, json: created });
        return;
      }

      const accountMatch = url.pathname.match(/^\/api\/v1\/platform-accounts\/([^/]+)(?:\/(enable|disable))?$/);
      if (accountMatch) {
        const index = platformAccounts.findIndex((account) => account.id === accountMatch[1]);
        if (index < 0) {
          await route.fulfill({ status: 404, json: errorEnvelope(404) });
          return;
        }
        const current = platformAccounts[index]!;
        if (request.method() === 'PATCH' && !accountMatch[2]) {
          const body = request.postDataJSON() as components['schemas']['PlatformAccountUpdate'];
          accountRequests.push({ method: 'PATCH', path: url.pathname, body, expectedRevision: body.expected_revision });
          platformAccounts[index] = {
            ...current,
            label: body.label,
            account_identifier: body.account_identifier,
            revision: current.revision + 1,
          };
          await route.fulfill({ status: 200, json: platformAccounts[index] });
          return;
        }
        if (request.method() === 'POST' && accountMatch[2]) {
          const body = request.postDataJSON() as { expected_revision: number };
          const enabled = accountMatch[2] === 'enable';
          accountRequests.push({ method: 'POST', path: url.pathname, body, expectedRevision: body.expected_revision });
          platformAccounts[index] = {
            ...current,
            is_active: enabled,
            workflow_stage: enabled ? 'OPERATIONAL' : 'ACCOUNT_DISABLED',
            primary_task: enabled ? 'MANAGE_ACCOUNT' : 'ENABLE_ACCOUNT',
            available_actions: enabled ? ['UPDATE', 'DISABLE', 'DELETE'] : ['UPDATE', 'ENABLE', 'DELETE'],
            revision: current.revision + 1,
          };
          await route.fulfill({ status: 200, json: platformAccounts[index] });
          return;
        }
        if (request.method() === 'DELETE' && !accountMatch[2]) {
          const expectedRevision = Number(url.searchParams.get('expected_revision'));
          accountRequests.push({ method: 'DELETE', path: url.pathname, expectedRevision });
          platformAccounts.splice(index, 1);
          await route.fulfill({ status: 204, body: '' });
          return;
        }
      }

      if (request.method() === 'GET' && url.pathname === '/api/v1/platform-prompts') {
        await route.fulfill({ status: 200, json: { items: promptOptions } satisfies components['schemas']['PlatformPromptList'] });
        return;
      }

      if (request.method() === 'PATCH' && detailMatch) {
        const platformId = detailMatch[1]!;
        const body = request.postDataJSON() as PlatformProfileUpdate;
        updateRequests.push({
          body,
          csrfToken: request.headers()['x-csrf-token'] ?? null,
          platformId,
        });
        if (nextUpdateConflict) {
          nextUpdateConflict = false;
          await route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: '平台已被其他请求修改', details: {}, request_id: 'req-workspace-conflict' } } });
          return;
        }
        const index = profiles.findIndex((item) => item.id === platformId);
        if (index < 0) {
          await route.fulfill({ status: 404, json: errorEnvelope(404) });
          return;
        }
        const prompt = body.platform_prompt_id
          ? promptOptions.find((item) => item.id === body.platform_prompt_id) ?? null
          : null;
        profiles[index] = {
          ...profiles[index]!,
          name: body.name,
          allowed_domains: body.allowed_domains,
          platform_type_id: body.platform_type_id,
          platform_type: body.platform_type_id === '10000000-0000-4000-8000-000000000002'
            ? { id: body.platform_type_id, name: '行业媒体', slug: 'industry-media' }
            : { id: body.platform_type_id, name: '技术社区', slug: 'technical-community' },
          website_url: body.website_url,
          ...('logo' in body ? {
            logo: body.logo ? { ...body.logo, url: candidatePreview } : null,
          } : {}),
          platform_prompt: prompt ? {
            id: prompt.id,
            name: prompt.name,
            revision: prompt.revision,
            updated_at: prompt.updated_at,
          } : null,
          configuration_complete: prompt !== null,
          readiness_status: prompt === null ? 'MISSING_PROMPT' : profiles[index]!.enabled_platform_account_count > 0 ? 'COMPLETE' : 'MISSING_ACCOUNT',
          revision: profiles[index]!.revision + 1,
          updated_at: '2026-08-13T00:00:00Z',
        };
        await route.fulfill({ status: 200, json: profiles[index] });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/platform-logo-candidates') {
        const body = request.postDataJSON() as components['schemas']['PlatformLogoCandidateCreate'];
        candidateRequests.push(body.website_url);
        await route.fulfill({
          status: 201,
          json: {
            file_id: '40000000-0000-4000-8000-000000000001',
            preview: { url: candidatePreview, expires_at: '2026-08-13T01:00:00Z' },
          } satisfies components['schemas']['PlatformLogoCandidate'],
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/files/upload-intents') {
        const body = request.postDataJSON() as components['schemas']['UploadIntentCreate'];
        uploadRequests.push(body);
        await route.fulfill({
          status: 201,
          json: {
            file: {
              id: '40000000-0000-4000-8000-000000000002',
              category: body.category,
              original_filename: body.original_filename,
              object_key: 'fixture/platform-logo.png',
              content_type: body.content_type,
              size: body.size,
              sha256: body.sha256,
              access_level: body.access_level,
              status: 'PENDING',
              created_at: '2026-08-13T00:00:00Z',
              verified_at: null,
            },
            upload: {
              method: 'PUT',
              url: 'http://127.0.0.1:4174/workspace-logo-upload',
              headers: { 'Content-Type': body.content_type },
              fields: {},
              expires_at: '2026-08-13T01:00:00Z',
            },
          } satisfies components['schemas']['UploadIntent'],
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === '/api/v1/files/40000000-0000-4000-8000-000000000002/complete') {
        const body = uploadRequests.at(-1)!;
        await route.fulfill({
          status: 200,
          json: {
            id: '40000000-0000-4000-8000-000000000002',
            category: body.category,
            original_filename: body.original_filename,
            object_key: 'fixture/platform-logo.png',
            content_type: body.content_type,
            size: body.size,
            sha256: body.sha256,
            access_level: body.access_level,
            status: 'VERIFIED',
            created_at: '2026-08-13T00:00:00Z',
            verified_at: '2026-08-13T00:00:01Z',
          } satisfies components['schemas']['FileRecord'],
        });
        return;
      }

      await route.fallback();
    });

    await use({
      accountRequests,
      candidateRequests,
      detailRequests,
      uploadRequests,
      updateRequests,
      conflictNextUpdate: () => {
        nextUpdateConflict = true;
        platformsApi.allowHttpError(409);
      },
      failNextDetail: (status) => {
        nextDetailFailure = status;
        platformsApi.allowHttpError(status);
      },
      setReadOnly: (value) => { readOnly = value; },
    });
  }, { auto: true }],
});

export { expect, test };
export type { PlatformWorkspaceApiController, WorkspaceUpdateRequest };
