import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import type { Subject } from './catalog.model';

const subjectId = '10000000-0000-4000-8000-000000000001';
const aliasId = '10000000-0000-4000-8000-000000000002';
const domainId = '10000000-0000-4000-8000-000000000003';
const productId = '10000000-0000-4000-8000-000000000004';
const user: AuthUser = { id: '00000000-0000-4000-8000-000000000099', username: 'catalog-admin', display_name: '测试管理员', account_type: 'ADMIN', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: '2026-10-02T08:00:00Z' };
function catalogSubject(overrides: Partial<Subject> = {}): Subject {
  return { subject_type: 'OWN_BRAND', product_id: null, product: null, id: subjectId, canonical_name: 'PartSignal', display_name: '测试品牌', description: '原始说明', parent_subject_id: null, parent: null, is_active: true,
    aliases: [{ id: aliasId, subject_id: subjectId, alias: 'PS', normalized_alias: 'ps', alias_kind: 'ABBREVIATION', language_code: null, is_active: true, available_actions: ['UPDATE', 'DELETE'], created_at: '2026-10-02T08:00:00Z' }],
    domains: [{ id: domainId, subject_id: subjectId, hostname: 'example.com', relation_type: 'OFFICIAL', is_active: true, available_actions: ['DELETE'], created_at: '2026-10-02T08:00:00Z' }],
    references: { child_subject_count: 1, monitoring_plan_count: 0, observation_run_count: 0, analysis_count: 0, opportunity_count: 0 }, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_SUBJECT', available_actions: ['UPDATE', 'DISABLE', 'CREATE_ALIAS', 'CREATE_DOMAIN'], deletion: { blockers: [{ type: 'CHILD_SUBJECT', count: 1 }] }, revision: 7, created_by: user.id, created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z', ...overrides } as Subject;
}
function catalogResponse<T>(data: T) { return { data, response: Response.json(data) } as never; }
function catalogFailure(code = 'REVISION_CONFLICT', status = 409) {
  const body = { error: { code, message: '配置冲突，请核对后重试', details: {}, request_id: 'catalog-request-test' } };
  return { error: body, response: Response.json(body, { status }) } as never;
}
function mockCatalogReads(current: () => Subject = catalogSubject) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/subjects') return catalogResponse({ items: [current()], page: 1, page_size: 20, total: 1 });
    if (path === '/api/v1/geo/subjects/{subject_id}') return catalogResponse(current());
    if (path === '/api/v1/products') return catalogResponse({ items: [], total: 0, page: 1, page_size: 10 });
    throw new Error(`测试收到未声明请求：${path}`);
  });
}
function renderCatalog(entry = `/configuration/geo-entities?subject_id=${subjectId}`, engineer = false) {
  const auth: AuthContextValue = { user: engineer ? { ...user, account_type: 'ENGINEER' } : user, csrfToken: 'catalog-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: !engineer, refresh: vi.fn(), reconcileUnknownPrincipalResult: async () => {}, runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }), signOut: vi.fn() };
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }), context: { queryClient, auth } });
  const view = render(<QueryClientProvider client={queryClient}><TooltipProvider><RouterProvider router={router} context={{ queryClient, auth }} /></TooltipProvider></QueryClientProvider>);
  return { queryClient, router, view };
}
async function openCatalogAction(label: string, object = '测试品牌') {
  const driver = userEvent.setup();
  await driver.click(await screen.findByRole('button', { name: `更多操作：${object}` }));
  await driver.click(await screen.findByRole('menuitem', { name: label }));
  return driver;
}
export { subjectId, aliasId, domainId, productId, catalogSubject, catalogResponse, catalogFailure, mockCatalogReads, renderCatalog, openCatalogAction };
