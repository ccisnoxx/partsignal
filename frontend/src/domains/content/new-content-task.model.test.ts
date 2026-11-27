import { describe, expect, it } from 'vitest';

import { ContentRequestError, mapContentTaskCreateError } from './content.api';
import {
  newContentTaskFormSchema,
  newContentTaskSearchSchema,
  resolveProductHandoff,
  toContentTaskCreate,
} from './new-content-task.model';

const productId = '00000000-0000-4000-8000-000000000001';
const factVersionId = '00000000-0000-4000-8000-000000000002';
const platformProfileId = '00000000-0000-4000-8000-000000000003';
const topicId = '00000000-0000-4000-8000-000000000004';
const campaignId = '00000000-0000-4000-8000-000000000005';

const validValues = {
  campaign_id: campaignId,
  product_id: productId,
  fact_version_id: factVersionId,
  platform_profile_id: platformProfileId,
  query_topic_id: topicId,
  target_question: 'TPS5430 有哪些国产替代型号？',
  search_intent: 'REPLACEMENT' as const,
  content_angle: '国产替代选型指南',
  target_audience: '工业电源硬件工程师',
  must_answer_questions_text: '效率对比\n封装兼容注意事项',
  required_fact_points_text: '输入电压 5.5-36V\n最大输出 3A',
  forbidden_expressions_text: '完全等效替代\n无需验证直接替换',
  content_format: '技术选型文章',
  cta: '申请样品与评估板',
  target_keywords_text: 'TPS5430, 国产替代, 降压芯片',
  success_metrics_notes: '目标提升 DeepSeek 推荐率',
};

describe('newContentTaskSearchSchema', () => {
  it('标准化合法 productId，并保留空白或非法 handoff 供页面显式报告', () => {
    expect(newContentTaskSearchSchema.parse({
      productId: '  00000000-0000-4000-8000-0000000000AA  ',
    })).toEqual({ productId: '00000000-0000-4000-8000-0000000000aa' });
    expect(resolveProductHandoff(newContentTaskSearchSchema.parse({ productId: '   ' })))
      .toEqual({ kind: 'invalid', value: '' });
    expect(resolveProductHandoff(newContentTaskSearchSchema.parse({ productId: 'missing' })))
      .toEqual({ kind: 'invalid', value: 'missing' });
    expect(resolveProductHandoff(newContentTaskSearchSchema.parse({}))).toEqual({ kind: 'none' });
  });
});

describe('newContentTaskFormSchema', () => {
  it('映射包含活动、问题主题和冻结 Brief 的 ContentTaskCreate', () => {
    const values = newContentTaskFormSchema.parse(validValues);
    expect(toContentTaskCreate(values)).toEqual({
      campaign_id: campaignId,
      product_id: productId,
      fact_version_id: factVersionId,
      platform_profile_id: platformProfileId,
      query_topic_id: topicId,
      brief: {
        target_question: 'TPS5430 有哪些国产替代型号？',
        search_intent: 'REPLACEMENT',
        content_angle: '国产替代选型指南',
        target_audience: '工业电源硬件工程师',
        must_answer_questions: ['效率对比', '封装兼容注意事项'],
        required_fact_points: ['输入电压 5.5-36V', '最大输出 3A'],
        forbidden_expressions: ['完全等效替代', '无需验证直接替换'],
        content_format: '技术选型文章',
        cta: '申请样品与评估板',
        target_keywords: ['TPS5430', '国产替代', '降压芯片'],
        success_metrics: { notes: '目标提升 DeepSeek 推荐率' },
      },
    });
  });

  it.each([
    'product_id',
    'fact_version_id',
    'platform_profile_id',
    'query_topic_id',
    'target_question',
    'content_angle',
  ] as const)(
    '拒绝缺失的 %s',
    (field) => {
      const values = { ...validValues, [field]: '' };
      expect(newContentTaskFormSchema.safeParse(values).success).toBe(false);
    },
  );
});

describe('mapContentTaskCreateError', () => {
  it('支持定位顶层与 brief 子字段错误，并保留 code 与 request_id', () => {
    const mapped = mapContentTaskCreateError(new ContentRequestError(
      '请求数据不符合接口契约',
      422,
      {
        code: 'VALIDATION_ERROR',
        message: '请求数据不符合接口契约',
        details: {
          errors: [
            { loc: ['body', 'fact_version_id'], msg: '事实版本无效', type: 'value_error' },
            { loc: ['body', 'brief', 'content_angle'], msg: '请填写内容角度', type: 'value_error' },
          ],
        },
        request_id: 'req-validation',
      },
    ));

    expect(mapped).toEqual({
      fields: { fact_version_id: '事实版本无效', content_angle: '请填写内容角度' },
      formMessage: undefined,
      requestId: 'req-validation',
      code: 'VALIDATION_ERROR',
    });
  });

  it('业务冲突进入 form summary，不解析错误文案', () => {
    const mapped = mapContentTaskCreateError(new ContentRequestError(
      '幂等键已被其他载荷使用',
      409,
      {
        code: 'IDEMPOTENCY_CONFLICT',
        message: '幂等键已被其他载荷使用',
        details: {},
        request_id: 'req-conflict',
      },
    ));
    expect(mapped).toEqual({
      fields: {},
      formMessage: '幂等键已被其他载荷使用',
      requestId: 'req-conflict',
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
});
