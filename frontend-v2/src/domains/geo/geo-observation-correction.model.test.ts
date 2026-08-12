import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import { GeoRequestError } from './geo.api';
import {
  correctionValues,
  geoObservationCorrectionFormSchema,
  mapGeoObservationCorrectionError,
  mergeCorrectionValues,
  toGeoObservationCorrectionCreate,
} from './geo-observation-correction.model';
import { assertGeoObservationCorrectionContext } from './geo-observation-detail.model';

type CorrectionContext = components['schemas']['GeoObservationCorrectionContext'];

const rootId = '10000000-0000-4000-8000-000000000001';
const tailId = '10000000-0000-4000-8000-000000000002';
const productId = '20000000-0000-4000-8000-000000000001';
const topicId = '30000000-0000-4000-8000-000000000001';
const articleOneId = '50000000-0000-4000-8000-000000000001';
const articleTwoId = '50000000-0000-4000-8000-000000000002';
const actorId = '40000000-0000-4000-8000-000000000001';

function context(topic: string | null = topicId): CorrectionContext {
  const historicalNullTopic = topic === null;
  return {
    detail: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      selected_observation_id: historicalNullTopic ? rootId : tailId,
      chain_root_id: rootId,
      chain_tail_id: historicalNullTopic ? rootId : tailId,
      product: { id: productId, label: 'PartSignal PS-1' },
      correction_history: historicalNullTopic
        ? [historyItem(rootId, null, null, true, true)]
        : [
            historyItem(rootId, null, topic, true, false),
            historyItem(tailId, rootId, topic, false, true),
          ],
    },
    correction_article_results: [
      {
        published_article_id: articleOneId,
        discovered: true,
        mentioned: false,
        accuracy: 'PARTIAL',
        title: '文章一',
        platform_name: '官网',
        final_url: 'https://example.com/one',
      },
      {
        published_article_id: articleTwoId,
        discovered: null,
        mentioned: null,
        accuracy: null,
        title: '文章二',
        platform_name: '媒体',
        final_url: 'https://example.com/two',
      },
    ],
    query_topic_options: topic === null
      ? [{ id: topicId, canonical_question: '标准问题' }]
      : [],
  };
}

function historyItem(
  id: string,
  supersedesId: string | null,
  topic: string | null,
  original: boolean,
  tail: boolean,
): CorrectionContext['detail']['correction_history'][number] {
  return {
    observation: {
      observation_kind: 'MANUAL_ARTICLE_SEARCH',
      id,
      query_topic_id: topic,
      product_id: productId,
      product_label: 'PartSignal PS-1',
      search_platform: 'DeepSeek',
      search_query: '真实搜索词',
      tested_at: '2026-08-12T08:00:00Z',
      article_results: [],
      attachment_file_ids: [],
      notes: '历史备注',
      supersedes_id: supersedesId,
      tested_by: actorId,
      recorder: { id: actorId, username: 'engineer', display_name: '内容工程师' },
      is_current: tail,
      workflow_stage: tail ? 'READY' : 'SUPERSEDED',
      primary_task: tail ? 'CORRECT_OBSERVATION' : 'VIEW_CORRECTION_HISTORY',
      available_actions: tail ? ['CORRECT'] : [],
      created_at: '2026-08-12T08:01:00Z',
    },
    query_topic: topic === null ? null : { id: topic, canonical_question: '标准问题' },
    evidence: [],
    is_original: original,
    is_selected: tail,
    is_chain_tail: tail,
  };
}

