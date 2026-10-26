import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import type { PrincipalContinuation } from '@/app/auth/principal-epoch';
import { insightKeys } from '@/domains/geo-insights/insights.api';
import { reportKeys } from '@/domains/geo-reports/reports.api';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { requestError, runKeys, RunRequestError } from './runs.api';

export type Reason = components['schemas']['ReanalysisReason'];
export type Accepted = components['schemas']['GeoRunReanalysisAccepted'];
export type Detail = components['schemas']['GeoRunDetail'];
export const analysisStatusLabels = {
  PENDING: '待处理（排队或执行中）',
  COMPLETED: '已完成',
  FAILED: '失败',
} satisfies Record<
  Detail['analysis']['revisions'][number]['analysis']['status'],
  string
>;
export const reasonLabels = {
  RULES_UPDATED: '分析规则已更新',
  DICTIONARY_UPDATED: '对象词典或别名已更新',
  FACTS_UPDATED: '批准事实已更新',
  RETRY_FAILED: '显式重试失败分析',
} satisfies Record<Reason, string>;
export const reasonForm = z.object({
  reason: z
    .string()
    .pipe(
      z.enum(
        [
          'RULES_UPDATED',
          'DICTIONARY_UPDATED',
          'FACTS_UPDATED',
          'RETRY_FAILED',
        ],
        { error: '请选择重新分析原因' },
      ),
    ),
});
export type Values = z.input<typeof reasonForm>;
export type Submitted = z.output<typeof reasonForm>;
export type ReanalysisRequest = {
  runId: string;
  requestId: string;
  body: components['schemas']['GeoRunReanalysisRequest'];
};
export function basis(detail: Detail) {
  return JSON.stringify([
    detail.run.id,
    detail.run.revision,
    detail.analysis.selection.current_analysis_revision_id,
    detail.analysis.revisions.map((row) => [
      row.analysis.id,
      row.analysis.status,
    ]),
  ]);
}
export function failureKind(error: unknown) {
  const status = error instanceof RunRequestError ? error.status : undefined;
  return !status ||
    status >= 500 ||
    !(error instanceof RunRequestError && error.detail)
    ? 'unknown'
    : [401, 403, 404].includes(status)
      ? 'denied'
      : status === 409
        ? 'conflict'
        : 'rejected';
}
export async function requestReanalysis(
  request: ReanalysisRequest,
  csrfToken: string,
  signal: AbortSignal,
) {
  const result = await api.POST(
    '/api/v1/geo/observation-runs/{run_id}/reanalyze',
    {
      params: {
        path: { run_id: request.runId },
        header: {
          'X-CSRF-Token': csrfToken,
          'X-Request-ID': request.requestId,
        },
      },
      body: request.body,
      signal,
      cache: 'no-store',
    },
  );
  if (!result.data) throw requestError('接受重新分析', result);
  const identity = canonicalUuidSchema.safeParse(
    result.data.analysis_revision_id,
  );
  if (
    result.data.run_id !== request.runId ||
    result.data.request_id !== request.requestId ||
    !identity.success
  )
    throw new RunRequestError(
      '重新分析回执身份不一致，请读取分析历史核对，勿重发原请求',
    );
  return { ...result.data, analysis_revision_id: identity.data };
}
// 两个已发生的刷新时点共用取消/主体边界，终结刷新不再次触发Run读取。
async function invalidateReadModels(
  client: QueryClient,
  owner: PrincipalContinuation,
  keys: readonly QueryKey[],
) {
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  if (!owner.isCurrent()) return;
  await Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}
export function invalidateReanalysis(
  client: QueryClient,
  owner: PrincipalContinuation,
) {
  return invalidateReadModels(client, owner, [
    runKeys.root(),
    insightKeys.root,
    reportKeys.root,
  ]);
}
export function invalidateReanalysisResults(
  client: QueryClient,
  owner: PrincipalContinuation,
) {
  return invalidateReadModels(client, owner, [
    insightKeys.root,
    reportKeys.root,
  ]);
}
