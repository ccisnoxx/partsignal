import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import { opportunityComparisonOptions, opportunityDetailOptions, opportunityListOptions, resolveOpportunity } from './opportunities.api';
import { comparisonRead, decisionResult, opportunity, opportunityId, response, retestId } from './opportunities.test-support';
afterEach(() => vi.restoreAllMocks());
describe('GEO 机会读取生命周期', () => {
  it.each(['list', 'detail', 'comparison'])('%s 查询把真实 AbortSignal 传到 HTTP，取消会中断对应请求', async (kind) => {
    let signal: AbortSignal | undefined;
    const read = vi.spyOn(api, 'GET').mockImplementation(async (_path, options) => {
      signal = (options as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise<never>(() => {});
    });
    const client = createAppQueryClient();
    const options = kind === 'list' ? opportunityListOptions({ q: '电压', page: 2 }) : kind === 'detail' ? opportunityDetailOptions({ opportunity_id: opportunityId, source_page: 3 }) : opportunityComparisonOptions({ opportunity_id: opportunityId, retest_batch_id: retestId });
    const pending = client.fetchQuery(options as ReturnType<typeof opportunityListOptions>).catch(() => undefined);
    expect(read).toHaveBeenCalledTimes(1); expect(signal).toBeInstanceOf(AbortSignal); expect(signal?.aborted).toBe(false);
    await client.cancelQueries({ queryKey: options.queryKey });
    expect(signal?.aborted).toBe(true); await pending;
    if (kind === 'detail') expect(read.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', params: { path: { opportunity_id: opportunityId }, query: { source_page: 3, source_page_size: 20 } } });
    if (kind === 'comparison') expect(read.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', params: { path: { opportunity_id: opportunityId }, query: { retest_batch_id: retestId } } });
  });
  it('拒绝比较机会或复测身份不匹配，不把其他选择的结果当当前快照', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(comparisonRead(opportunity(), true)));
    const client = createAppQueryClient();
    await expect(client.fetchQuery(opportunityComparisonOptions({ opportunity_id: opportunityId, retest_batch_id: '30000000-0000-4000-8000-000000000003' }))).rejects.toThrow('比较快照身份或修订号与请求不一致');
  });
  it('解决命令携带真实 signal、no-store、CSRF 和显式证据选择', async () => {
    const current = opportunity({ revision: 2, status: 'RESOLVED', available_actions: [] });
    const values = { resolution_code: 'RECOVERED', resolution_comment: '已核对复测' };
    const evidence = comparisonRead(opportunity(), true).comparison!;
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response(decisionResult(current, 'RETEST_RESOLVE', values, evidence)));
    const signal = new AbortController().signal;
    await resolveOpportunity(opportunityId, { expected_revision: 1, ...values, resolution_method: 'RETEST', retest_batch_id: retestId, comparison_fingerprint: evidence.fingerprint }, 'csrf', signal);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toMatchObject(['/api/v1/geo/opportunities/{opportunity_id}/resolve', { cache: 'no-store', signal, params: { header: { 'X-CSRF-Token': 'csrf' } }, body: { resolution_method: 'RETEST', retest_batch_id: retestId, comparison_fingerprint: evidence.fingerprint } }]);
  });
});
