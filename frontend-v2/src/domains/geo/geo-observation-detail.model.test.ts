import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import {
  assertGeoObservationDetail,
  formatAccuracy,
  formatBoolean,
  selectedManualHistory,
  tailManualHistory,
} from './geo-observation-detail.model';

type ManualDetail = components['schemas']['ManualGeoObservationDetail'];

const rootId = '10000000-0000-4000-8000-000000000001';
const tailId = '10000000-0000-4000-8000-000000000002';
const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';

function detail(): ManualDetail {
  return {
    observation_kind: 'MANUAL_ARTICLE_SEARCH',
    selected_observation_id: rootId,
    chain_root_id: rootId,
    chain_tail_id: tailId,
    product: { id: productId, label: 'PartSignal PS-1' },
    correction_history: [
      historyItem(rootId, null, true, true, false),
      historyItem(tailId, rootId, false, false, true),
    ],
  };
}

function historyItem(
  id: string,
  supersedesId: string | null,
  original: boolean,
  selected: boolean,
  tail: boolean,
): ManualDetail['correction_history'][number] {
  return {
    observation: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      id,
      query_topic_id: topicId,
      product_id: productId,
      product_label: 'PartSignal PS-1',
      search_platform: 'DeepSeek',
      search_query: '真实搜索词',
      tested_at: '2026-08-12T08:00:00Z',
      article_results: [],
      attachment_file_ids: [],
      notes: '',
      supersedes_id: supersedesId,
      tested_by: actorId,
      recorder: { id: actorId, username: 'engineer', display_name: '内容工程师' },
      is_current: tail,
      workflow_stage: tail ? 'READY' : 'SUPERSEDED',
      primary_task: tail ? 'VIEW_ANALYSIS' : 'VIEW_CORRECTION_HISTORY',
      available_actions: tail ? ['CORRECT'] : [],
      created_at: '2026-08-12T08:01:00Z',
    },
    query_topic: { id: topicId, canonical_question: '标准问题' },
    evidence: [],
    is_original: original,
    is_selected: selected,
    is_chain_tail: tail,
  };
}

describe('GeoObservationDetail model', () => {
  it('保留服务端 root→tail 顺序并解析 selected 与 tail', () => {
    const value = detail();

    expect(assertGeoObservationDetail(value, rootId)).toBe(value);
    expect(selectedManualHistory(value).observation.id).toBe(rootId);
    expect(tailManualHistory(value).observation.id).toBe(tailId);
  });

  it('拒绝错误 selected、节点顺序和 primary/action 组合', () => {
    const wrongSelected = detail();
    wrongSelected.selected_observation_id = tailId;
    expect(() => assertGeoObservationDetail(wrongSelected, rootId)).toThrow(/身份不完整/);

    const wrongOrder = detail();
    wrongOrder.correction_history[1]!.observation.supersedes_id = null;
    expect(() => assertGeoObservationDetail(wrongOrder, rootId)).toThrow(/顺序与节点标记/);

    const wrongTopic = detail();
    wrongTopic.correction_history[0]!.query_topic!.id = tailId;
    expect(() => assertGeoObservationDetail(wrongTopic, rootId)).toThrow(/顺序与节点标记/);

    const missingAction = detail();
    const tail = missingAction.correction_history[1]!.observation;
    tail.primary_task = 'CORRECT_OBSERVATION';
    tail.available_actions = [];
    expect(() => assertGeoObservationDetail(missingAction, rootId)).toThrow(/缺少对应动作资格/);
  });

  it('如实格式化历史空事实，不猜测默认值', () => {
    expect(formatBoolean(null)).toBe('历史未记录');
    expect(formatAccuracy(null)).toBe('未判断');
    expect(formatBoolean(false)).toBe('否');
  });
});
