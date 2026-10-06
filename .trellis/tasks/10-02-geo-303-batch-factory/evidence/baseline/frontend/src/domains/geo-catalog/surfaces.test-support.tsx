import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import type { Profile, Surface } from './surfaces.model';

const surfaceId = 'a0000000-0000-4000-8000-000000000001';
const profileId = 'a0000000-0000-4000-8000-000000000002';
const otherId = 'a0000000-0000-4000-8000-000000000003';
const time = '2026-10-02T08:00:00Z';
const user: AuthUser = { id: '00000000-0000-4000-8000-000000000099', username: 'geo-admin', display_name: '测试管理员', account_type: 'ADMIN', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: time };
function surfaceFixture(overrides: Partial<Surface> = {}): Surface {
  const configuration: components['schemas']['GeoEngineSurfaceOut'] = { id: surfaceId, name: '测试观测面', slug: 'test-surface', surface_kind: 'MANUAL_SITE', provider_brand: 'CUSTOM', website_url: null, compliance_status: 'NOT_REVIEWED', capabilities: { answer_text: true, citations: false, web_search_signal: false, model_version: false, usage: false, cost: false }, is_active: false, revision: 4, first_referenced_at: null, created_by: user.id, created_at: time, updated_at: time };
  const summary: Surface['summary'] = { id: surfaceId, name: configuration.name, slug: configuration.slug, surface_kind: configuration.surface_kind, provider_brand: configuration.provider_brand, compliance_status: configuration.compliance_status, capabilities: configuration.capabilities, is_active: false, revision: 4, created_at: time, updated_at: time };
  return { summary, configuration, workflow_stage: 'DISABLED', primary_task: 'MANAGE_SURFACE', available_actions: ['UPDATE', 'ENABLE', 'DELETE'], deletion: { blockers: [] }, ...overrides };
}
function profileFixture(overrides: Partial<Profile> = {}): Profile {
  const configuration: components['schemas']['GeoManualProfileOut'] = { id: profileId, name: '人工采集配置', engine_surface_id: surfaceId, collection_mode: 'MANUAL', adapter_key: 'manual', language_code: 'zh-cn', region_code: 'CN', web_search_policy: 'UNKNOWN', login_state: 'ANONYMOUS', ai_channel_id: null, ai_model_id: null, settings: { require_screenshot: true }, is_active: false, last_test_status: 'UNTESTED', last_tested_at: null, revision: 7, created_by: user.id, created_at: time, updated_at: time };
  const summary: Profile['summary'] = { id: profileId, name: configuration.name, engine_surface_id: surfaceId, engine_surface: surfaceFixture().summary, collection_mode: 'MANUAL', language_code: 'zh-cn', region_code: 'CN', web_search_policy: 'UNKNOWN', login_state: 'ANONYMOUS', is_active: false, last_test_status: 'UNTESTED', last_tested_at: null, revision: 7, created_at: time, updated_at: time };
  return { summary, configuration, workflow_stage: 'DISABLED', primary_task: 'MANAGE_PROFILE', available_actions: ['UPDATE', 'ENABLE', 'DELETE'], deletion: { blockers: [] }, activation_blockers: [], ...overrides };
}
function response<T>(data: T) { return { data, response: Response.json(data) } as never; }
function failure(code = 'REVISION_CONFLICT', status = 409) {
  const envelope = { error: { code, message: '配置操作未完成，请核对后重试', details: {}, request_id: 'surfaces-request-test' } };
  return { error: envelope, response: Response.json(envelope, { status }) } as never;
}
function mockSurfaceReads(currentSurface: () => Surface = surfaceFixture, currentProfile: () => Profile = profileFixture) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/engine-surfaces') return response({ items: [currentSurface()], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/geo/engine-surfaces/{surface_id}') return response(currentSurface());
    if (path === '/api/v1/geo/collection-profiles') return response({ items: [currentProfile()], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/geo/collection-profiles/{profile_id}') return response(currentProfile());
    throw new Error(`测试收到未声明请求：${path}`);
  });
}
function renderSurfaces(entry = `/configuration/geo-surfaces?surface_id=${surfaceId}`, engineer = false) {
  const auth: AuthContextValue = { user: engineer ? { ...user, account_type: 'ENGINEER' } : user, csrfToken: 'surfaces-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: !engineer, refresh: vi.fn(), reconcileUnknownPrincipalResult: async () => {}, runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }), signOut: vi.fn() };
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }), context: { queryClient, auth } });
  const view = render(<QueryClientProvider client={queryClient}><TooltipProvider><RouterProvider router={router} context={{ queryClient, auth }} /></TooltipProvider></QueryClientProvider>);
  return { router, queryClient, view };
}
async function openAction(label: string, object = '测试观测面') {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: `更多操作：${object}` }));
  await driver.click(await screen.findByRole('menuitem', { name: label }));
  return driver;
}
export { surfaceId, profileId, otherId, surfaceFixture, profileFixture, response, failure, mockSurfaceReads, renderSurfaces, openAction };
