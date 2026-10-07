import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';

const name = z.string().trim().min(1, '请输入非空名称').max(240, '名称不能超过 240 个字符');
const optionalId = z.union([z.literal(''), z.uuid('请选择有效对象')]);
const subjectFormSchema = z.object({
  subject_type: z.enum(['OWN_BRAND', 'OWN_PRODUCT', 'COMPETITOR_BRAND', 'COMPETITOR_PRODUCT', 'REFERENCE_PART']),
  product_id: optionalId,
  canonical_name: z.string(), display_name: z.string(), parent_subject_id: optionalId,
  description: z.string().max(4000, '监测说明不能超过 4000 个字符'),
}).superRefine((value, context) => {
  if (value.subject_type === 'OWN_PRODUCT') {
    if (!value.product_id) context.addIssue({ code: 'custom', path: ['product_id'], message: '请选择现有产品' });
  } else {
    for (const field of ['canonical_name', 'display_name'] as const) {
      const result = name.safeParse(value[field]);
      if (!result.success) context.addIssue({ code: 'custom', path: [field], message: result.error.issues[0]?.message ?? '名称无效' });
    }
  }
});
const aliasFormSchema = z.object({
  alias: name,
  alias_kind: z.enum(['NAME', 'PART_NUMBER', 'ABBREVIATION', 'LEGACY']),
  language_code: z.string().refine((value) => value === '' || /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value) && value.length <= 16, '请输入有效语言标签，如 zh-CN，或留空'),
  is_active: z.enum(['true', 'false']),
});
const domainFormSchema = z.object({
  hostname: z.string().min(3, '请输入域名').max(253, '域名不能超过 253 个字符').regex(/^[^\s/:@?#*\\]+$/, '只填写主机名，不含协议、路径、端口或通配符'),
  relation_type: z.enum(['OWNED', 'OFFICIAL', 'DISTRIBUTOR', 'OTHER']),
});
type SubjectValues = z.infer<typeof subjectFormSchema>;
type AliasValues = z.infer<typeof aliasFormSchema>;
type DomainValues = z.infer<typeof domainFormSchema>;
type Subject = components['schemas']['GeoSubjectOut'];
function subjectValues(subject?: Subject): SubjectValues {
  return {
    subject_type: subject?.subject_type ?? 'OWN_PRODUCT', product_id: subject?.product_id ?? '',
    canonical_name: subject?.canonical_name ?? '', display_name: subject?.display_name ?? '',
    parent_subject_id: subject?.parent_subject_id ?? '', description: subject?.description ?? '',
  };
}
function subjectCreate(values: SubjectValues): components['schemas']['GeoSubjectCreate'] {
  const shared = { parent_subject_id: values.parent_subject_id || null, description: values.description };
  return values.subject_type === 'OWN_PRODUCT'
    ? { ...shared, subject_type: values.subject_type, product_id: values.product_id }
    : { ...shared, subject_type: values.subject_type, canonical_name: values.canonical_name.trim(), display_name: values.display_name.trim() };
}
function subjectUpdate(values: SubjectValues, revision: number): components['schemas']['GeoSubjectUpdate'] {
  const shared = { subject_type: values.subject_type, expected_revision: revision, parent_subject_id: values.parent_subject_id || null, description: values.description };
  return values.subject_type === 'OWN_PRODUCT'
    ? { ...shared, subject_type: 'OWN_PRODUCT' }
    : { ...shared, subject_type: values.subject_type, canonical_name: values.canonical_name.trim(), display_name: values.display_name.trim() };
}
export { subjectFormSchema, aliasFormSchema, domainFormSchema, subjectValues, subjectCreate, subjectUpdate };
export type { SubjectValues, AliasValues, DomainValues };
