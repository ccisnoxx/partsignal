import { describe, expect, it } from 'vitest';

import { ProductRequestError } from './product.api';
import {
  formatProductRate,
  mapProductUpdateError,
  productActivityTargetHref,
  productToUpdateValues,
  productUpdateFormSchema,
  toProductUpdate,
  type ProductDetail,
} from './product-detail.model';

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  part_number: 'PS-001',
  brand: 'PartSignal',
  category: 'MCU',
  status: 'ACTIVE',
  workflow_stage: 'FACT_APPROVED',
  primary_task: 'CREATE_CONTENT_TASK',
  available_actions: ['UPDATE'],
  deletion: null,
  revision: 4,
  created_at: '2026-08-08T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
} satisfies ProductDetail['product'];

describe('Product Detail model', () => {
  it('使用 generated ProductUpdate 和 canonical revision 映射短表单', () => {
    const values = productUpdateFormSchema.parse({
      ...productToUpdateValues(product),
      part_number: '  PS-002  ',
    });
    expect(toProductUpdate(values, product.revision)).toEqual({
      expected_revision: 4,
      part_number: 'PS-002',
      brand: 'PartSignal',
      category: 'MCU',
      status: 'ACTIVE',
    });
  });

  it('按结构化字段错误映射，并只对 revision/immutable 刷新 canonical detail', () => {
    const conflict = mapProductUpdateError(new ProductRequestError(
      '产品已被其他请求修改',
      409,
      {
        code: 'REVISION_CONFLICT',
        message: '产品已被其他请求修改',
        details: {},
        request_id: 'req-conflict',
      },
    ));
    expect(conflict).toMatchObject({
      refreshCanonical: true,
      formMessage: '产品已被其他请求修改',
      requestId: 'req-conflict',
    });
    expect(mapProductUpdateError(new ProductRequestError(
      '产品已有批准事实版本，型号、品牌和分类不能原地修改',
      409,
      {
        code: 'IMMUTABLE_VERSION',
        message: '产品已有批准事实版本，型号、品牌和分类不能原地修改',
        details: {},
        request_id: 'req-immutable',
      },
    ))).toMatchObject({
      refreshCanonical: true,
      formMessage: '产品已有批准事实版本，型号、品牌和分类不能原地修改',
      requestId: 'req-immutable',
    });

    const duplicate = mapProductUpdateError(new ProductRequestError(
      '品牌与产品型号组合已存在',
      409,
      {
        code: 'PRODUCT_ALREADY_EXISTS',
        message: '品牌与产品型号组合已存在',
        details: {
          errors: [{ loc: ['body', 'brand'], msg: '品牌重复', type: 'duplicate' }],
        },
        request_id: 'req-duplicate',
      },
    ));
    expect(duplicate).toMatchObject({
      refreshCanonical: false,
      fields: { brand: '品牌重复' },
      requestId: 'req-duplicate',
    });
  });

  it('保持 null rate 与 typed Activity target 的明确映射', () => {
    expect(formatProductRate(null)).toBe('暂无');
    expect(formatProductRate(0.625)).toBe('62.5%');
    expect(productActivityTargetHref(product.id, {
      kind: 'FACT_VERSION',
      id: '00000000-0000-4000-8000-000000000002',
      label: '事实版本',
    })).toBe(`/products/${product.id}/facts/versions/00000000-0000-4000-8000-000000000002`);
    expect(() => productActivityTargetHref(product.id, {
      kind: 'UNKNOWN' as never,
      id: product.id,
      label: '未知',
    })).toThrow('未处理的合同 token');
  });
});
