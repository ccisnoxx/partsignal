import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { repairContext, issueIds } from '@/domains/publication/published-content-issue.test-fixtures';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type { Opportunity } from './opportunities.model';
import { comparisonRead, detail, failure, list, opportunity, opportunityId, renderOpportunities, response, retestId, time } from './opportunities.test-support';
import { type RepairCommand, type RepairMode, type RepairOptions } from './opportunity-publication-repair.model';

const optionPath = '/api/v1/geo/opportunities/{opportunity_id}/publication-repair-options';
const commandPath = '/api/v1/geo/opportunities/{opportunity_id}/actions/publication-repair';
const modes: RepairMode[] = ['OPEN_ISSUE', 'LINK_ISSUE', 'CREATE_REPAIR'];
const labels = { OPEN_ISSUE: '登记新发布问题', LINK_ISSUE: '关联已有发布问题', CREATE_REPAIR: '创建修复任务' };
const sheet = () => screen.getByRole('dialog', { name: '机会详情与历史证据' });
function active(): Opportunity { return opportunity({ rule_code: 'OWN_CITATION_LOST', status: 'ACKNOWLEDGED', workflow_stage: 'ACKNOWLEDGED', primary_task: 'VIEW_EVIDENCE', available_actions: ['DISMISS'], revision: 2 }); }
function readDetail(current = active()) { return { ...detail(current), available_action_types: ['PUBLICATION_REPAIR' as const] }; }
function options(mode: RepairMode, selected?: string, current = active(), issueRevision = 0): RepairOptions {
  return { opportunity_id: opportunityId, opportunity_revision: current.revision, available_action_types: ['PUBLICATION_REPAIR'], mode, page: 1, page_size: 20, total: 1, as_of: time,
    candidates: [{ published_article_id: repairContext.article.id, published_content_issue_id: mode === 'OPEN_ISSUE' ? null : issueIds.issue, issue_revision: mode === 'OPEN_ISSUE' ? null : issueRevision,
      actual_title: '待处理发布成果', platform_profile_name: '原发布平台', final_url: repairContext.article.final_url, available: true, unavailable_reason: null }],
    repair_context: mode === 'CREATE_REPAIR' && selected ? { ...repairContext, issue: { ...repairContext.issue, revision: issueRevision } } : null };
}
function receipt(body: RepairCommand, replayed = false): components['schemas']['GeoOpportunityActionResult'] {
  const trigger = detail().trigger_snapshot; const task = body.mode === 'CREATE_REPAIR'; const target = task ? issueIds.repairTask : issueIds.issue;
  return { opportunity_revision: body.expected_revision + 1, replayed, action: { id: retestId, action_type: 'PUBLICATION_REPAIR', target_type: task ? 'ContentTask' : 'PublishedContentIssue', target_id: target,
    status_snapshot: 'OPEN', created_by: opportunityId, created_at: time, target_available: true,
    navigation_path: `${task ? '/content/tasks' : '/publishing/issues'}/${target}?source_opportunity_id=${opportunityId}`,
    source_snapshot: { schema_version: 1, opportunity_id: opportunityId, opportunity_revision: body.expected_revision, trigger_snapshot: trigger, sources: trigger.sources,
      product_id: repairContext.product.id, query_topic_id: null, fact_version_id: body.mode === 'CREATE_REPAIR' ? body.fact_version_id : repairContext.original_fact_version.id,
      platform_profile_id: repairContext.platform_profile_id, published_article_id: repairContext.article.id, published_content_issue_id: issueIds.issue, request_id: 'core04-test' } } };
}
function reads(current: () => Opportunity = active, customize: (data: RepairOptions) => RepairOptions = (data) => data, revision: () => number = () => 0) {
  return vi.spyOn(api, 'GET').mockImplementation(async (path, params) => {
    if (path === '/api/v1/geo/opportunities') return response(list(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail(current()));
    if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(current()));
    if (path === optionPath) { const query = (params as { params: { query: { mode: RepairMode; page: number; selected_issue_id?: string } } }).params.query;
      return response(customize({ ...options(query.mode, query.selected_issue_id, current(), revision()), page: query.page })); }
    throw new Error(`未声明GET：${path}`);
  });
}
async function choose(label: string, name: string | RegExp) {
  const select = within(sheet()).getByRole('combobox', { name: label });
  await waitFor(() => expect(select).toBeEnabled()); await userEvent.click(select);
  await userEvent.click(await screen.findByRole('option', { name }));
}
async function input(mode: RepairMode = 'OPEN_ISSUE') {
  await userEvent.click(await within(sheet()).findByRole('button', { name: '处理发布问题' }));
  await within(sheet()).findByRole('form', { name: '机会发布修复表单' });
  if (mode !== 'OPEN_ISSUE') await choose('处理方式', labels[mode]);
  await choose(mode === 'OPEN_ISSUE' ? '发布成果' : '开放发布问题', /待处理发布成果 · 原发布平台/);
  if (mode === 'OPEN_ISSUE') await userEvent.type(within(sheet()).getByRole('textbox', { name: '发布问题描述' }), '页面正文发生变化');
  if (mode === 'CREATE_REPAIR') await choose('修复已批准事实版本', /事实 v2/);
}
const submit = (mode: RepairMode) => within(sheet()).getByRole('button', { name: `确认${labels[mode]}` });
afterEach(() => vi.restoreAllMocks());

