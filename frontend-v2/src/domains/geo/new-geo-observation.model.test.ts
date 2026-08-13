import { describe, expect, it } from 'vitest';

import { GeoRequestError } from './geo.api';
import {
  emptyGeoObservationValues,
  mapGeoObservationCreateError,
  newGeoObservationFormSchema,
  newGeoObservationSearchSchema,
  syncArticleResults,
  toGeoObservationCreate,
} from './new-geo-observation.model';

const candidates = [
  {
    published_article_id: '10000000-0000-4000-8000-000000000001',
    title: '文章一',
    platform_name: '官网',
    final_url: 'https://example.com/one',
    status: 'COMPLETED' as const,
  },
  {
    published_article_id: '10000000-0000-4000-8000-000000000002',
    title: '文章二',
    platform_name: '媒体',
    final_url: 'https://example.com/two',
    status: 'COMPLETED' as const,
  },
];

describe('New GEO Observation model', () => {
  it('接收精确 Topic 与 GEO 平台 handoff，并拒绝空平台', () => {
    expect(newGeoObservationSearchSchema.parse({
      queryTopicId: '10000000-0000-4000-8000-000000000001',
      geoPlatform: '  DeepSeek  ',
    })).toEqual({
      queryTopicId: '10000000-0000-4000-8000-000000000001',
      geoPlatform: 'DeepSeek',
    });
    expect(newGeoObservationSearchSchema.safeParse({ geoPlatform: '  ' }).success).toBe(false);
  });
  it('handoff 只接受明确的 Query Topic UUID', () => {
    expect(newGeoObservationSearchSchema.parse({
      queryTopicId: '30000000-0000-4000-8000-000000000001',
      extra: 'drop',
    })).toEqual({ queryTopicId: '30000000-0000-4000-8000-000000000001' });
    expect(newGeoObservationSearchSchema.safeParse({ queryTopicId: 'bad-id' }).success)
      .toBe(false);
  });

  it('新候选保持未选择，刷新只保留仍有效文章的显式事实', () => {
    const initial = syncArticleResults(candidates, []);
    expect(initial.map(({ discovered, mentioned }) => ({ discovered, mentioned }))).toEqual([
      { discovered: null, mentioned: null },
      { discovered: null, mentioned: null },
    ]);

    const refreshed = syncArticleResults([candidates[1]!], [{
      ...initial[1]!,
      discovered: true,
      mentioned: false,
      accuracy: 'PARTIAL',
    }]);
    expect(refreshed).toEqual([{
      published_article_id: candidates[1]!.published_article_id,
      discovered: true,
      mentioned: false,
      accuracy: 'PARTIAL',
    }]);
  });

  it('校验全部独立事实并只生成当前人工合同字段', () => {
    const values = {
      ...emptyGeoObservationValues(),
      product_id: '20000000-0000-4000-8000-000000000001',
      query_topic_id: '30000000-0000-4000-8000-000000000001',
      search_platform: '  DeepSeek  ',
      search_query: '  射频前端如何选型？  ',
      tested_at: '2026-08-12T16:30',
      article_results: [{
        published_article_id: candidates[0]!.published_article_id,
        discovered: true,
        mentioned: false,
        accuracy: null,
      }],
    };
    expect(newGeoObservationFormSchema.safeParse({
      ...values,
      article_results: [{ ...values.article_results[0], discovered: null }],
    }).success).toBe(false);
    expect(toGeoObservationCreate(values)).toMatchObject({
      search_platform: 'DeepSeek',
      search_query: '射频前端如何选型？',
      article_results: [{ discovered: true, mentioned: false, accuracy: null }],
      attachment_file_ids: [],
      notes: '',
    });
    expect(toGeoObservationCreate(values)).not.toHaveProperty('supersedes_id');
    expect(toGeoObservationCreate(values)).not.toHaveProperty('recommendation');
    expect(toGeoObservationCreate(values)).not.toHaveProperty('citation');
  });

  it('只定位批准字段与逐篇事实，未知 issue 保留在摘要', () => {
    const mapped = mapGeoObservationCreateError(new GeoRequestError(
      '请求失败',
      422,
      {
        code: 'VALIDATION_ERROR',
        message: '请求字段无效',
        request_id: 'req-geo-create',
        details: {
          errors: [
            { loc: ['body', 'search_platform'], msg: '平台无效', type: 'value_error' },
            { loc: ['body', 'article_results', 1, 'mentioned'], msg: '请选择是否提及', type: 'value_error' },
            { loc: ['body', 'supersedes_id'], msg: '不应提交', type: 'value_error' },
          ],
        },
      },
    ));

    expect(mapped.fields).toEqual({
      search_platform: '平台无效',
      'article_results.1.mentioned': '请选择是否提及',
    });
    expect(mapped.formMessage).toBe('请求字段无效');
    expect(mapped.requestId).toBe('req-geo-create');
  });
});
