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
  it('只映射权威三字段 ContentTaskCreate', () => {
    const values = newContentTaskFormSchema.parse({
      product_id: productId,
      fact_version_id: factVersionId,
      platform_profile_id: platformProfileId,
    });
    expect(toContentTaskCreate(values)).toEqual({
      product_id: productId,
      fact_version_id: factVersionId,
      platform_profile_id: platformProfileId,
    });
    expect(Object.keys(toContentTaskCreate(values))).toHaveLength(3);
  });

  it.each(['product_id', 'fact_version_id', 'platform_profile_id'] as const)(
    '拒绝缺失的 %s',
    (field) => {
      const values = {
        product_id: productId,
        fact_version_id: factVersionId,
        platform_profile_id: platformProfileId,
        [field]: '',
      };
      expect(newContentTaskFormSchema.safeParse(values).success).toBe(false);
    },
  );
});

describe('mapContentTaskCreateError', () => {
  it('只按三字段 loc 定位错误，并保留 code 与 request_id', () => {
    const mapped = mapContentTaskCreateError(new ContentRequestError(
      '请求数据不符合接口契约',
      422,
      {
        code: 'VALIDATION_ERROR',
        message: '请求数据不符合接口契约',
        details: {
          errors: [
            { loc: ['body', 'fact_version_id'], msg: '事实版本无效', type: 'value_error' },
          ],
        },
        request_id: 'req-validation',
      },
    ));

    expect(mapped).toEqual({
      fields: { fact_version_id: '事实版本无效' },
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
