import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import type { PlanDetail, PlanPreview } from './plans.model';

const planId = '30000000-0000-4000-8000-000000000001';
const subjectId = '30000000-0000-4000-8000-000000000002';
const promptId = '30000000-0000-4000-8000-000000000003';
const profileId = '30000000-0000-4000-8000-000000000004';
const user: AuthUser = { id: '00000000-0000-4000-8000-000000000099', username: 'plans-engineer', display_name: '测试工程师', account_type: 'ENGINEER', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: '2026-10-02T08:00:00Z' };
function preview(overrides: Partial<PlanPreview> = {}): PlanPreview {
  return { prompt_count: 1, profile_count: 1, repeat_count: 3, run_count: 3, manual_run_count: 3, api_run_count: 0, browser_run_count: 0, unresolved_run_count: 0, estimated_cost: { value: null, currency: null, coverage: 'NONE', known_run_count: 0, unknown_run_count: 3, known_costs: [] }, blockers: [], warnings: [{ code: 'COST_UNKNOWN', field: 'estimated_cost', resource_id: null, related_resource_id: null }], ...overrides };
}
function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return { id: planId, name: '原始监测计划', description: '计划说明', subjects: [{ subject_id: subjectId, role: 'PRIMARY' }], prompt_variant_ids: [promptId], collection_profile_ids: [profileId], repeat_count: 3, schedule_kind: 'MANUAL_ONLY', cron_expression: null, timezone: 'Asia/Shanghai', budget_limit: null, rule_set_revision: 1, status: 'DISABLED', revision: 7, created_by: user.id, updated_by: user.id, created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z', preview: preview(), workflow_stage: 'READY', primary_task: 'ACTIVATE', available_actions: ['UPDATE', 'PREVIEW', 'ACTIVATE', 'ARCHIVE', 'COPY', 'DELETE'], deletion: { blockers: [] }, run_entry: { available: false, reason_code: 'NOT_IMPLEMENTED' }, ...overrides };
}
function response<T>(data: T) { return { data, response: Response.json(data) } as never; }
function failure(code = 'REVISION_CONFLICT', status = 409) {
  const body = { error: { code, message: '服务端拒绝当前操作', details: {}, request_id: 'plan-test-request' } };
  return { error: body, response: Response.json(body, { status }) } as never;
}
function mockReads(current: () => PlanDetail = plan, list: () => PlanDetail[] = () => [current()], detailFailure?: () => ReturnType<typeof failure> | undefined) {
  const paths: string[] = [];
  const spy = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    paths.push(path);
    if (path === '/api/v1/geo/monitoring-plans') return response({ items: list(), total: list().length, page: 1, page_size: 20 });
    if (path === '/api/v1/geo/monitoring-plans/{plan_id}') return detailFailure?.() ?? response(current());
    if (['/api/v1/geo/subjects', '/api/v1/geo/prompt-variants', '/api/v1/geo/collection-profiles'].includes(path)) return response({ items: [], total: 0, page: 1, page_size: 20 });
    throw new Error(`测试收到未声明请求：${path}`);
  });
  return Object.assign(spy, { paths });
}
function renderPlans(entry = `/geo/plans?selected=${planId}`) {
  const auth: AuthContextValue = { user, csrfToken: 'plans-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: false, refresh: vi.fn(), reconcileUnknownPrincipalResult: async () => {}, runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }), signOut: vi.fn() };
  const client = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }), context: { queryClient: client, auth } });
  const view = render(<QueryClientProvider client={client}><TooltipProvider><RouterProvider router={router} context={{ queryClient: client, auth }} /></TooltipProvider></QueryClientProvider>);
  return { client, router, view };
}
export { failure, mockReads, plan, planId, preview, profileId, promptId, renderPlans, response, subjectId };
