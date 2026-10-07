import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { AuthContextValue, AuthUser } from '@/app/auth/auth-provider';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import { routeTree } from '@/routeTree.gen';
import { api } from '@/shared/api/client';
import { createAuthenticatedTestQueryClient } from '@/test/auth-session';
import { vi } from 'vitest';
import type { PromptVariant } from './questions.model';

const variantId = '20000000-0000-4000-8000-000000000001';
const topicId = '20000000-0000-4000-8000-000000000002';
const user: AuthUser = { id: '00000000-0000-4000-8000-000000000099', username: 'questions-engineer', display_name: '测试工程师', account_type: 'ENGINEER', is_active: true, must_change_password: false, workflow_stage: 'ACTIVE', primary_task: 'MANAGE_USER', available_actions: [], deletion: null, revision: 1, created_at: '2026-10-02T08:00:00Z' };
function variant(overrides: Partial<PromptVariant> = {}): PromptVariant {
  return { id: variantId, query_topic_id: topicId, prompt_text: '原始问题变体', mention_mode: 'UNBRANDED', language_code: 'zh-cn', region_code: 'CN', priority: 'STANDARD', is_active: true, revision: 7, first_referenced_at: null, created_by: user.id, created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z', query_topic: { id: topicId, canonical_question: '标准主题', intent_type: 'REPLACEMENT', revision: 2 }, workflow_stage: 'ACTIVE', primary_task: 'EDIT', available_actions: ['UPDATE', 'DISABLE', 'DELETE', 'COPY'], deletion: { blockers: [] }, run_entry: { available: false, reason_code: 'NOT_IMPLEMENTED' }, ...overrides };
}
function response<T>(data: T) { return { data, response: Response.json(data) } as never; }
function failure(code = 'REVISION_CONFLICT', status = 409) {
  const body = { error: { code, message: '服务端拒绝了当前操作', details: {}, request_id: 'question-request-test' } };
  return { error: body, response: Response.json(body, { status }) } as never;
}
function mockReads(current: () => PromptVariant = variant, list: () => PromptVariant[] = () => [current()], detailFails: () => boolean = () => false) {
  const paths: string[] = [];
  const spy = vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    paths.push(path);
    if (path === '/api/v1/geo/prompt-variants') return response({ items: list(), total: list().length, page: 1, page_size: 20 });
    if (path === '/api/v1/geo/prompt-variants/{variant_id}') return detailFails() ? failure('SERVER_ERROR', 503) : response(current());
    if (path === '/api/v1/query-topics') return response({ items: [{ id: topicId, canonical_question: '标准主题' }], total: 1 });
    throw new Error(`测试收到未声明请求：${path}`);
  });
  return Object.assign(spy, { paths });
}
function renderQuestions(entry = `/geo/questions?selected=${variantId}`) {
  const auth: AuthContextValue = { user, csrfToken: 'questions-csrf', isLoading: false, isSigningOut: false, error: null, isAdmin: false, refresh: vi.fn(), reconcileUnknownPrincipalResult: async () => {}, runPrincipalBoundary: async (command) => command(new AbortController().signal, { assertCanSend: () => {} }), signOut: vi.fn() };
  const client = createAuthenticatedTestQueryClient(auth);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }), context: { queryClient: client, auth } });
  const view = render(<QueryClientProvider client={client}><TooltipProvider><RouterProvider router={router} context={{ queryClient: client, auth }} /></TooltipProvider></QueryClientProvider>);
  return { client, router, view };
}
export { failure, mockReads, renderQuestions, response, topicId, variant, variantId };
