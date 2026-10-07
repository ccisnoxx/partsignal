import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { opportunityKeys } from './opportunities.api';
import type { OpportunityList } from './opportunities.model';
import { comparisonRead, decisionResult, detail, list, opportunity, renderOpportunities, response } from './opportunities.test-support';

afterEach(() => vi.restoreAllMocks());
it.each(['确认机会', '人工解决'] as const)('%s 后首个无缓存旧列表迟到不能回填旧 revision', async (action) => {
  const old = opportunity({ revision: 7, ...(action === '人工解决' ? { status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS', available_actions: ['RESOLVE'], primary_task: 'VIEW_EVIDENCE' } : {}) });
  let current = old;
  let listReads = 0;
  let release!: (value: never) => void;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/geo/opportunities') {
      listReads += 1;
      if (listReads === 1) return new Promise<never>((resolve) => { release = resolve; });
      return response(list(current));
    }
    if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(detail(current));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(current));
    throw new Error(`测试收到未声明 GET：${path}`);
  });
  vi.spyOn(api, 'POST').mockImplementation(async () => {
    current = opportunity({ ...old, revision: 8, title: '写后规范机会', status: action === '人工解决' ? 'RESOLVED' : 'ACKNOWLEDGED', workflow_stage: action === '人工解决' ? 'CLOSED' : 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: [] });
    return response(action === '人工解决' ? decisionResult(current, 'MANUAL_RESOLVE', { resolution_code: 'REVIEWED', resolution_comment: '已核对依据' }) : current);
  });
  const { client, router } = renderOpportunities();
  const sheet = await screen.findByRole('dialog', { name: '机会详情与历史证据' });
  const driver = userEvent.setup();
  await driver.click(await within(sheet).findByRole('button', { name: action }));
  if (action === '人工解决') {
    await driver.type(within(sheet).getByRole('textbox', { name: '处理原因代码' }), 'REVIEWED');
    await driver.type(within(sheet).getByRole('textbox', { name: '处理原因说明' }), '已核对依据');
    await driver.click(within(sheet).getByRole('button', { name: '确认人工解决' }));
  }
  await within(sheet).findByText(action === '人工解决' ? /已显式解决机会（revision 8）/ : /已确认机会（revision 8）/);
  await act(async () => { release(response(list(old))); });
  await act(async () => { await router.navigate({ to: '/geo/opportunities', search: {}, ignoreBlocker: true }); });
  expect(await screen.findByRole('button', { name: '写后规范机会' })).toBeVisible();
  await waitFor(() => expect(listReads).toBe(2));
  expect(client.getQueriesData<OpportunityList>({ queryKey: opportunityKeys.lists() })[0]?.[1]?.items[0]?.revision).toBe(8);
});
