/** R4 的虚构前置配置；采集提交与复核通过真实页面完成。 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { components } from '../../src/shared/api/generated/schema';
import { api, body } from './geo-api-support';

type Schema = components['schemas'];
export async function reviewConfiguration(page: Page, csrfToken: string) {
  const suffix = randomUUID().slice(0, 8);
  const partNumber = `GEOR4-${suffix}`;
  const headers = { 'X-CSRF-Token': csrfToken };
  const product = await body<Schema['Product']>(await page.request.post(`${api}/api/v1/products`, {
    headers, data: { part_number: partNumber, brand: '虚构金标品牌', category: '虚构器件' } satisfies Schema['ProductCreate'],
  }), 201);
  const draft = await body<Schema['ProductFactsDraft']>(await page.request.get(`${api}/api/v1/products/${product.id}/facts`));
  const saved = await body<Schema['ProductFactsDraft']>(await page.request.put(`${api}/api/v1/products/${product.id}/facts`, {
    headers, data: { expected_revision: draft.revision, body_markdown: '供电电压为 3.3 V。', classification: 'PUBLIC' } satisfies Schema['ProductFactsDraftUpdate'],
  }));
  const fact = await body<Schema['FactVersion']>(await page.request.post(`${api}/api/v1/products/${product.id}/fact-review-submissions`, {
    headers, data: { expected_revision: saved.revision, change_summary: 'GEO-508 虚构前置批准事实' } satisfies Schema['FactReviewSubmissionRequest'],
  }), 201);
  await body<Schema['FactVersion']>(await page.request.post(`${api}/api/v1/fact-versions/${fact.id}/approve`, {
    headers, data: { expected_revision: fact.revision, comment: '批准本地虚构核验依据' } satisfies Schema['CommandRequest'],
  }));
  const subject = await body<Schema['GeoSubjectOut']>(await page.request.post(`${api}/api/v1/geo/subjects`, {
    headers, data: { subject_type: 'OWN_PRODUCT', product_id: product.id, parent_subject_id: null, description: '' } satisfies Schema['GeoOwnProductSubjectCreate'],
  }), 201);
  const surface = await body<Schema['GeoEngineSurfaceRead']>(await page.request.post(`${api}/api/v1/geo/engine-surfaces`, {
    headers, data: {
      name: `GEO508 ${suffix}`, slug: `geo508-${suffix}`, surface_kind: 'CONSUMER_UI', provider_brand: 'CUSTOM', website_url: null, compliance_status: 'APPROVED',
      capabilities: { answer_text: true, citations: true, web_search_signal: true, model_version: false, usage: false, cost: false },
    } satisfies Schema['GeoEngineSurfaceCreate'],
  }), 201);
  await body(await page.request.post(`${api}/api/v1/geo/engine-surfaces/${surface.summary.id}/enable`, {
    headers, data: { expected_revision: surface.summary.revision },
  }));
  const profile = await body<Schema['GeoCollectionProfileRead']>(await page.request.post(`${api}/api/v1/geo/collection-profiles`, {
    headers, data: {
      name: `GEO508 人工 ${suffix}`, engine_surface_id: surface.summary.id, collection_mode: 'MANUAL', adapter_key: 'manual',
      language_code: 'zh-CN', region_code: 'CN', ai_channel_id: null, ai_model_id: null, login_state: 'ANONYMOUS', web_search_policy: 'UNKNOWN', settings: { require_screenshot: false },
    } satisfies Schema['GeoManualProfileCreate'],
  }), 201);
  await body(await page.request.post(`${api}/api/v1/geo/collection-profiles/${profile.summary.id}/enable`, {
    headers, data: { expected_revision: profile.summary.revision },
  }));
  const topic = await body<Schema['QueryTopic']>(await page.request.post(`${api}/api/v1/query-topics`, {
    headers, data: { canonical_question: `GEO508 参数核验 ${suffix}`, intent_type: 'PRODUCT', variants: [`核验${partNumber}供电参数`] },
  }), 201);
  const promptName = `请核验 ${partNumber} 的供电电压`;
  const prompt = await body<Schema['GeoPromptVariantOut']>(await page.request.post(`${api}/api/v1/geo/query-topics/${topic.id}/prompt-variants`, {
    headers, data: { query_topic_id: topic.id, prompt_text: promptName, mention_mode: 'BRANDED', priority: 'CORE', language_code: 'zh-CN', region_code: 'CN' } satisfies Schema['GeoPromptVariantCreate'],
  }), 201);
  const planName = `GEO508 复核 ${suffix}`;
  const plan = await body<Schema['GeoMonitoringPlanDetail']>(await page.request.post(`${api}/api/v1/geo/monitoring-plans`, {
    headers, data: {
      name: planName, description: '', subjects: [{ subject_id: subject.id, role: 'PRIMARY' }], prompt_variant_ids: [prompt.id], collection_profile_ids: [profile.summary.id],
      repeat_count: 1, schedule_kind: 'MANUAL_ONLY', timezone: 'Asia/Shanghai', cron_expression: null, budget_limit: null, rule_set_revision: 1,
    } satisfies Schema['GeoMonitoringPlanCreate'],
  }), 201);
  return { plan, planName, promptName, partNumber, factId: fact.id };
}
