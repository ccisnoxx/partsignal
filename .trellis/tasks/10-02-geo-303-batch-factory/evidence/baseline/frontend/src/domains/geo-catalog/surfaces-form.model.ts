import { z } from 'zod';
import type { components } from '@/shared/api/generated/schema';
import type { Profile, Surface } from './surfaces.model';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';

const surfaceKinds = ['CONSUMER_UI', 'MODEL_API', 'SEARCH_API', 'MANUAL_SITE'] as const;
const providerBrands = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE_OPENAI', 'ZHIPU', 'QWEN', 'CUSTOM'] as const;
const complianceStatuses = ['NOT_REVIEWED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const modes = ['MANUAL', 'API', 'BROWSER'] as const;
const webPolicies = ['UNKNOWN', 'REQUESTED', 'REQUIRED', 'NOT_APPLICABLE'] as const;
const name = z.string().trim().min(1, '请填写名称').max(160, '名称不能超过 160 字符').refine((value) => !value.includes('\0'), '名称不能含 NUL');
const optionalUuid = z.union([z.literal(''), canonicalUuidSchema]);
const surfaceFormSchema = z.object({
  name,
  slug: z.string().trim().min(1, '请填写标识').max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, '标识须以小写字母开头，只使用小写字母、数字和连字符'),
  surface_kind: z.enum(surfaceKinds), provider_brand: z.enum(providerBrands), compliance_status: z.enum(complianceStatuses),
  website_url: z.string().trim().max(2083).refine((value) => {
    if (!value) return true;
    if (!/^https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/.test(value)) return false;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/[?#]/.test(value); } catch { return false; }
  }, '网站须为公开 HTTP(S) 地址，不含认证信息、查询参数或片段'),
  citations: z.boolean(), web_search_signal: z.boolean(), model_version: z.boolean(), usage: z.boolean(), cost: z.boolean(),
});
const profileFormSchema = z.object({
  engine_surface_id: canonicalUuidSchema,
  name, collection_mode: z.enum(modes), adapter_key: z.string(),
  language_code: z.string().trim().min(2).max(16).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, '请填写合法语言标签，例如 zh-CN'),
  region_code: z.string().trim().regex(/^[A-Za-z]{2}$/, '地区须为两个字母，例如 CN'),
  web_search_policy: z.enum(webPolicies), login_state: z.enum(['ANONYMOUS', 'AUTHENTICATED', 'NOT_APPLICABLE']),
  ai_channel_id: z.string(), ai_model_id: z.string(), require_screenshot: z.boolean(),
  temperature: z.string(), max_output_tokens: z.string(), answer_timeout_seconds: z.string(),
}).superRefine((values, ctx) => {
  function error(path: string, message: string) { ctx.addIssue({ code: 'custom', path: [path], message }); }
  if (values.collection_mode === 'MANUAL' && values.adapter_key !== 'manual') error('adapter_key', '人工模式的适配器固定为 manual');
  if (values.collection_mode !== 'MANUAL' && !/^[a-z][a-z0-9_-]{0,99}$/.test(values.adapter_key)) error('adapter_key', '请填写明确的适配器标识；须以小写字母开头');
  if (values.collection_mode === 'API') {
    if (values.login_state !== 'NOT_APPLICABLE') error('login_state', 'API 模式登录状态须为不适用');
    for (const field of ['ai_channel_id', 'ai_model_id'] as const) if (!optionalUuid.safeParse(values[field].trim()).success) error(field, '请填写合法 UUID，或同时留空');
    if (Boolean(values.ai_channel_id.trim()) !== Boolean(values.ai_model_id.trim())) error('ai_model_id', '渠道和模型 UUID 必须同时填写或同时留空');
    if (values.temperature.trim() && (!Number.isFinite(Number(values.temperature)) || Number(values.temperature) < 0 || Number(values.temperature) > 2)) error('temperature', '温度须为 0 到 2，或留空');
    if (values.max_output_tokens.trim() && (!Number.isInteger(Number(values.max_output_tokens)) || Number(values.max_output_tokens) < 1 || Number(values.max_output_tokens) > 65536)) error('max_output_tokens', '输出 token 上限须为 1 到 65536 的整数，或留空');
  } else {
    if (values.login_state === 'NOT_APPLICABLE') error('login_state', '请选择匿名或已登录');
    if (values.ai_channel_id || values.ai_model_id) error('ai_model_id', '人工与浏览器模式不能绑定 API 模型');
  }
  if (values.collection_mode === 'BROWSER' && (!Number.isInteger(Number(values.answer_timeout_seconds)) || Number(values.answer_timeout_seconds) < 10 || Number(values.answer_timeout_seconds) > 600)) error('answer_timeout_seconds', '回答超时须为 10 到 600 秒的整数');
});

