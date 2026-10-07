import type { FieldPath } from 'react-hook-form';
import { FormField } from '@/design-system/forms/form-field';
import { FormSection } from '@/design-system/forms/form-layout';
import { Input } from '@/design-system/primitives/input';
import { dedupFields, recoveryFields, sampleFields, thresholdFields, type PreviewSamples, type RuleField, type RuleFormValues } from './geo-rules.model';

function RuleNumberField({ definition, onChange }: { definition: RuleField; onChange: () => void }) {
  const { name, label, nullable, unit, minimum = 1 } = definition;
  return <FormField<RuleFormValues, FieldPath<RuleFormValues>> name={name} label={label}
    id={`geo-rule-${name}`} required={!nullable}
    description={`${unit === 'rate' ? '原始比例 0–1（0.1 = 10 个百分点）' : unit === 'days' ? '单位：天，范围 1–365' : `整数，范围 ${minimum}–10000`}${nullable ? '；留空表示未配置' : ''}`}
    render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => <Input {...field}
      id={inputId} type="number" value={typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : ''}
      min={unit === 'rate' ? 0 : minimum} max={unit === 'rate' ? 1 : unit === 'days' ? 365 : 10000} step={unit === 'rate' ? 'any' : 1}
      placeholder={nullable ? '未配置' : undefined} aria-describedby={describedBy} aria-invalid={invalid}
      onChange={(event) => { onChange(); field.onChange(event.target.value === '' ? nullable ? null : Number.NaN : Number(event.target.value)); }} />} />;
}

function RuleFields({ disabled, onChange }: { disabled: boolean; onChange: () => void }) {
  return <fieldset className="min-w-0 space-y-5" disabled={disabled}>
    <FormSection title="最低样本" description="样本等级由服务端确定。门槛必须满足 1 < REPORTABLE < STABLE。">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{sampleFields.map((field) => <RuleNumberField definition={field} key={field.name} onChange={onChange} />)}</div>
    </FormSection>
    <FormSection title="十项规则与阈值" description="数值门槛使用原始比例；未配置的门槛不会被补成默认成功率。">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{thresholdFields.map((field) => <RuleNumberField definition={field} key={field.name} onChange={onChange} />)}</div>
      <p className="text-sm text-text-secondary">主题覆盖缺口和关键事实错误没有独立可编辑数值阈值。它们的样本资格见服务端预览；事实错误必须人工确认。</p>
    </FormSection>
    <FormSection title="机会去重窗口" description="配置仅用于未来评估，历史机会快照不会被重新计算。">
      {dedupFields.map((field) => <RuleNumberField definition={field} key={field.name} onChange={onChange} />)}
    </FormSection>
    <FormSection title="复测恢复条件" description="满足这些条件仍需人工确认，不会自动解决或关闭机会。">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{recoveryFields.map((field) => <RuleNumberField definition={field} key={field.name} onChange={onChange} />)}</div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
        <li>严格可比条件：必须满足（只读）</li>
        <li>人工确认：必须完成（只读）</li>
        <li>复测同类事实错误：必须为 0 次（只读）</li>
      </ul>
    </FormSection>
  </fieldset>;
}

function SampleFields({ disabled, onChange }: { disabled: boolean; onChange: () => void }) {
  return <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
    {([{ name: 'current_runs', label: '当前窗口样本数' }, { name: 'previous_runs', label: '前期窗口样本数' }] as const).map(({ name, label }) =>
      <FormField<PreviewSamples, typeof name> key={name} name={name} label={label} id={`geo-preview-${name}`} description="用于资格预览的样本数，整数 0–100000" required
        render={({ field, inputId, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => <Input {...field} id={inputId} type="number"
          min={0} max={100000} step={1} value={Number.isFinite(field.value) ? field.value : ''} aria-describedby={describedBy} aria-invalid={invalid}
          onChange={(event) => { onChange(); field.onChange(event.target.value === '' ? Number.NaN : Number(event.target.value)); }} />} />)}
  </fieldset>;
}
export { RuleFields, SampleFields };
