import { TableShell } from '@/design-system/data-table/table-shell';
import { allRuleFields, ruleConfigurationSchema, ruleLabels, sampleLevelLabels, type GeoRulePreview } from './geo-rules.model';

function GeoRulesPreview({ preview }: { preview: GeoRulePreview }) {
  const configuration = ruleConfigurationSchema.parse(preview.snapshot.configuration);
  return <section aria-label="服务端规则预览结果" className="min-w-0 space-y-4">
    <h2 className="type-section-title">配置与样本资格预览</h2>
    <p className="text-sm text-text-secondary">基线 revision {preview.baseline_revision} · 拟采用 revision {preview.proposed_revision} · {preview.changed ? '配置有变化' : '配置无变化'}。仅验证配置和样本门槛，不生成机会、不预测触发结果、不自动解决机会。</p>
    <p className="text-sm">当前窗口：{sampleLevelLabels[preview.current_sample_level]}；前期窗口：{sampleLevelLabels[preview.previous_sample_level]}</p>
    <TableShell regionLabel="十项规则样本资格" className="w-full">
      <thead><tr><th scope="col">规则</th><th scope="col">当前最低样本</th><th scope="col">前期最低样本</th><th scope="col">样本资格</th><th scope="col">数值门槛</th></tr></thead>
        <tbody>{preview.sample_gates.map((gate) => <tr key={gate.rule_code}><th scope="row">{ruleLabels[gate.rule_code]}</th><td>{gate.current_minimum}</td><td>{gate.previous_minimum}</td><td>{gate.sample_sufficient ? '样本充足' : '样本不足'}</td><td>{gate.threshold_configured ? '已配置' : '未配置'}</td></tr>)}</tbody>
    </TableShell>
    <details className="rounded-lg border border-border-subtle p-3">
      <summary className="cursor-pointer font-medium">查看本次完整规则快照（revision {preview.snapshot.rule_set_revision}）</summary>
      <dl className="mt-3 grid min-w-0 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
        {allRuleFields.map((field) => {
          const [root, child] = field.name.split('.');
          const value = child ? (configuration[root as 'sample_policy' | 'recovery'] as unknown as Record<string, unknown>)[child] : configuration[root as keyof typeof configuration];
          return <div className="min-w-0" key={field.name}><dt className="text-text-secondary">{field.label}</dt><dd>{value === null ? '未配置' : String(value)}{value !== null && field.unit === 'days' ? ' 天' : ''}</dd></div>;
        })}
        <div><dt className="text-text-secondary">严格可比条件</dt><dd>必须满足（true）</dd></div>
        <div><dt className="text-text-secondary">人工确认</dt><dd>必须完成（true）</dd></div>
        <div><dt className="text-text-secondary">同类事实错误最大次数</dt><dd>{configuration.recovery.fact_error_max_count}</dd></div>
        <div><dt className="text-text-secondary">快照 schema 版本</dt><dd>{preview.snapshot.schema_version}</dd></div>
      </dl>
    </details>
  </section>;
}
export { GeoRulesPreview };
