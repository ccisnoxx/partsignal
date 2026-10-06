import { useQuery, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { createAppQueryClient } from '@/app/query-client';
import { initializePrincipalEpoch } from '@/app/auth/principal-epoch';
import type { components } from '@/shared/api/generated/schema';
import { detail, runId, batchId, asOf } from './runs.test-support';
import { runDetailOptions } from './runs.api';
import { RunAnalysis } from './run-analysis';
import { RunReview } from './run-review';

const analysisId = '10000000-0000-4000-8000-000000000010';
const claimId = '10000000-0000-4000-8000-000000000011';
const factId = '10000000-0000-4000-8000-000000000012';
const reviewId = '10000000-0000-4000-8000-000000000013';
function analyzedDetail(): components['schemas']['GeoRunDetail'] {
  const value = detail();
  value.run = { ...value.run, revision: 7, status: 'NEEDS_REVIEW', workflow_stage: 'REVIEW_REQUIRED', primary_task: 'VIEW_REVIEW' };
  value.answer!.answer_text = '😀前文 型号A推荐使用，但额定电压为5V。';
  const machine: components['schemas']['GeoAnalysisResult'] = {
    analysis: {
      id: analysisId, run_id: runId, answer_snapshot_id: batchId, revision: 1, status: 'COMPLETED', analyzer_type: 'DETERMINISTIC', analyzer_version: 'r4-1',
      input_snapshot: { schema_version: 1, answer_sha256: 'b'.repeat(64), subjects: value.run.input_snapshot.subjects, fact_versions: [{ subject_id: runId, fact_version_id: factId }], configuration: { rule_set_version: '1', model_name: null, model_version: null, prompt_template_version: null, prompt_sha256: null, parameters: { temperature: null, top_p: null, max_output_tokens: null, seed: null } } },
      input_sha256: 'd'.repeat(64), confidence_summary: { mentions: 1, recommendations: 1, claims: 1 }, review_required_reasons: ['SEVERE_INCORRECT_CLAIM'], error_code: null, error_summary: null, created_at: asOf, finished_at: asOf,
    },
    mentions: [{ id: batchId, analysis_revision_id: analysisId, subject_id: runId, mention_count: 1, first_character_offset: 4, matched_aliases: ['型号A'], confidence: 1 }],
    recommendations: [{ id: batchId, analysis_revision_id: analysisId, subject_id: runId, recommendation: 'RECOMMENDED', rank: 1, rationale_excerpt: '推荐使用', confidence: 1 }],
    claims: [{ id: claimId, analysis_revision_id: analysisId, subject_id: runId, fact_version_id: factId, claim_kind: 'PARAMETER', claim_text: '额定电压为5V', claim_sha256: 'e'.repeat(64), verdict: 'INCORRECT', severity: 'HIGH', fact_excerpt: '额定电压为3.3V', explanation: '回答电压与批准事实不符', confidence: 1 }],
    citations: [{ analysis_revision_id: analysisId, citation_id: batchId, source_category: 'UNKNOWN', subject_id: null }], citation_classification_complete: true,
  };
  value.analysis = {
    selection: { run_id: runId, current_analysis_revision_id: analysisId, current_review_id: null }, revisions: [machine], reviews: [],
    effective_results: { mentions: machine.mentions, recommendations: machine.recommendations, claims: machine.claims, citations: machine.citations, citation_classification_complete: true },
    review_required: true, review_gate_passed: false, available_actions: ['REVIEW'],
  };
  return value;
}
function reviewReceipt(body?: components['schemas']['GeoRunReviewRequest']): components['schemas']['GeoRunReviewCreated'] {
  return { run_revision: (body?.expected_run_revision ?? 7) + 1, review: {
    id: reviewId, run_id: runId, analysis_revision_id: body?.analysis_revision_id ?? analysisId, decision: body?.decision ?? 'CONFIRMED', correction_payload: body?.correction_payload ?? null,
    comment: body?.comment ?? '已核对严重电压错误', reviewer_id: runId, created_at: asOf,
  } };
}
function response(data: unknown) { return { data, response: Response.json(data) } as never; }
function failure(code = 'REVISION_CONFLICT', status = 409) {
  const error = { error: { code, message: '复核上下文已变化', details: {}, request_id: 'review-req' } };
  return { error, response: Response.json(error, { status }) } as never;
}
function renderReview(value = analyzedDetail(), suppliedClient?: QueryClient) {
  const client = suppliedClient ?? createAppQueryClient();
  initializePrincipalEpoch(client, 'actor-a');
  function ReviewRoute() {
    const router = useRouter();
    const query = useQuery({ ...runDetailOptions(runId), initialData: value });
    return <>
      <button onClick={() => router.history.push(`/geo/runs?run_id=${runId}&q=changed`)}>改变筛选</button>
      <button onClick={() => router.history.push('/geo/plans')}>去计划</button>
      {query.data && <RunAnalysis detail={query.data} reviewControl={<RunReview detail={query.data} csrfToken="csrf" blocked={Boolean(query.error) || query.isFetching} readError={query.error} />} />}
    </>;
  }
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/geo/runs', component: ReviewRoute });
  const plans = createRoute({ getParentRoute: () => root, path: '/geo/plans', component: () => <p>计划页</p> });
  const router = createRouter({ routeTree: root.addChildren([route, plans]), history: createMemoryHistory({ initialEntries: [`/geo/runs?run_id=${runId}`] }) });
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router, view };
}
export { analyzedDetail, analysisId, claimId, factId, reviewId, reviewReceipt, response, failure, renderReview };
