import { describe, expect, it } from 'vitest';
import { batchSearchToParams, isCanonicalRunSearch, runCost, runSearchSchema, runSearchToParams } from './runs.model';
const id = '10000000-0000-4000-8000-000000000001';
describe('运行中心 URL 合同', () => {
  it('规范身份、过滤、时间、分页和选择，删除默认值与未批准参数', () => {
    const search = runSearchSchema.parse({
      view: 'runs',
      batch_id: id.toUpperCase(),
      run_id: id,
      edit: '1',
      status: 'COLLECTED',
      collection_mode: 'MANUAL',
      latest_only: 'false',
      needs_review: 'false',
      q: ' 问题 ',
      page: '2',
      page_size: '50',
      created_from: '2026-10-02T10:00:00+08:00',
      sort: 'CREATED_DESC',
      formula: 'unknown',
    });
    expect(search).toEqual({
      view: 'runs',
      batch_id: id,
      run_id: id,
      edit: 1,
      status: 'COLLECTED',
      collection_mode: 'MANUAL',
      latest_only: false,
      needs_review: false,
      q: '问题',
      page: 2,
      page_size: 50,
      created_from: '2026-10-02T02:00:00.000Z',
    });
    expect(isCanonicalRunSearch(search, search)).toBe(true);
    expect(isCanonicalRunSearch({ ...search, page: '02' }, search)).toBe(false);
    expect(runSearchToParams(search)).toMatchObject({
      batch_id: id,
      page: 2,
      page_size: 50,
      latest_only: false,
      needs_review: false,
      sort: 'CREATED_DESC',
    });
  });
  it('无效身份、时间窗、分页和枚举不会发给 API；创建与编辑互斥', () => {
    expect(
      runSearchSchema.parse({
        run_id: 'bad',
        edit: 1,
        status: 'UNKNOWN',
        page: -1,
        page_size: 100,
        created_from: '2026-10-03T00:00:00Z',
        created_to: '2026-10-02T00:00:00Z',
      }),
    ).toEqual({});
    expect(runSearchSchema.parse({ create: 1, run_id: id, edit: 1 })).toEqual({ create: 1 });
    expect(runSearchToParams({})).toMatchObject({ page: 1, page_size: 20, latest_only: true });
  });
  it('批次筛选与运行筛选使用各自 API 合同，不将运行状态映射成批次状态', () => {
    const params = batchSearchToParams({ status: 'COLLECTED', batch_status: 'PARTIAL', trigger_type: 'MANUAL' });
    expect(params.status).toBe('PARTIAL');
    expect(params.trigger_type).toBe('MANUAL');
    expect(params).not.toHaveProperty('latest_only');
    expect(runCost({ cost_amount: null, cost_currency: null })).toBe('未知');
    expect(runCost({ cost_amount: '0', cost_currency: 'USD' })).toBe('0 USD');
  });
});
