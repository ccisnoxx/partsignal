import { describe, expect, it } from 'vitest';

import { ProductCreateRequestError, mapProductCreateError } from './new-product.api';
import { newProductFormSchema, toProductCreate } from './new-product.model';

describe('newProductFormSchema', () => {
  it('trim 三个字段并映射为 generated ProductCreate', () => {
    const values = newProductFormSchema.parse({
      part_number: '  PS-001 ',
      brand: ' PartSignal  ',
      category: ' MCU ',
    });

    expect(toProductCreate(values)).toEqual({
      part_number: 'PS-001',
      brand: 'PartSignal',
      category: 'MCU',
    });
  });

  it.each(['part_number', 'brand', 'category'] as const)('拒绝 %s 的纯空白与超长输入', (field) => {
    const valid = { part_number: 'PS-001', brand: 'PartSignal', category: 'MCU' };
    expect(newProductFormSchema.safeParse({ ...valid, [field]: '   ' }).success).toBe(false);
    expect(newProductFormSchema.safeParse({ ...valid, [field]: 'x'.repeat(161) }).success).toBe(false);
  });
});

describe('mapProductCreateError', () => {
  it('只按结构化 loc 映射批准字段并保留 request_id', () => {
    const mapped = mapProductCreateError(new ProductCreateRequestError(
      '品牌与产品型号组合已存在',
      {
        code: 'PRODUCT_ALREADY_EXISTS',
        message: '品牌与产品型号组合已存在',
        details: {
          errors: [
            { loc: ['body', 'part_number'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
            { loc: ['body', 'brand'], msg: '品牌与产品型号组合已存在', type: 'product_already_exists' },
          ],
        },
        request_id: 'req-duplicate',
      },
    ));

    expect(mapped).toEqual({
      fields: {
        part_number: '品牌与产品型号组合已存在',
        brand: '品牌与产品型号组合已存在',
      },
      formMessage: undefined,
      requestId: 'req-duplicate',
    });
  });

  it('无法定位的错误进入 form summary，不解析 message', () => {
    const mapped = mapProductCreateError(new ProductCreateRequestError(
      '没有创建产品的权限',
      {
        code: 'PERMISSION_DENIED',
        message: '没有创建产品的权限',
        details: {},
        request_id: 'req-forbidden',
      },
    ));

    expect(mapped).toEqual({
      fields: {},
      formMessage: '没有创建产品的权限',
      requestId: 'req-forbidden',
    });
  });
});
