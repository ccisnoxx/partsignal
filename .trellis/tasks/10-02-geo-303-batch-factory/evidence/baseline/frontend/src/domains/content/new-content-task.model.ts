import { z } from 'zod';

import type { components } from '@/shared/api/generated/schema';

type ContentTaskCreate = components['schemas']['ContentTaskCreate'];

const requiredId = (label: string) => z.string()
  .min(1, `请选择${label}`)
  .pipe(z.uuid(`请选择有效的${label}`));

const newContentTaskFormSchema = z.object({
  product_id: requiredId('产品'),
  fact_version_id: requiredId('已批准事实版本'),
  platform_profile_id: requiredId('目标平台'),
});

type NewContentTaskFormValues = z.infer<typeof newContentTaskFormSchema>;
type NewContentTaskField = keyof NewContentTaskFormValues;

function toContentTaskCreate(values: NewContentTaskFormValues): ContentTaskCreate {
  return {
    product_id: values.product_id,
    fact_version_id: values.fact_version_id,
    platform_profile_id: values.platform_profile_id,
  } satisfies ContentTaskCreate;
}

function normalizeProductId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return z.uuid().safeParse(trimmed).success ? trimmed.toLowerCase() : trimmed;
}

const newContentTaskSearchSchema = z.object({
  productId: z.preprocess(normalizeProductId, z.string().optional()),
});

type NewContentTaskSearch = z.output<typeof newContentTaskSearchSchema>;
type ProductHandoff =
  | { kind: 'none' }
  | { kind: 'invalid'; value: string }
  | { kind: 'valid'; productId: string };

function resolveProductHandoff(search: NewContentTaskSearch): ProductHandoff {
  if (search.productId === undefined) return { kind: 'none' };
  if (!z.uuid().safeParse(search.productId).success) {
    return { kind: 'invalid', value: search.productId };
  }
  return { kind: 'valid', productId: search.productId };
}

export {
  newContentTaskFormSchema,
  newContentTaskSearchSchema,
  resolveProductHandoff,
  toContentTaskCreate,
};
export type {
  NewContentTaskField,
  NewContentTaskFormValues,
  NewContentTaskSearch,
  ProductHandoff,
};
