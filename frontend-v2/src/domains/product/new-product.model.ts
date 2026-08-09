import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';

type ProductCreate = components['schemas']['ProductCreate'];

const productField = (label: string) => z.string()
  .trim()
  .min(1, `${label}不能为空`)
  .max(160, `${label}不能超过 160 个字符`);

const newProductFormSchema = z.object({
  part_number: productField('产品型号'),
  brand: productField('品牌'),
  category: productField('类别'),
});

type NewProductFormValues = z.infer<typeof newProductFormSchema>;
type NewProductField = keyof NewProductFormValues;

function toProductCreate(values: NewProductFormValues): ProductCreate {
  return {
    part_number: values.part_number,
    brand: values.brand,
    category: values.category,
  } satisfies ProductCreate;
}

export { newProductFormSchema, toProductCreate };
export type { NewProductField, NewProductFormValues };
