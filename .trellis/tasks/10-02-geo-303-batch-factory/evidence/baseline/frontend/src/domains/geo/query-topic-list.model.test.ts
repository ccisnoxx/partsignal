import { describe, expect, it } from 'vitest';

import {
  canonicalQueryTopicSearchRecord,
  intentLabels,
  queryTopicFormSchema,
  queryTopicObservationHref,
  queryTopicReferenceHrefs,
  queryTopicSearchSchema,
  queryTopicSearchToApiParams,
  sortingToQueryTopicSort,
  toQueryTopicUpdate,
  type QueryTopicListItem,
} from './query-topic-list.model';

const topic = {
  id: '40000000-0000-4000-8000-000000000001',
  canonical_question: '如何选择低噪声放大器？',
  intent_type: 'PRODUCT',
  variants: ['低噪声放大器选型'],
  references: { content_task_count: 1, geo_optimization_count: 2, observation_count: 3 },
  primary_task: 'USE_FOR_OBSERVATION',
  available_actions: ['UPDATE'],
  deletion: null,
  revision: 2,
  created_at: '2026-08-13T00:00:00Z',
} satisfies QueryTopicListItem;

describe('Query Topic 列表 URL 与动作模型', () => {
  it('规范化搜索并逐项映射服务端分页与排序参数', () => {
    const search = queryTopicSearchSchema.parse({
      q: '  低噪声  ', sort: 'INTENT_DESC', page: '2', pageSize: '10', extra: 'drop',
    });
    expect(search).toEqual({ q: '低噪声', sort: 'INTENT_DESC', page: 2, pageSize: 10 });
    expect(queryTopicSearchToApiParams(search)).toEqual({
      q: '低噪声', sort: 'INTENT_DESC', page: 2, page_size: 10,
    });
    expect(canonicalQueryTopicSearchRecord(search)).toEqual({
      q: '低噪声', sort: 'INTENT_DESC', page: 2, pageSize: 10,
    });
    expect(sortingToQueryTopicSort([{ id: 'canonical_question', desc: true }]))
      .toBe('QUESTION_DESC');
  });

  it('只按服务端 primary_task 生成 handoff，并固定三类 resolve links', () => {
    expect(queryTopicObservationHref(topic)).toBe(
      `/geo/observations/new?queryTopicId=${topic.id}`,
    );
    expect(queryTopicReferenceHrefs(topic.id)).toEqual({
      contentTasks: `/content/tasks?queryTopicId=${topic.id}&queryTopicReference=CONTENT_TASK&archiveStatus=ALL&page=1&pageSize=20`,
      geoOptimization: `/content/tasks?queryTopicId=${topic.id}&queryTopicReference=GEO_OPTIMIZATION_SOURCE&archiveStatus=ALL&page=1&pageSize=20`,
      observations: `/geo/observations?queryTopicId=${topic.id}&page=1&pageSize=20`,
    });
    expect(intentLabels.PRODUCT).toBe('产品');
  });

  it('表单保持输入，expected_revision 只来自 canonical topic', () => {
    const values = queryTopicFormSchema.parse({
      canonical_question: '问题',
      intent_type: 'PRODUCT',
      variants: [{ value: '变体一' }, { value: '变体二' }],
    });
    expect(toQueryTopicUpdate(values, 7)).toEqual({
      canonical_question: '问题',
      intent_type: 'PRODUCT',
      variants: ['变体一', '变体二'],
      expected_revision: 7,
    });
  });
});
