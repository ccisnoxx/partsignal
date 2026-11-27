import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import { GeoInterventionsSection } from './geo-interventions-section';
import {
  archivedCampaignId,
  campaignId,
  interventionId,
  makeComparisonPayload,
  makeErrorResult,
  makeIntervention,
  opportunityId,
  userId,
} from './geo-interventions.test-fixtures';

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeoIntervention 审查回归保护', () => {
  it('计数型指标按整数与有符号整数差值展示（不乘 100%），并显示完整中文指标名', async () => {
    const item = makeIntervention({
      attribution: {
        ...makeIntervention().attribution,
        metric_deltas: [
          {
            metric_code: 'same_fact_error_count',
            baseline_value: 3,
            retest_value: 0,
            delta: -3,
            target_value: null,
            target_met: null,
          },
          {
            metric_code: 'owned_citation_count',
            baseline_value: 2,
            retest_value: 5,
            delta: 3,
            target_value: null,
            target_met: null,
          },
          {
            metric_code: 'mention_stability',
            baseline_value: 0.5,
            retest_value: 0.8,
            delta: 0.3,
            target_value: null,
            target_met: null,
          },
        ],
      },
    });
    vi.spyOn(api, 'GET').mockResolvedValue({
      data: { items: [item], total: 1, page: 1, page_size: 20 },
      response: new Response(null, { status: 200 }),
    } as never);

    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-count"
        scope={{
          kind: 'campaign',
          campaignId,
          campaignName: 'TPS5430 国产替代活动',
          canCreate: true,
        }}
      />,
    );

    await screen.findByText('同一事实错误次数');
    expect(screen.getByText('3 → 0')).toBeInTheDocument();
    expect(screen.getByText('(-3)')).toBeInTheDocument();
    expect(screen.queryByText(/300\.0%/)).not.toBeInTheDocument();
    expect(screen.getByText('自有引用次数')).toBeInTheDocument();
    expect(screen.getByText('2 → 5')).toBeInTheDocument();
    expect(screen.getByText('(+3)')).toBeInTheDocument();
    expect(screen.getByText('提及稳定性')).toBeInTheDocument();
    expect(screen.getByText('50.0% → 80.0%')).toBeInTheDocument();
  });

  it('新建提交在 invalidate 列表重拉期间保持锁定不重复 POST，且弹窗具备 sm:max-w-2xl 桌面宽度', async () => {
    let listCallCount = 0;
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });

    vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        listCallCount += 1;
        if (listCallCount >= 2) {
          await refetchGate;
        }
        return {
          data: { items: [], total: 0, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/opportunities') {
        return {
          data: {
            items: [{ id: opportunityId, title: '推荐率下降', status: 'OPEN' }],
            total: 1,
            page: 1,
            page_size: 50,
          },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/workbench/assignees') {
        return { data: { items: [] }, response: new Response(null, { status: 200 }) };
      }
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') {
        return { data: makeComparisonPayload(), response: new Response(null, { status: 200 }) };
      }
      throw new Error(`Unexpected GET ${path}`);
    }) as typeof api.GET);

    const postSpy = vi.spyOn(api, 'POST').mockResolvedValue({
      data: makeIntervention({ status: 'PLANNED', revision: 0 }),
      response: new Response(null, { status: 201 }),
    } as never);

    const user = userEvent.setup();
    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-lock"
        scope={{
          kind: 'campaign',
          campaignId,
          campaignName: 'TPS5430 国产替代活动',
          canCreate: true,
        }}
      />,
    );

    await screen.findByText('当前活动尚未关联 GEO 干预归因记录。');
    await user.click(screen.getByRole('button', { name: '新建干预' }));
    const dlg = await screen.findByRole('dialog', { name: '新建 GEO 干预归因记录' });
    expect(dlg.className).toContain('sm:max-w-2xl');
    expect(dlg.className).not.toContain('sm:max-w-sm');

    await waitFor(() => {
      expect(within(dlg).getByRole('option', { name: /推荐率下降/ })).toBeInTheDocument();
    });
    await user.selectOptions(within(dlg).getByLabelText('关联 GEO 机会 *'), opportunityId);
    await user.type(within(dlg).getByLabelText('干预标题 *'), '防重提交验证');
    await user.type(within(dlg).getByLabelText('优化假设 *（1–2000 字）'), '验证 invalidate 期间不解锁');

    await user.click(within(dlg).getByRole('button', { name: '创建干预' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));

    // invalidateQueries refetch 尚未结束时，提交按钮必须维持禁用
    const submittingBtn = within(dlg).getByRole('button', { name: '创建中…' });
    expect(submittingBtn).toBeDisabled();
    await user.click(submittingBtn);
    expect(postSpy).toHaveBeenCalledTimes(1);

    releaseRefetch();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '新建 GEO 干预归因记录' })).not.toBeInTheDocument();
    });
  });

  it('编辑弹窗支持同 revision 409 重读清错、选项失败显式报错重试，且新提交清理旧 reloadError', async () => {
    let campaignFail = true;
    let reloadFail = true;
    const current = makeIntervention({ status: 'ACTIVE', revision: 2 });

    vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items: [current], total: 1, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/interventions/{intervention_id}') {
        if (reloadFail) {
          reloadFail = false;
          return makeErrorResult(503, 'TEMPORARY_UNAVAILABLE', '重读接口暂时不可用');
        }
        // 同 revision 返回（如目标活动刚被并发归档）
        return { data: current, response: new Response(null, { status: 200 }) };
      }
      if (path === '/api/v1/content-campaigns') {
        if (campaignFail) {
          campaignFail = false;
          return makeErrorResult(503, 'UPSTREAM_ERROR', '活动列表加载超时');
        }
        return {
          data: {
            items: [
              { id: campaignId, name: 'TPS5430 国产替代活动', status: 'ACTIVE' },
              { id: archivedCampaignId, name: '已归档活动', status: 'ARCHIVED' },
            ],
            total: 2,
            page: 1,
            page_size: 50,
          },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/workbench/assignees') {
        return {
          data: {
            items: [{ id: userId, username: 'ops1', display_name: '运营甲', account_type: 'ENGINEER' }],
          },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') {
        return { data: makeComparisonPayload(), response: new Response(null, { status: 200 }) };
      }
      throw new Error(`Unexpected GET ${path}`);
    }) as typeof api.GET);

    vi.spyOn(api, 'PATCH').mockResolvedValueOnce(
      makeErrorResult(409, 'INVALID_STATE_TRANSITION', '已归档内容活动不能关联新 GEO 干预'),
    );

    const user = userEvent.setup();
    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-same-rev"
        scope={{
          kind: 'campaign',
          campaignId,
          campaignName: 'TPS5430 国产替代活动',
          canCreate: true,
        }}
      />,
    );

    await screen.findByText('补充热阻与效率对比文章');
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const dlg = await screen.findByRole('dialog', { name: '编辑 GEO 干预归因记录' });

    // 活动列表首次失败展示显式错误和重试，点击重试后加载成功
    expect(await within(dlg).findByText(/活动列表加载超时/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(within(dlg).getByRole('option', { name: 'TPS5430 国产替代活动' })).toBeInTheDocument();
    });

    // 同 revision 409 INVALID_STATE_TRANSITION -> 首次重读失败设置 reloadError
    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));
    await user.click(await within(dlg).findByRole('button', { name: '重新加载最新记录' }));
    expect(await within(dlg).findByText(/重读接口暂时不可用/)).toBeInTheDocument();

    // 清空标题后提交：旧 reloadError 被清除，展示新的前端校验错误
    await user.clear(within(dlg).getByLabelText('干预标题 *'));
    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));
    expect(await within(dlg).findByText('干预标题不能为空且不能超过 200 个字符')).toBeInTheDocument();
    expect(within(dlg).queryByText(/重读接口暂时不可用/)).not.toBeInTheDocument();

    // 再次触发重读（同 revision=2）成功清除冲突提示并显示状态通知
    await user.type(within(dlg).getByLabelText('干预标题 *'), '恢复标题');
    vi.spyOn(api, 'PATCH').mockResolvedValueOnce(
      makeErrorResult(409, 'INVALID_STATE_TRANSITION', '已归档内容活动不能关联新 GEO 干预'),
    );
    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));
    await user.click(await within(dlg).findByRole('button', { name: '重新加载最新记录' }));
    expect(await within(dlg).findByText(/已重新加载最新版本 r2/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: '重新加载最新记录' })).not.toBeInTheDocument();
    expect(interventionId).toBeTruthy();
  });
});