describe('GEO Observation Correction model', () => {
  it('采用服务端候选事实，并为本次时间、证据和 Notes 建立新草稿', () => {
    const value = context();
    expect(assertGeoObservationCorrectionContext(value, tailId)).toBe(value);

    const initial = correctionValues(value, new Date(2026, 7, 12, 17, 30));
    expect(initial).toMatchObject({
      query_topic_id: topicId,
      tested_at: '2026-08-12T17:30',
      attachment_file_ids: [],
      notes: '',
      article_results: [
        { published_article_id: articleOneId, discovered: true, mentioned: false },
        { published_article_id: articleTwoId, discovered: null, mentioned: null },
      ],
    });
    expect(geoObservationCorrectionFormSchema.safeParse(initial).success).toBe(false);
  });

  it('payload 冻结业务字段、使用权威尾 ID，且只提交本次证据', () => {
    const value = context();
    const values = {
      ...correctionValues(value),
      query_topic_id: '90000000-0000-4000-8000-000000000001',
      tested_at: '2026-08-12T18:30',
      article_results: [
        {
          published_article_id: articleOneId,
          discovered: false,
          mentioned: false,
          accuracy: null,
        },
      ],
      attachment_file_ids: ['60000000-0000-4000-8000-000000000001'],
      notes: '本次更正原因',
    };

    expect(toGeoObservationCorrectionCreate(value, values)).toMatchObject({
      product_id: productId,
      query_topic_id: topicId,
      search_platform: 'DeepSeek',
      search_query: '真实搜索词',
      supersedes_id: tailId,
      attachment_file_ids: ['60000000-0000-4000-8000-000000000001'],
      notes: '本次更正原因',
    });
  });

  it('历史空 Topic 必须显式选择，冲突刷新按文章 ID 保留仍有效草稿', () => {
    const originalContext = context(null);
    const previous = {
      ...correctionValues(originalContext),
      query_topic_id: topicId,
      tested_at: '2026-08-12T18:30',
      article_results: [{
        published_article_id: articleOneId,
        discovered: false,
        mentioned: true,
        accuracy: 'ACCURATE' as const,
      }],
      attachment_file_ids: ['60000000-0000-4000-8000-000000000001'],
      notes: '保留的草稿',
    };
    const refreshed = context(null);
    refreshed.correction_article_results = [
      refreshed.correction_article_results[0]!,
      {
        published_article_id: '50000000-0000-4000-8000-000000000003',
        discovered: null,
        mentioned: null,
        accuracy: null,
        title: '新增文章',
        platform_name: '社区',
        final_url: 'https://example.com/three',
      },
    ];

    const merged = mergeCorrectionValues(refreshed, previous);
    expect(merged).toMatchObject({
      query_topic_id: topicId,
      tested_at: '2026-08-12T18:30',
      attachment_file_ids: previous.attachment_file_ids,
      notes: '保留的草稿',
      article_results: [
        { published_article_id: articleOneId, discovered: false, mentioned: true },
        { published_article_id: '50000000-0000-4000-8000-000000000003', discovered: null },
      ],
    });
    expect(toGeoObservationCorrectionCreate(refreshed, merged).query_topic_id).toBe(topicId);
  });

  it('拒绝无 CORRECT 尾、重复候选和非空 Topic 的多余选项', () => {
    const missingAction = context();
    missingAction.detail.correction_history[1]!.observation.available_actions = [];
    expect(() => assertGeoObservationCorrectionContext(missingAction, tailId)).toThrow(
      /动作资格/,
    );

    const duplicate = context();
    duplicate.correction_article_results.push(duplicate.correction_article_results[0]!);
    expect(() => assertGeoObservationCorrectionContext(duplicate, tailId)).toThrow(
      /更正上下文/,
    );

    const extraTopics = context();
    extraTopics.query_topic_options = [{ id: topicId, canonical_question: '标准问题' }];
    expect(() => assertGeoObservationCorrectionContext(extraTopics, tailId)).toThrow(
      /更正上下文/,
    );
  });

  it('只映射更正可编辑字段，冻结字段错误保留在摘要', () => {
    const mapped = mapGeoObservationCorrectionError(new GeoRequestError(
      '请求失败',
      422,
      {
        code: 'VALIDATION_ERROR',
        message: '更正字段无效',
        request_id: 'req-geo-correction',
        details: {
          errors: [
            { loc: ['body', 'query_topic_id'], msg: 'Topic 无效', type: 'value_error' },
            { loc: ['body', 'search_platform'], msg: '冻结字段变化', type: 'value_error' },
          ],
        },
      },
    ));

    expect(mapped.fields).toEqual({ query_topic_id: 'Topic 无效' });
    expect(mapped.formMessage).toBe('更正字段无效');
    expect(mapped.requestId).toBe('req-geo-correction');
  });
});
