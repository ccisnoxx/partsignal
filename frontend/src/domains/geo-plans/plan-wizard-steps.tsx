import { FormField } from '@/design-system/forms/form-field';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import { PlanSelect } from './plan-controls';
import { PlanOptions } from './plan-options';
import { scheduleLabels, type PlanValues } from './plans.model';

const planStepLabels = ['基本信息', '监测对象', '问题变体', '采集配置', '重复和预算', '调度', '服务端预览', '保存'] as const;
const stepFields: (keyof PlanValues)[][] = [
  ['name', 'description'], ['subjects'], ['prompt_variant_ids'], ['collection_profile_ids'], ['repeat_count', 'budget_limit', 'rule_set_revision'], ['schedule_kind', 'timezone'], [], [],
];
function TextField({ name, label, description, required, number = false, maxLength }: {
  name: 'name' | 'budget_limit' | 'repeat_count' | 'rule_set_revision' | 'timezone'; label: string; description?: string; required?: boolean; number?: boolean; maxLength?: number;
}) {
  return <FormField<PlanValues, typeof name> description={description} id={`plan-${name}`} label={label} name={name} required={required} render={({ field, inputId, ...aria }) => <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} id={inputId} inputMode={name === 'budget_limit' ? 'decimal' : undefined} maxLength={maxLength} min={number ? 1 : undefined} onChange={(event) => field.onChange(number ? (event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value)) : event.currentTarget.value)} step={number ? 1 : undefined} type={number ? 'number' : 'text'} value={typeof field.value === 'number' && Number.isNaN(field.value) ? '' : field.value} />} />;
}
function PlanWizardStep({ step, disabled }: { step: number; disabled: boolean }) {
  if (step === 0) return <div className="space-y-4"><TextField label="计划名称" maxLength={200} name="name" required /><FormField<PlanValues, 'description'> id="plan-description" label="计划说明" name="description" render={({ field, inputId, ...aria }) => <Textarea {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} id={inputId} rows={4} />} /></div>;
  if (step === 1) return <FormField<PlanValues, 'subjects'> description="每个对象必须显式选择角色，至少一个主要监测对象。角色独立于对象类型。" id="plan-subjects-label" label="监测对象与角色" name="subjects" required render={({ field, ...aria }) => <PlanOptions describedBy={aria['aria-describedby']} disabled={disabled} invalid={aria['aria-invalid']} kind="subjects" onChange={() => {}} onSubjectsChange={field.onChange} selected={field.value.map((item) => item.subject_id)} subjects={field.value} />} />;
  if (step === 2) return <FormField<PlanValues, 'prompt_variant_ids'> id="plan-prompt_variant_ids-label" label="问题变体" name="prompt_variant_ids" required render={({ field, ...aria }) => <PlanOptions describedBy={aria['aria-describedby']} disabled={disabled} invalid={aria['aria-invalid']} kind="prompts" onChange={field.onChange} selected={field.value} />} />;
  if (step === 3) return <FormField<PlanValues, 'collection_profile_ids'> description="同一观测面的不同配置独立选择。这里只展示非敏感摘要，运行资格以服务端预览为准。" id="plan-collection_profile_ids-label" label="采集配置" name="collection_profile_ids" required render={({ field, ...aria }) => <PlanOptions describedBy={aria['aria-describedby']} disabled={disabled} invalid={aria['aria-invalid']} kind="profiles" onChange={field.onChange} selected={field.value} />} />;
  if (step === 4) return <div className="space-y-4"><TextField description="每个问题与采集配置组合的重复次数，范围 1–10。" label="重复次数" name="repeat_count" number required /><TextField description="可留空；填写非负十进制金额。币种与是否超限由服务端估价裁决，未知费用不会按零补齐。" label="预算上限" name="budget_limit" /><TextField description="保存适用规则集的修订号。" label="规则集修订号" name="rule_set_revision" number required /></div>;
  if (step === 5) return <div className="space-y-4"><FormField<PlanValues, 'schedule_kind'> description="V1.0 只支持手动触发，定时调度尚未开放。" id="plan-schedule_kind" label="调度方式" name="schedule_kind" required render={({ field, inputId, ...aria }) => <PlanSelect choices={[{ value: 'MANUAL_ONLY', label: scheduleLabels.MANUAL_ONLY }]} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label="调度方式" onChange={field.onChange} required value={field.value} />} /><TextField description="IANA 时区，例如 Asia/Shanghai；服务端验证时区。" label="时区" maxLength={64} name="timezone" required /></div>;
  return null;
}
function PlanConfigurationSummary({ values }: { values: PlanValues }) {
  return <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-[auto_1fr]">
    <dt className="text-text-secondary">计划名称</dt><dd className="break-words">{values.name}</dd><dt className="text-text-secondary">说明</dt><dd className="break-words">{values.description || '未填写'}</dd>
    <dt className="text-text-secondary">监测对象及角色</dt><dd className="break-all">{values.subjects.map((item) => `${item.subject_id} (${item.role})`).join('；')}</dd>
    <dt className="text-text-secondary">问题变体</dt><dd className="break-all">{values.prompt_variant_ids.join('；')}</dd><dt className="text-text-secondary">采集配置</dt><dd className="break-all">{values.collection_profile_ids.join('；')}</dd>
    <dt className="text-text-secondary">重复次数 / 预算</dt><dd>{values.repeat_count} / {values.budget_limit === '' ? '未设置预算' : values.budget_limit}</dd><dt className="text-text-secondary">调度</dt><dd className="break-words">{scheduleLabels[values.schedule_kind]} · {values.schedule_kind === 'CRON' ? values.cron_expression : '手动触发'} · {values.timezone}</dd><dt className="text-text-secondary">规则集修订号</dt><dd>{values.rule_set_revision}</dd>
  </dl>;
}
export { PlanConfigurationSummary, PlanWizardStep, planStepLabels, stepFields };
