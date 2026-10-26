import { z } from 'zod';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { requestError, RunRequestError } from './runs.api';

export type CancelRequest = components['schemas']['GeoManualRunCancelRequest'];
export type Cancellation = components['schemas']['GeoManualRunCancellationOut'];
export const cancellationReason = z.object({
  reason: z.string().trim().min(1, '请填写取消原因').max(2000, '取消原因最多2000字符').refine((v) => !v.includes('\0'), '原因不能包含空字符'),
});
const receipt = z.object({
  run_id: z.uuid(), cancelled_by: z.uuid(), cancelled_at: z.iso.datetime({ offset: true }),
  reason: z.string().min(1).max(2000), run_revision: z.number().int().positive(), draft_revision: z.number().int().nonnegative(),
}).strict();
export async function cancelManualRun(id: string, body: CancelRequest, csrf: string, requestId: string, signal: AbortSignal): Promise<Cancellation> {
  const result = await api.POST('/api/v1/geo/observation-runs/{run_id}/manual-cancel', {
    params: { path: { run_id: id }, header: { 'X-CSRF-Token': csrf, 'X-Request-ID': requestId } },
    body, signal, cache: 'no-store',
  });
  if (!result.data) throw requestError('取消人工运行', result);
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.run_id !== id || parsed.data.run_revision !== body.expected_revision + 1 || parsed.data.draft_revision !== body.expected_draft_revision || parsed.data.reason !== body.reason.trim())
    throw new RunRequestError('取消回执不完整或与请求不符，结果未知，请重读详情核对');
  return parsed.data;
}
