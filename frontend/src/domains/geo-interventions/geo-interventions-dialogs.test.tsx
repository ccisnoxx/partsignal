import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api/client';
import type { GeoInterventionOut } from './geo-intervention.model';
import {
  GeoInterventionsSection,
  OpportunityInterventionsDialogButton,
} from './geo-interventions-section';
import {
  archivedCampaignId,
  baselineId,
  campaignId,
  decisionId,
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

describe('GeoIntervention 前端操作弹窗闭环', () => {
  it('活动上下文支持新建干预（携带锁定 campaign_id、百分比换算与 CSRF），已归档活动隐藏新建入口', async () => {
    let items: GeoInterventionOut[] = [];
    vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items, total: items.length, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/opportunities') {
        return {
          data: {
            items: [
              {
                id: opportunityId,
                title: 'TPS5430 推荐率下降',
                status: 'OPEN',
                subject_name: 'PS-DC36',
                query_topic_name: 'TPS5430 国产替代',
              },
            ],
            total: 1,
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

    const created = makeIntervention({ status: 'PLANNED', revision: 0 });
    const postSpy = vi.spyOn(api, 'POST').mockImplementation((async () => {
      items = [created];
      return { data: created, response: new Response(null, { status: 201 }) };
    }) as typeof api.POST);

    const user = userEvent.setup();
    const { unmount } = wrap(
      <GeoInterventionsSection
        csrfToken="csrf-create"
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
    await waitFor(() => {
      expect(within(dlg).getByRole('option', { name: /TPS5430 推荐率下降/ })).toBeInTheDocument();
    });

    await user.selectOptions(within(dlg).getByLabelText('关联 GEO 机会 *'), opportunityId);
    await waitFor(() => {
      expect(within(dlg).getByRole('option', { name: /基线 91000000/ })).toBeInTheDocument();
    });
    await user.selectOptions(within(dlg).getByLabelText('关联复测基线（可选）'), baselineId);
    await user.selectOptions(within(dlg).getByLabelText('负责人（可选）'), userId);
    await user.type(within(dlg).getByLabelText('干预标题 *'), '  新建电源对比内容干预  ');
    await user.type(within(dlg).getByLabelText('优化假设 *（1–2000 字）'), '  补齐实测数据后推荐率上升  ');
    await user.type(within(dlg).getByLabelText('推荐率 (%)'), '40');

    // 超范围客户端拦截不发请求
    await user.type(within(dlg).getByLabelText('引用率 (%)'), '120');
    await user.click(within(dlg).getByRole('button', { name: '创建干预' }));
    expect(await within(dlg).findByText('目标引用率需为 0 到 100 的数字')).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();

    await user.clear(within(dlg).getByLabelText('引用率 (%)'));
    await user.click(within(dlg).getByRole('button', { name: '创建干预' }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/geo/interventions',
        expect.objectContaining({
          params: { header: { 'X-CSRF-Token': 'csrf-create' } },
          body: expect.objectContaining({
            opportunity_id: opportunityId,
            campaign_id: campaignId,
            title: '新建电源对比内容干预',
            hypothesis: '补齐实测数据后推荐率上升',
            planned_action_type: 'CONTENT_TASK',
            baseline_id: baselineId,
            assignee_id: userId,
            target_metrics: { target_recommendation_rate: 0.4 },
          }),
        }),
      );
    });

    unmount();

    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-create"
        scope={{
          kind: 'campaign',
          campaignId,
          campaignName: '已归档活动',
          canCreate: false,
        }}
      />,
    );
    await screen.findByText('补充热阻与效率对比文章');
    expect(screen.queryByRole('button', { name: '新建干预' })).not.toBeInTheDocument();
  });

  it('更新弹窗禁止 ACTIVE 回退为 PLANNED，支持 409 REVISION_CONFLICT 显式重读并区分成本绑定 409', async () => {
    let current = makeIntervention({ status: 'ACTIVE', revision: 2 });
    vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items: [current], total: 1, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/interventions/{intervention_id}') {
        current = makeIntervention({ status: 'ACTIVE', revision: 3, title: '服务端同步后的标题' });
        return { data: current, response: new Response(null, { status: 200 }) };
      }
      if (path === '/api/v1/content-campaigns') {
        return {
          data: {
            items: [
              { id: campaignId, name: 'TPS5430 国产替代活动', status: 'ACTIVE' },
              { id: archivedCampaignId, name: '历史归档活动', status: 'ARCHIVED' },
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

    const patchSpy = vi
      .spyOn(api, 'PATCH')
      .mockResolvedValueOnce(
        makeErrorResult(409, 'GEO_INTERVENTION_HAS_COST_ENTRIES', '已登记运营费用台账的 GEO 干预不可变更所属内容活动'),
      )
      .mockResolvedValueOnce(
        makeErrorResult(409, 'REVISION_CONFLICT', 'GEO 干预已被其他请求修改'),
      )
      .mockResolvedValueOnce({
        data: makeIntervention({ status: 'EVALUATING', revision: 4, title: '服务端同步后的标题' }),
        response: new Response(null, { status: 200 }),
      } as never);

    const user = userEvent.setup();
    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-edit"
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
    expect(within(dlg).queryByRole('option', { name: /PLANNED/ })).not.toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: /EVALUATING/ })).toBeInTheDocument();

    await user.selectOptions(within(dlg).getByLabelText('干预状态 *'), 'EVALUATING');
    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));

    expect(
      await within(dlg).findByText(/已登记运营费用台账的 GEO 干预不可变更所属内容活动/),
    ).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: '重新加载最新记录' })).not.toBeInTheDocument();

    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));
    expect(await within(dlg).findByRole('button', { name: '重新加载最新记录' })).toBeInTheDocument();

    await user.click(within(dlg).getByRole('button', { name: '重新加载最新记录' }));
    await waitFor(() => {
      expect(within(dlg).getByLabelText('干预标题 *')).toHaveValue('服务端同步后的标题');
    });
    await user.selectOptions(within(dlg).getByLabelText('干预状态 *'), 'EVALUATING');
    await user.click(within(dlg).getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(3));
    expect(patchSpy.mock.calls[2]?.[1]).toMatchObject({
      params: {
        path: { intervention_id: interventionId },
        header: { 'X-CSRF-Token': 'csrf-edit' },
      },
      body: expect.objectContaining({
        status: 'EVALUATING',
        expected_revision: 3,
      }),
    });
  });

  it('结案弹窗 409 重读后保留结案说明草稿并携带最新 revision 提交；终态记录隐藏全部写按钮', async () => {
    let current = makeIntervention({ status: 'EVALUATING', revision: 2 });
    vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items: [current], total: 1, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/geo/interventions/{intervention_id}') {
        current = makeIntervention({ status: 'EVALUATING', revision: 3 });
        return { data: current, response: new Response(null, { status: 200 }) };
      }
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') {
        return { data: makeComparisonPayload(), response: new Response(null, { status: 200 }) };
      }
      throw new Error(`Unexpected GET ${path}`);
    }) as typeof api.GET);

    const concluded = makeIntervention({
      status: 'CONCLUDED',
      outcome_verdict: 'TARGET_MET',
      conclusion_note: '复测窗口推荐率从 20% 升至 45%',
      revision: 4,
      available_actions: [],
    });
    const postSpy = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(makeErrorResult(409, 'REVISION_CONFLICT', 'GEO 干预已被其他请求修改'))
      .mockImplementation((async () => {
        current = concluded;
        return { data: concluded, response: new Response(null, { status: 200 }) };
      }) as typeof api.POST);

    const user = userEvent.setup();
    wrap(
      <GeoInterventionsSection
        csrfToken="csrf-conclude"
        scope={{
          kind: 'campaign',
          campaignId,
          campaignName: 'TPS5430 国产替代活动',
          canCreate: true,
        }}
      />,
    );

    await screen.findByText('补充热阻与效率对比文章');
    expect(screen.getByText('达标')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '结案' }));
    const dlg = await screen.findByRole('dialog', { name: '结案 GEO 干预并冻结归因结论' });
    await waitFor(() => {
      expect(within(dlg).getByRole('option', { name: /RECOVERED_IN_RETEST/ })).toBeInTheDocument();
    });

    await user.selectOptions(within(dlg).getByLabelText('归因判定结论 *'), 'TARGET_MET');
    await user.selectOptions(within(dlg).getByLabelText('关联机会处理结论（可选）'), decisionId);
    await user.type(
      within(dlg).getByLabelText('结案说明与复盘依据 *（1–2000 字）'),
      '复测窗口推荐率从 20% 升至 45%',
    );

    await user.click(within(dlg).getByRole('button', { name: '确认结案并冻结' }));
    await user.click(await within(dlg).findByRole('button', { name: '重新加载最新记录' }));

    await waitFor(() => {
      expect(within(dlg).getByText('当前乐观锁版本：r3')).toBeInTheDocument();
    });
    expect(within(dlg).getByLabelText('结案说明与复盘依据 *（1–2000 字）')).toHaveValue(
      '复测窗口推荐率从 20% 升至 45%',
    );

    await user.click(within(dlg).getByRole('button', { name: '确认结案并冻结' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2));
    expect(postSpy.mock.calls[1]?.[1]).toMatchObject({
      params: {
        path: { intervention_id: interventionId },
        header: { 'X-CSRF-Token': 'csrf-conclude' },
      },
      body: {
        outcome_verdict: 'TARGET_MET',
        conclusion_note: '复测窗口推荐率从 20% 升至 45%',
        decision_id: decisionId,
        expected_revision: 3,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('已结案')).toBeInTheDocument();
    });
    expect(screen.getByText('达到目标')).toBeInTheDocument();
    expect(screen.getByText('结案说明：复测窗口推荐率从 20% 升至 45%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结案' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消干预' })).not.toBeInTheDocument();
  });

  it('取消弹窗提交取消原因；机会抽屉懒加载按钮在点击前零请求且新建时过滤已归档活动', async () => {
    let current = makeIntervention({ status: 'PLANNED', revision: 1 });
    const getSpy = vi.spyOn(api, 'GET').mockImplementation((async (path: string) => {
      if (path === '/api/v1/geo/interventions') {
        return {
          data: { items: [current], total: 1, page: 1, page_size: 20 },
          response: new Response(null, { status: 200 }),
        };
      }
      if (path === '/api/v1/content-campaigns') {
        return {
          data: {
            items: [
              { id: campaignId, name: 'TPS5430 国产替代活动', status: 'ACTIVE' },
              { id: archivedCampaignId, name: '历史归档活动', status: 'ARCHIVED' },
            ],
            total: 2,
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

    const cancelled = makeIntervention({
      status: 'CANCELLED',
      conclusion_note: '合并至季度总活动处理',
      revision: 2,
      available_actions: [],
    });
    const postSpy = vi.spyOn(api, 'POST').mockImplementation((async () => {
      current = cancelled;
      return { data: cancelled, response: new Response(null, { status: 200 }) };
    }) as typeof api.POST);

    const user = userEvent.setup();
    wrap(
      <OpportunityInterventionsDialogButton
        csrfToken="csrf-opp"
        opportunityId={opportunityId}
        opportunityTitle="TPS5430 推荐率下降"
      />,
    );

    expect(getSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '干预归因记录' }));
    const outerDialog = await screen.findByRole('dialog', { name: 'GEO 干预归因记录' });
    await within(outerDialog).findByText('补充热阻与效率对比文章');

    await user.click(within(outerDialog).getByRole('button', { name: '新建干预' }));
    const createDlg = await screen.findByRole('dialog', { name: '新建 GEO 干预归因记录' });
    await waitFor(() => {
      expect(within(createDlg).getByRole('option', { name: 'TPS5430 国产替代活动' })).toBeInTheDocument();
    });
    expect(within(createDlg).queryByRole('option', { name: '历史归档活动' })).not.toBeInTheDocument();
    await user.click(within(createDlg).getByRole('button', { name: '取消' }));

    await user.click(within(outerDialog).getByRole('button', { name: '取消干预' }));
    const cancelDlg = await screen.findByRole('dialog', { name: '取消 GEO 干预' });
    await user.type(within(cancelDlg).getByLabelText('取消原因 *（1–500 字）'), '  合并至季度总活动处理  ');
    await user.click(within(cancelDlg).getByRole('button', { name: '确认取消干预' }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/geo/interventions/{intervention_id}/cancel',
        {
          params: {
            path: { intervention_id: interventionId },
            header: { 'X-CSRF-Token': 'csrf-opp' },
          },
          body: {
            reason: '合并至季度总活动处理',
            expected_revision: 1,
          },
        },
      );
    });

    await waitFor(() => {
      expect(within(outerDialog).getByText('已取消')).toBeInTheDocument();
    });
    expect(within(outerDialog).getByText('取消原因：合并至季度总活动处理')).toBeInTheDocument();
  });
});
