import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import type { GeoRuleSet, RuleFormValues } from './geo-rules.model';
import { GeoRulesPage } from './geo-rules-page';

const user: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001', username: 'admin', display_name: '规则管理员', account_type: 'ADMIN',
  is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [],
  deletion: null, revision: 1, created_at: '2026-10-04T00:00:00Z',
};
const auth: AuthContextValue = {
  user, csrfToken: 'geo-rules-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: true,
  refresh: vi.fn(), signOut: vi.fn(), reconcileUnknownPrincipalResult: async () => {},
  runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }),
};
function configuration(): RuleFormValues {
  return {
    sample_policy: { reportable_minimum: 3, stable_minimum: 5 },
    visibility_drop_points: 0.1, recommendation_drop_points: 0.1, competitor_surge_points: 0.15,
    own_citation_previous_count: 2, repeated_error_minimum_runs: 3, repeated_error_window_days: 30,
    unstable_minimum_repeats: 3, stability_minimum_rate: 0.67, dedup_window_days: 30,
    data_quality_minimum_success_rate: null, data_quality_minimum_evidence_rate: null, run_failure_consecutive_limit: null,
    recovery: { minimum_runs: 5, visibility_drop_max_points: 0, recommendation_drop_max_points: 0, competitor_surge_max_points: 0,
      topic_visibility_minimum_rate: 0.6, owned_citation_minimum_count: 1, stability_minimum_rate: 0.67,
      fact_error_max_count: 0, strict_comparability_required: true, manual_confirmation_required: true },
  };
}
function ruleSet(overrides: Partial<GeoRuleSet> = {}): GeoRuleSet {
  return { revision: 1, configuration: configuration(), updated_at: '2026-10-04T00:00:00Z', updated_by: null, available_actions: ['UPDATE', 'PREVIEW'], ...overrides };
}
function previewResult(overrides: Partial<components['schemas']['GeoRulePreviewRead']> = {}): components['schemas']['GeoRulePreviewRead'] {
  return {
    baseline_revision: 1, proposed_revision: 1, changed: false,
    snapshot: { schema_version: 1, rule_set_revision: 1, configuration: configuration() },
    current_sample_level: 'OBSERVED', previous_sample_level: 'NONE', preview_scope: 'CONFIGURATION_AND_SAMPLE_GATES',
    sample_gates: [
      { rule_code: 'VISIBILITY_DROP', current_minimum: 5, previous_minimum: 5, sample_sufficient: false, threshold_configured: true },
      { rule_code: 'DATA_QUALITY_PROBLEM', current_minimum: 3, previous_minimum: 0, sample_sufficient: true, threshold_configured: false },
    ], ...overrides,
  };
}
function response<T>(data: T) { return { data, response: Response.json(data) } as never; }
function failure(status: number, code = 'REVISION_CONFLICT', message = '规则版本冲突') {
  return { error: { error: { code, message, request_id: 'geo-rules-request-1', details: {} } }, response: Response.json({}, { status }) } as never;
}
function mockRead(current: () => GeoRuleSet = ruleSet) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/rules') return response(current());
    throw new Error(`测试收到未声明 GET：${path}`);
  });
}
function renderRules(options: { isAdmin?: boolean } = {}) {
  const session = options.isAdmin === false ? { ...auth, isAdmin: false, user: { ...user, account_type: 'ENGINEER' as const } } : auth;
  const queryClient = createAuthenticatedTestQueryClient(session);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/configuration/geo-rules'] }), context: { queryClient, auth: session } });
  const view = render(<QueryClientProvider client={queryClient}><TooltipProvider><RouterProvider router={router} context={{ queryClient, auth: session }} /></TooltipProvider></QueryClientProvider>);
  return { queryClient, router, view };
}
const RulesTokenContext = createContext<string | null>(null);
function TokenRulesPage() { return <GeoRulesPage csrfToken={useContext(RulesTokenContext)} />; }
function CommittedToken({ token, onCommit, children }: { token: string | null; onCommit?: (token: string | null) => void; children: ReactNode }) {
  useLayoutEffect(() => { onCommit?.(token); }, [token, onCommit]);
  return <RulesTokenContext value={token}>{children}</RulesTokenContext>;
}
function renderTokenRules(onCommit?: (token: string | null) => void) {
  const queryClient = createAuthenticatedTestQueryClient(auth);
  const root = createRootRoute({ component: TokenRulesPage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  const tree = (token: string | null) => <QueryClientProvider client={queryClient}><TooltipProvider><CommittedToken token={token} onCommit={onCommit}><RouterProvider router={router} /></CommittedToken></TooltipProvider></QueryClientProvider>;
  const view = render(tree(auth.csrfToken));
  return { queryClient, view, changeToken: (token: string | null) => view.rerender(tree(token)) };
}
export { auth, configuration, failure, mockRead, previewResult, renderRules, renderTokenRules, response, ruleSet };