describe('机会发布问题与修复', () => {
  it.each(modes)('%s仅使用原API的对应载荷、CSRF/幂等键及服务端目标，成功导航', async (mode) => {
    let current = active(); const get = reads(() => current);
    const post = vi.spyOn(api, 'POST').mockImplementation(async (path, params) => { expect(path).toBe(commandPath); const body = (params as { body: RepairCommand }).body; current = { ...current, revision: 3, status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS' }; return response(receipt(body)); });
    renderOpportunities(); await within(await screen.findByRole('dialog', { name: '机会详情与历史证据' })).findByRole('button', { name: '处理发布问题' });
    expect(get.mock.calls.some((call) => call[0] === optionPath)).toBe(false);
    await input(mode); await userEvent.click(submit(mode));
    const target = mode === 'CREATE_REPAIR' ? issueIds.repairTask : issueIds.issue;
    expect(await within(sheet()).findByRole('link', { name: mode === 'CREATE_REPAIR' ? '打开修复内容任务' : '打开发布问题工作区' })).toHaveAttribute('href', `${mode === 'CREATE_REPAIR' ? '/content/tasks' : '/publishing/issues'}/${target}?source_opportunity_id=${opportunityId}`);
    const body = mode === 'OPEN_ISSUE' ? { mode, expected_revision: 2, published_article_id: repairContext.article.id, kind: 'OTHER', description: '页面正文发生变化' }
      : { mode, expected_revision: 2, published_content_issue_id: issueIds.issue, expected_issue_revision: 0, ...(mode === 'CREATE_REPAIR' ? { fact_version_id: repairContext.original_fact_version.id } : {}) };
    expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0]![1]).toMatchObject({ body, params: { header: { 'X-CSRF-Token': 'geo703-csrf', 'Idempotency-Key': expect.any(String) } } });
    expect(Object.keys((post.mock.calls[0]![1] as {body: unknown}).body as object).sort()).toEqual(Object.keys(body).sort());
  });

  it('无动作token没有入口，不读取候选', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/geo/opportunities' ? response(list(active())) : path === '/api/v1/geo/opportunities/{opportunity_id}' ? response(detail(active())) : response(comparisonRead(active())));
    renderOpportunities(); await within(await screen.findByRole('dialog', { name: '机会详情与历史证据' })).findByRole('heading', { name: active().title });
    expect(within(sheet()).queryByRole('button', { name: '处理发布问题' })).not.toBeInTheDocument(); expect(get.mock.calls.some((call) => call[0] === optionPath)).toBe(false);
  });

  it('待提交和未知结果禁止重复或更改请求，仅显式以原载荷/key确认', async () => {
    reads(); let release!: (value: never) => void;
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(() => new Promise<never>((resolve) => { release = resolve; })).mockImplementation(async (_path, params) => response(receipt((params as {body: RepairCommand}).body, true)));
    renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input('CREATE_REPAIR');
    await userEvent.dblClick(submit('CREATE_REPAIR')); expect(post).toHaveBeenCalledTimes(1);
    await act(async () => release(failure(503)));
    const confirm = await within(sheet()).findByRole('button', { name: '确认原发布修复结果' });
    expect(within(sheet()).getByRole('combobox', { name: '处理方式' })).toBeDisabled(); expect(within(sheet()).getByRole('button', { name: '取消发布修复' })).toBeDisabled();
    await userEvent.click(confirm); await within(sheet()).findByRole('link', { name: '打开修复内容任务' });
    expect(post.mock.calls[1]![1]).toMatchObject({ body: (post.mock.calls[0]![1] as {body: unknown}).body, params: { header: (post.mock.calls[0]![1] as {params: {header: unknown}}).params.header } });
  });

  it('机会和问题冲突都保留输入，背景新revision不解除暂停，显式刷新后重新确认', async () => {
    let current = active(); let issueRevision = 0; reads(() => current, (data) => data, () => issueRevision);
    const post = vi.spyOn(api, 'POST').mockImplementationOnce(async () => failure(409, 'REVISION_CONFLICT')).mockImplementation(async (_path, params) => response(receipt((params as {body: RepairCommand}).body)));
    const { client: queryClient } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input('LINK_ISSUE'); await userEvent.click(submit('LINK_ISSUE'));
    await within(sheet()).findByRole('button', { name: '加载最新机会与发布修复选项' });
    current = { ...current, revision: 4 }; issueRevision = 2;
    await act(async () => { await queryClient.invalidateQueries({queryKey: ['geo', 'opportunities', 'publication-repair-options']}); });
    expect(submit('LINK_ISSUE')).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(within(sheet()).getByRole('button', { name: '加载最新机会与发布修复选项' }));
    await waitFor(() => expect(submit('LINK_ISSUE')).toBeEnabled()); await userEvent.click(submit('LINK_ISSUE'));
    expect(post.mock.calls[1]![1]).toMatchObject({body: {mode: 'LINK_ISSUE', expected_revision: 4, expected_issue_revision: 2, published_content_issue_id: issueIds.issue}});
    expect((post.mock.calls[1]![1] as {params: {header: unknown}}).params.header).not.toEqual((post.mock.calls[0]![1] as {params: {header: unknown}}).params.header);
  });

  it('服务端不可操作候选和空页不能提交，切换候选页不沿用旧目标', async () => {
    reads(active, (data) => ({ ...data, total: 21, candidates: data.page === 2 ? [] : data.candidates.map((item) => ({ ...item, available: false, unavailable_reason: '已有开放问题' })) }));
    const post = vi.spyOn(api, 'POST'); renderOpportunities(); await screen.findByRole('dialog', {name:'机会详情与历史证据'}); await input();
    expect(submit('OPEN_ISSUE')).toBeDisabled(); expect(within(sheet()).getByText('已有开放问题')).toBeVisible();
    await userEvent.click(within(sheet()).getByRole('button', {name:'下一页候选'}));
    await within(sheet()).findByText(/当前候选页为空/); expect(submit('OPEN_ISSUE')).toBeDisabled(); expect(within(sheet()).getByRole('textbox', {name:'发布问题描述'})).toHaveValue('页面正文发生变化'); expect(post).not.toHaveBeenCalled();
  });

  it('422描述错误关联字段且保留输入；403隐藏私有表单', async () => {
    reads(); const rejected = {error:{code:'VALIDATION_ERROR',message:'描述错误',details:{errors:[{loc:['body','OPEN_ISSUE','description'],msg:'描述被拒绝'}]},request_id:'core04-422'}};
    vi.spyOn(api,'POST').mockImplementationOnce(async()=>({error:rejected,response:Response.json(rejected,{status:422})}) as never).mockImplementationOnce(async()=>failure(403));
    renderOpportunities(); await screen.findByRole('dialog',{name:'机会详情与历史证据'}); await input(); await userEvent.click(submit('OPEN_ISSUE'));
    const field=within(sheet()).getByRole('textbox',{name:'发布问题描述'}); await waitFor(()=>expect(field).toHaveAttribute('aria-invalid','true')); expect(field).toHaveValue('页面正文发生变化'); expect(field.getAttribute('aria-describedby')).toContain('error');
    await userEvent.type(field,'补充'); await userEvent.click(submit('OPEN_ISSUE')); await waitFor(()=>expect(within(sheet()).queryByRole('form',{name:'机会发布修复表单'})).not.toBeInTheDocument());
  });

  it('错误目标回执转为未知，不暴露错误目标导航', async () => {
    reads(); vi.spyOn(api,'POST').mockImplementation(async(_path,params)=>{const value=receipt((params as {body:RepairCommand}).body);value.action.navigation_path='https://example.invalid/wrong';return response(value);});
    renderOpportunities(); await screen.findByRole('dialog',{name:'机会详情与历史证据'}); await input(); await userEvent.click(submit('OPEN_ISSUE'));
    await within(sheet()).findByRole('button',{name:'确认原发布修复结果'}); expect(within(sheet()).queryByRole('link',{name:'打开发布问题工作区'})).not.toBeInTheDocument();
  });

  it('确认成功后刷新失败保留回执和导航，不重发命令', async () => {
    reads(); const post=vi.spyOn(api,'POST').mockImplementation(async(_path,params)=>response(receipt((params as {body:RepairCommand}).body)));
    const {client:queryClient}=renderOpportunities(); await screen.findByRole('dialog',{name:'机会详情与历史证据'}); await input(); vi.spyOn(queryClient,'invalidateQueries').mockRejectedValue(new Error('刷新依赖失败')); await userEvent.click(submit('OPEN_ISSUE'));
    await within(sheet()).findByText(/行动已登记，关联数据刷新失败/); expect(within(sheet()).getByRole('link',{name:'打开发布问题工作区'})).toBeVisible(); expect(post).toHaveBeenCalledTimes(1);
  });

  it('主体撤销后的迟到成功不显示回执或失效新主体缓存', async () => {
    reads(); let release!:(value:never)=>void; let submitted!:RepairCommand;
    vi.spyOn(api,'POST').mockImplementation((_path,params)=>{submitted=(params as {body:RepairCommand}).body;return new Promise<never>((resolve)=>{release=resolve;});});
    const {client:queryClient}=renderOpportunities(); await screen.findByRole('dialog',{name:'机会详情与历史证据'}); await input(); const invalidate=vi.spyOn(queryClient,'invalidateQueries'); await userEvent.click(submit('OPEN_ISSUE'));
    invalidatePrincipalEpoch(queryClient); await act(async()=>release(response(receipt(submitted)))); expect(within(sheet()).queryByRole('link',{name:'打开发布问题工作区'})).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
  });

  it('候选请求失败可显式重读，不用当前产品或已有来源页补目标', async () => {
    let failed=true; const get=reads(); get.mockImplementation(async(path,params)=>{if(path===optionPath){if(failed)return failure(503);const q=(params as {params:{query:{mode:RepairMode}}}).params.query;return response({...options(q.mode),candidates:[],total:0});}if(path==='/api/v1/geo/opportunities')return response(list(active()));if(path==='/api/v1/geo/opportunities/{opportunity_id}')return response(readDetail());return response(comparisonRead(active()));});
    renderOpportunities(); await screen.findByRole('dialog',{name:'机会详情与历史证据'}); await userEvent.click(await within(sheet()).findByRole('button',{name:'处理发布问题'}));
    await within(sheet()).findByRole('button',{name:'重试读取发布修复选项'}); expect(submit('OPEN_ISSUE')).toBeDisabled(); failed=false; await userEvent.click(within(sheet()).getByRole('button',{name:'重试读取发布修复选项'})); await within(sheet()).findByText(/当前候选页为空/); expect(submit('OPEN_ISSUE')).toBeDisabled();
  });

  it('成功后取消首次在途旧列表，迟到响应不能覆盖新的机会阶段', async () => {
    let current = active(); let listReads = 0; let release!: (value: never) => void;
    vi.spyOn(api, 'GET').mockImplementation(async (path, params) => {
      if (path === '/api/v1/geo/opportunities') {
        listReads += 1;
        if (listReads === 1) return new Promise<never>((resolve) => { release = resolve; });
        return response(list(current));
      }
      if (path === '/api/v1/geo/opportunities/{opportunity_id}') return response(readDetail(current));
      if (path === '/api/v1/geo/opportunities/{opportunity_id}/comparison') return response(comparisonRead(current));
      if (path === optionPath) {
        const query = (params as { params: { query: { mode: RepairMode; selected_issue_id?: string } } }).params.query;
        return response(options(query.mode, query.selected_issue_id, current));
      }
      throw new Error(`未声明GET：${path}`);
    });
    vi.spyOn(api, 'POST').mockImplementation(async (_path, params) => {
      current = { ...current, revision: 3, title: '已登记发布问题的机会', status: 'IN_PROGRESS', workflow_stage: 'IN_PROGRESS' };
      return response(receipt((params as { body: RepairCommand }).body));
    });
    const { router } = renderOpportunities(); await screen.findByRole('dialog', { name: '机会详情与历史证据' }); await input();
    await userEvent.click(submit('OPEN_ISSUE')); await within(sheet()).findByRole('link', { name: '打开发布问题工作区' });
    await act(async () => { release(response(list(active()))); });
    await act(async () => { await router.navigate({ to: '/geo/opportunities', search: {}, ignoreBlocker: true }); });
    expect(await screen.findByRole('button', { name: '已登记发布问题的机会' })).toBeVisible();
    await waitFor(() => expect(listReads).toBe(2));
  });

});
