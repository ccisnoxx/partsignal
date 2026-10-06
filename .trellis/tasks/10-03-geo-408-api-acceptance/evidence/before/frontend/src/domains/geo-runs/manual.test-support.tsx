import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import type { components } from '@/shared/api/generated/schema';
import { ManualEditor } from './manual-editor';
import type { ManualContext, ManualDraft } from './manual.model';

const runId = '10000000-0000-4000-8000-000000000001';
const screenshotId = '10000000-0000-4000-8000-000000000002';
const actorId = '10000000-0000-4000-8000-000000000003';
const initialDraft: ManualDraft = {
  answer_text: '已有回答',
  answer_format: 'TEXT',
  source_product: null,
  source_model: null,
  source_version: null,
  web_search_observed: null,
  screenshot_file_id: screenshotId,
  raw_payload_file_id: '10000000-0000-4000-8000-000000000004',
  raw_payload_summary: { schema_version: 1, payload_format: 'TEXT', payload_bytes: 12, finish_reason: null },
  citations: [],
  collected_at: '2026-10-02T10:30:00+08:00',
};
function draftOut(draft = initialDraft, revision = 3): components['schemas']['GeoManualDraftOut'] {
  return { run_id: runId, draft_revision: revision, draft, updated_by: actorId, updated_at: '2026-10-02T02:31:00Z' };
}
function context(overrides: Partial<ManualContext> = {}): ManualContext {
  return {
    run_id: runId,
    batch_id: runId,
    run_revision: 2,
    draft_revision: 3,
    draft: draftOut(),
    workflow_stage: 'MANUAL_ENTRY_REQUIRED',
    primary_task: 'ENTER_MANUAL_OBSERVATION',
    available_actions: ['ENTER_MANUAL_OBSERVATION'],
    require_screenshot: true,
    collection_blockers: [],
    input_snapshot: {
      schema_version: 1,
      data_classification: 'PUBLIC',
      rule_set_revision: 1,
      subjects: [],
      prompt: {
        id: runId,
        revision: 1,
        query_topic_id: runId,
        query_topic_revision: 1,
        canonical_question: '冻结问题',
        prompt_text: '冻结提问原文',
        intent_type: 'PRODUCT',
        mention_mode: 'UNBRANDED',
        priority: 'STANDARD',
        language_code: 'zh-CN',
        region_code: 'CN',
      },
      profile: {
        id: runId,
        revision: 1,
        adapter_key: 'manual',
        adapter_version: '1',
        name: '冻结人工配置',
        collection_mode: 'MANUAL',
        ai_channel_id: null,
        ai_model_id: null,
        language_code: 'zh-CN',
        region_code: 'CN',
        login_state: 'ANONYMOUS',
        web_search_policy: 'UNKNOWN',
        settings: { require_screenshot: true },
        surface: {
          id: runId,
          revision: 1,
          name: '观测面',
          surface_kind: 'CONSUMER_UI',
          provider_brand: 'CUSTOM',
          compliance_status: 'APPROVED',
          capabilities: {
            answer_text: true,
            citations: true,
            web_search_signal: true,
            model_version: false,
            usage: false,
            cost: false,
          },
        },
      },
    },
    ...overrides,
  };
}
const receipt: components['schemas']['GeoManualObservationSubmitted'] = {
  run_id: runId,
  answer_snapshot_id: screenshotId,
  answer_sha256: 'a'.repeat(64),
  run_revision: 3,
  draft_revision: 3,
  collected_at: '2026-10-02T02:30:00Z',
  submitted_at: '2026-10-02T02:31:00Z',
  collection_status: 'COLLECTED',
  analysis_dispatch: 'NOT_IMPLEMENTED',
};
function response(data: unknown) {
  return { data, response: Response.json(data) } as never;
}
function failure(code = 'REVISION_CONFLICT', status = 409) {
  const body = { error: { code, message: '服务端拒绝当前人工操作', details: {}, request_id: 'req-manual' } };
  return { error: body, response: Response.json(body, { status }) } as never;
}
function renderEditor() {
  const client = createAppQueryClient();
  const submitted = vi.fn();
  function EditorRoute() {
    const router = useRouter();
    return (
      <>
        <button onClick={() => router.history.push(`/geo/runs?run_id=${runId}&edit=1&q=changed`)} type="button">
          改变筛选
        </button>
        <button onClick={() => router.history.push('/geo/plans')} type="button">
          去计划
        </button>
        <ManualEditor
          csrfToken="manual-csrf"
          onClose={() => router.history.push(`/geo/runs?run_id=${runId}`)}
          onSubmitted={submitted}
          runId={runId}
        />
      </>
    );
  }
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/geo/runs', component: EditorRoute });
  const plans = createRoute({ getParentRoute: () => root, path: '/geo/plans', component: () => <p>计划页</p> });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [`/geo/runs?run_id=${runId}&edit=1`] }),
    routeTree: root.addChildren([route, plans]),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, submitted, router, view };
}
export { runId, screenshotId, actorId, initialDraft, draftOut, context, receipt, response, failure, renderEditor };
