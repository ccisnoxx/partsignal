import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';
import { productIdentityField } from './product.model';

type ProductCreate = components['schemas']['ProductCreate'];

const newProductFormSchema = z.object({
  part_number: productIdentityField('产品型号'),
  brand: productIdentityField('品牌'),
  category: productIdentityField('类别'),
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