type SurfaceValues = z.infer<typeof surfaceFormSchema>;
type ProfileValues = z.infer<typeof profileFormSchema>;
function surfaceValues(surface?: Surface): SurfaceValues {
  if (surface && !surface.configuration) throw new Error('该观测面没有可编辑配置');
  const config = surface?.configuration;
  return { name: config?.name ?? '', slug: config?.slug ?? '', surface_kind: config?.surface_kind ?? 'MANUAL_SITE', provider_brand: config?.provider_brand ?? 'CUSTOM', compliance_status: config?.compliance_status ?? 'NOT_REVIEWED', website_url: config?.website_url ?? '', citations: config?.capabilities.citations ?? false, web_search_signal: config?.capabilities.web_search_signal ?? false, model_version: config?.capabilities.model_version ?? false, usage: config?.capabilities.usage ?? false, cost: config?.capabilities.cost ?? false };
}
function surfaceCreate(values: SurfaceValues): components['schemas']['GeoEngineSurfaceCreate'] {
  const { name, slug, surface_kind, provider_brand, website_url, compliance_status, ...capabilities } = values;
  return { name, slug, surface_kind, provider_brand, website_url: website_url || null, compliance_status, capabilities: { answer_text: true, ...capabilities } };
}
function surfaceUpdate(values: SurfaceValues, revision: number): components['schemas']['GeoEngineSurfaceUpdate'] { return { ...surfaceCreate(values), expected_revision: revision }; }
function profileValues(profile?: Profile, surfaceId = ''): ProfileValues {
  if (profile && !profile.configuration) throw new Error('该采集配置没有可编辑配置');
  const config = profile?.configuration;
  return { engine_surface_id: config?.engine_surface_id ?? surfaceId, name: config?.name ?? '', collection_mode: config?.collection_mode ?? 'MANUAL', adapter_key: config?.adapter_key ?? 'manual', language_code: config?.language_code ?? 'zh-CN', region_code: config?.region_code ?? 'CN', web_search_policy: config?.web_search_policy ?? 'UNKNOWN', login_state: config?.login_state ?? 'ANONYMOUS', ai_channel_id: config?.ai_channel_id ?? '', ai_model_id: config?.ai_model_id ?? '', require_screenshot: config && config.collection_mode !== 'API' ? config.settings.require_screenshot : true, temperature: config?.collection_mode === 'API' && config.settings.temperature !== null ? String(config.settings.temperature) : '', max_output_tokens: config?.collection_mode === 'API' && config.settings.max_output_tokens !== null ? String(config.settings.max_output_tokens) : '', answer_timeout_seconds: config?.collection_mode === 'BROWSER' ? String(config.settings.answer_timeout_seconds) : '120' };
}
function profileCreate(values: ProfileValues): components['schemas']['GeoCollectionProfileCreate'] {
  const common = { engine_surface_id: canonicalUuidSchema.parse(values.engine_surface_id), name: values.name, adapter_key: values.adapter_key, language_code: values.language_code.toLowerCase(), region_code: values.region_code.toUpperCase(), web_search_policy: values.web_search_policy };
  switch (values.collection_mode) {
    case 'MANUAL': return { ...common, collection_mode: 'MANUAL', adapter_key: 'manual', ai_channel_id: null, ai_model_id: null, login_state: values.login_state === 'AUTHENTICATED' ? 'AUTHENTICATED' : 'ANONYMOUS', settings: { require_screenshot: values.require_screenshot } };
    case 'BROWSER': return { ...common, collection_mode: 'BROWSER', ai_channel_id: null, ai_model_id: null, login_state: values.login_state === 'AUTHENTICATED' ? 'AUTHENTICATED' : 'ANONYMOUS', settings: { require_screenshot: values.require_screenshot, answer_timeout_seconds: Number(values.answer_timeout_seconds) } };
    case 'API': {
      const binding = values.ai_channel_id.trim() && values.ai_model_id.trim() ? { ai_channel_id: canonicalUuidSchema.parse(values.ai_channel_id.trim()), ai_model_id: canonicalUuidSchema.parse(values.ai_model_id.trim()) } : { ai_channel_id: null, ai_model_id: null };
      return { ...common, ...binding, collection_mode: 'API', login_state: 'NOT_APPLICABLE', settings: { temperature: values.temperature.trim() ? Number(values.temperature) : null, max_output_tokens: values.max_output_tokens.trim() ? Number(values.max_output_tokens) : null } };
    }
  }
}
function profileUpdate(values: ProfileValues, revision: number): components['schemas']['GeoCollectionProfileUpdate'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- PATCH 必须剔除不可变所属观测面。
  const { engine_surface_id: _surfaceId, ...configuration } = profileCreate(values);
  return { ...configuration, expected_revision: revision };
}
export { surfaceValues, surfaceCreate, surfaceUpdate, profileValues, profileCreate, profileUpdate, surfaceFormSchema, profileFormSchema, surfaceKinds, providerBrands, complianceStatuses, modes, webPolicies };
export type { SurfaceValues, ProfileValues };
