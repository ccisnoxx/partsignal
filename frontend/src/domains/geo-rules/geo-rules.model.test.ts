import { describe, expect, it } from 'vitest';
import { parseGeoRulePreview, parseGeoRuleSet, ruleConfigurationSchema } from './geo-rules.model';
import { configuration, previewResult, ruleSet } from './geo-rules.test-support';

describe('GEO 规则输入与读取边界', () => {
  it('null 保持未配置，0 是有效比例；严格可比和人工确认不可关闭', () => {
    expect(ruleConfigurationSchema.parse({ ...configuration(), data_quality_minimum_success_rate: 0 }).data_quality_minimum_success_rate).toBe(0);
    expect(ruleConfigurationSchema.parse(configuration()).run_failure_consecutive_limit).toBeNull();
    const invalid = { ...configuration(), recovery: { ...configuration().recovery, manual_confirmation_required: false } };
    expect(ruleConfigurationSchema.safeParse(invalid).success).toBe(false);
  });
  it('缺失配置字段、缺失硬性恢复条件和未知动作都显式失败，不补默认值', () => {
    const incomplete = { ...configuration() }; delete (incomplete as { data_quality_minimum_success_rate?: number | null }).data_quality_minimum_success_rate;
    expect(() => parseGeoRuleSet(ruleSet({ configuration: incomplete }))).toThrow('响应不完整');
    expect(() => parseGeoRuleSet({ ...ruleSet(), configuration: { ...configuration(), recovery: { minimum_runs: 5 } } })).toThrow('响应不完整');
    expect(() => parseGeoRuleSet({ ...ruleSet(), available_actions: ['EVALUATE'] })).toThrow('响应不完整');
  });
  it('preview 只接受配置和样本范围及已知规则，不接收机会结果替代合同', () => {
    expect(() => parseGeoRulePreview({ ...previewResult(), preview_scope: 'OPPORTUNITY_RESULTS' })).toThrow('响应不完整');
    expect(() => parseGeoRulePreview({ ...previewResult(), sample_gates: [{ ...previewResult().sample_gates[0], rule_code: 'UNKNOWN' }] })).toThrow('响应不完整');
  });
});
