import { describe, expect, it } from 'vitest';
import { profileCreate, profileFormSchema, profileUpdate, surfaceFormSchema } from './surfaces-form.model';

const profile = { engine_surface_id: '10000000-0000-4000-8000-000000000001', name: '人工配置', collection_mode: 'MANUAL', adapter_key: 'manual', language_code: 'zh-CN', region_code: 'CN', web_search_policy: 'UNKNOWN', login_state: 'ANONYMOUS', ai_channel_id: '', ai_model_id: '', require_screenshot: true, max_concurrency: '1', requests_per_minute: '60', temperature: '', max_output_tokens: '', answer_timeout_seconds: '120' };
describe('GEO 配置的非敏感表单', () => {
  it('人工和浏览器模式不接受模型绑定；人工适配器固定', () => {
    expect(profileFormSchema.safeParse(profile).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...profile, adapter_key: 'unknown' }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...profile, ai_model_id: profile.engine_surface_id }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...profile, collection_mode: 'BROWSER', adapter_key: 'browser-explicit', answer_timeout_seconds: '9' }).success).toBe(false);
  });
  it('API 要求成对合法 UUID，明确的适配器和有界设置', () => {
    const api = { ...profile, collection_mode: 'API', adapter_key: 'explicit_api', login_state: 'NOT_APPLICABLE' };
    expect(profileFormSchema.safeParse(api).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...api, ai_channel_id: profile.engine_surface_id }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...api, ai_channel_id: 'broken', ai_model_id: 'broken' }).success).toBe(false);
    for (const patch of [{ max_concurrency: '0' }, { max_concurrency: '101' }, { requests_per_minute: '' }, { requests_per_minute: '1.5' }, { requests_per_minute: '60001' }]) expect(profileFormSchema.safeParse({ ...api, ...patch }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...api, temperature: '2.1' }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...api, max_output_tokens: '1.5' }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...api, ai_channel_id: profile.engine_surface_id, ai_model_id: profile.engine_surface_id, temperature: '0', max_output_tokens: '65536' }).success).toBe(true);
  });
  it('公开网站拒绝认证、query 和 fragment；空网址保持合法', () => {
    const surface = { name: '观测面', slug: 'public-surface', surface_kind: 'MANUAL_SITE', provider_brand: 'CUSTOM', compliance_status: 'NOT_REVIEWED', website_url: '', citations: false, web_search_signal: false, model_version: false, usage: false, cost: false };
    expect(surfaceFormSchema.safeParse(surface).success).toBe(true);
    for (const website_url of ['https://user:pass@example.test/', 'https://example.test/?token=x', 'https://example.test/#fragment', 'ftp://example.test/']) expect(surfaceFormSchema.safeParse({ ...surface, website_url }).success).toBe(false);
  });
  it('三模式只提交所属模式的闭合 settings；PATCH 不改所属，也不提交测试或启用事实', () => {
    const manual = profileCreate(profileFormSchema.parse({ ...profile, temperature: '1', max_output_tokens: '10' }));
    expect(manual.settings).toEqual({ require_screenshot: true });
    const browser = profileCreate(profileFormSchema.parse({ ...profile, collection_mode: 'BROWSER', adapter_key: 'explicit_browser', require_screenshot: false, answer_timeout_seconds: '600', temperature: '1' }));
    expect(browser).toMatchObject({ collection_mode: 'BROWSER', ai_channel_id: null, ai_model_id: null, settings: { require_screenshot: false, answer_timeout_seconds: 600 } });
    const api = profileUpdate(profileFormSchema.parse({ ...profile, collection_mode: 'API', adapter_key: 'explicit_api', login_state: 'NOT_APPLICABLE', ai_channel_id: 'A0000000-0000-4000-8000-000000000001', ai_model_id: 'A0000000-0000-4000-8000-000000000002', max_concurrency: '5', requests_per_minute: '120', temperature: '0', max_output_tokens: '65536' }), 9);
    expect(api).toMatchObject({ collection_mode: 'API', expected_revision: 9, language_code: 'zh-cn', ai_channel_id: 'a0000000-0000-4000-8000-000000000001', ai_model_id: 'a0000000-0000-4000-8000-000000000002', settings: { max_concurrency: 5, requests_per_minute: 120, temperature: 0, max_output_tokens: 65536 } });
    expect(api).not.toHaveProperty('engine_surface_id');
    expect(api).not.toHaveProperty('is_active');
    expect(api).not.toHaveProperty('last_test_status');
  });
});
