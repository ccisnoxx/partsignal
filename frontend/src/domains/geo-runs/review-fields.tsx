import { useFormContext, useWatch, type FieldErrors, type FieldPathByValue } from 'react-hook-form';
import { FormField } from '@/design-system/forms/form-field';
import { FormSection } from '@/design-system/forms/form-layout';
import { Input } from '@/design-system/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import { categories, recommendations, severeClaims, severities, verdicts, type Analysis, type Detail, type ReviewValues } from './review.model';

type TextPath = FieldPathByValue<ReviewValues, string>;
type CheckPath = FieldPathByValue<ReviewValues, boolean>;
function ReviewFields({ detail, analysis, disabled }: { detail: Detail; analysis: Analysis; disabled: boolean }) {
  const { control, setValue } = useFormContext<ReviewValues>();
  const values = useWatch({ control });
  const subjects = analysis.analysis.input_snapshot.subjects;
  const subjectName = (id: string) => subjects.find((row) => row.id === id)?.display_name ?? id;
  return <div className="min-w-0 space-y-4">
    <ReviewSelect choices={[['', '请选择结论'], ['CONFIRMED', 'CONFIRMED · 确认机器结论'], ['CORRECTED', 'CORRECTED · 提交修正']]} disabled={disabled} label="复核结论" name="decision" />
    <ReviewText area label="复核说明" name="comment" />
    {severeClaims(analysis).length > 0 && <FormSection title="严重错误逐条核对" description="即使确认机器判断，也必须逐条检查原文及事实依据并填写复核说明。核对项不会默认选中。">
      {severeClaims(analysis).map((row, index) => <div className="space-y-2 break-words text-sm" key={row.id}>
        <p>{row.claim_text} · {row.verdict} · {row.severity}</p><p>FactVersion：{row.fact_version_id} · {row.fact_excerpt}</p><p>{row.explanation}</p>
        <ReviewCheck label={`已核对严重声明 ${index + 1}`} name={`checked.${index}`} />
      </div>)}
    </FormSection>}
    {values.decision === 'CORRECTED' && <>
      <p className="text-sm text-text-secondary">仅勾选“本次修正”的行会提交。最新复核整体替换上一复核；未勾选的旧修正不会保留。已载入当前复核的全部明确字段，可取消本次不保留的修正。</p>
      <FormSection title="提及修正" description="每个别名一行。正数需有匹配别名；次数改为 0 会清空别名和位置。位置按 Python Unicode codepoint 从 0 计数。">
        {values.mentions?.map((row, index) => <div className="min-w-0 space-y-3 border-b border-border-subtle pb-3" key={row.subject_id}>
          <p className="break-words text-sm">{subjectName(row.subject_id ?? '')}</p>
          <ReviewCheck label={`修正提及 ${index + 1}`} name={`mentions.${index}.enabled`} />
          <fieldset disabled={!row.enabled || disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <FormField<ReviewValues, `mentions.${number}.count`> id={`review-mentions.${index}.count`} label={`提及 ${index + 1} 次数`} name={`mentions.${index}.count`} render={({ field, inputId, ...aria }) => <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} className="min-h-11 sm:min-h-8" id={inputId} inputMode="numeric" onChange={(event) => {
              field.onChange(event.currentTarget.value);
              if (event.currentTarget.value === '0') {
                setValue(`mentions.${index}.offset`, '', { shouldDirty: true, shouldValidate: true });
                setValue(`mentions.${index}.aliases`, '', { shouldDirty: true, shouldValidate: true });
              }
            }} />} />
            <ReviewText label={`提及 ${index + 1} 首次字符位置`} name={`mentions.${index}.offset`} />
            <ReviewText area label={`提及 ${index + 1} 匹配别名`} name={`mentions.${index}.aliases`} />
          </fieldset>
        </div>)}
        {!values.mentions?.length && <p className="text-sm">分析快照没有监测对象。</p>}
      </FormSection>
      <FormSection title="推荐修正">
        {values.recommendations?.map((row, index) => <div className="min-w-0 space-y-3 border-b border-border-subtle pb-3" key={row.subject_id}>
          <p className="break-words text-sm">{subjectName(row.subject_id ?? '')}</p>
          <ReviewCheck label={`修正推荐 ${index + 1}`} name={`recommendations.${index}.enabled`} />
          <fieldset disabled={!row.enabled || disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <ReviewSelect choices={recommendations.map((value) => [value, value])} disabled={disabled || !row.enabled} label={`推荐 ${index + 1} 类型`} name={`recommendations.${index}.recommendation`} />
            <ReviewText label={`推荐 ${index + 1} 排名`} name={`recommendations.${index}.rank`} />
            <ReviewText area label={`推荐 ${index + 1} 理由摘录`} name={`recommendations.${index}.excerpt`} />
          </fieldset>
        </div>)}
        {!values.recommendations?.length && <p className="text-sm">分析快照没有监测对象。</p>}
      </FormSection>
      <FormSection title="声明修正" description="保留不可变原文和 FactVersion 依据。没有 FactVersion 的声明只能保持 UNJUDGEABLE。">
        {values.claims?.map((row, index) => {
          const claim = analysis.claims[index];
          if (!claim) throw new Error('复核声明不属于当前编辑分析');
          return <div className="min-w-0 space-y-3 border-b border-border-subtle pb-3" key={row.claim_assessment_id}>
            <p className="whitespace-pre-wrap break-words text-sm">{claim.claim_text}</p>
            <p className="break-words text-sm [overflow-wrap:anywhere]">FactVersion：{claim.fact_version_id ?? '无'} · {claim.fact_excerpt ?? '无事实摘录'}</p>
            <ReviewCheck label={`修正声明 ${index + 1}`} name={`claims.${index}.enabled`} />
            <fieldset disabled={!row.enabled || disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
              <ReviewSelect choices={(claim.fact_version_id === null ? ['UNJUDGEABLE'] : verdicts).map((value) => [value, value])} disabled={disabled || !row.enabled} label={`声明 ${index + 1} 判定`} name={`claims.${index}.verdict`} />
              <ReviewSelect choices={severities.map((value) => [value, value])} disabled={disabled || !row.enabled} label={`声明 ${index + 1} 严重度`} name={`claims.${index}.severity`} />
              <ReviewText area label={`声明 ${index + 1} 解释`} name={`claims.${index}.explanation`} />
            </fieldset>
          </div>;
        })}
        {!values.claims?.length && <p className="text-sm">没有可修正的机器声明。</p>}
      </FormSection>
      <FormSection title="引用修正" description="来源分类按引用来源填写。内容关联对象可为空；关联某对象不表示该域名由此对象拥有。">
        {values.citations?.map((row, index) => <div className="min-w-0 space-y-3 border-b border-border-subtle pb-3" key={row.citation_id}>
          <p className="break-all text-sm">{detail.citations.find((citation) => citation.id === row.citation_id)?.original_url}</p>
          <ReviewCheck label={`修正引用 ${index + 1}`} name={`citations.${index}.enabled`} />
          <fieldset disabled={!row.enabled || disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <ReviewSelect choices={categories.map((value) => [value, value])} disabled={disabled || !row.enabled} label={`引用 ${index + 1} 来源分类`} name={`citations.${index}.source_category`} />
            <ReviewSelect choices={[['', '不关联对象'], ...subjects.map((subject): [string, string] => [subject.id, subject.display_name])]} disabled={disabled || !row.enabled} label={`引用 ${index + 1} 内容关联对象`} name={`citations.${index}.subject_id`} />
          </fieldset>
        </div>)}
        {!values.citations?.length && <p className="text-sm">没有原始引用。</p>}
      </FormSection>
    </>}
  </div>;
}
function ReviewText({ name, label, area = false }: { name: TextPath; label: string; area?: boolean }) {
  return <FormField<ReviewValues, TextPath> id={`review-${name}`} label={label} name={name} render={({ field, inputId, ...aria }) => area
    ? <Textarea {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} id={inputId} rows={3} />
    : <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} className="min-h-11 sm:min-h-8" id={inputId} />} />;
}
function ReviewSelect({ name, label, choices, disabled }: { name: TextPath; label: string; choices: readonly (readonly [string, string])[]; disabled: boolean }) {
  return <FormField<ReviewValues, TextPath> id={`review-${name}`} label={label} name={name} render={({ field, inputId, ...aria }) => <Select disabled={disabled} items={choices.map(([value, text]) => ({ value, label: text }))} onValueChange={(value) => { if (value !== null) field.onChange(value); }} value={field.value}>
    <SelectTrigger aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} className="min-h-11 w-full sm:min-h-8" id={inputId} onBlur={field.onBlur} ref={field.ref}><SelectValue /></SelectTrigger>
    <SelectContent>{choices.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
  </Select>} />;
}
function ReviewCheck({ name, label }: { name: CheckPath; label: string }) {
  const { register, formState: { errors } } = useFormContext<ReviewValues>();
  const issue = reviewIssues(errors).find((row) => row.id === name);
  return <div><label className="flex min-h-11 items-center gap-2 text-sm" htmlFor={`review-${name}`}>
    <input {...register(name)} aria-describedby={issue ? `review-${name}-error` : undefined} aria-invalid={Boolean(issue)} className="size-4 shrink-0 accent-[var(--interaction-primary)]" id={`review-${name}`} type="checkbox" />{label}
  </label>{issue && <p className="text-xs text-danger" id={`review-${name}-error`} role="alert">{issue.message}</p>}</div>;
}
function reviewIssues(errors: FieldErrors<ReviewValues>) {
  const issues: { id: string; message: string; fieldId: string }[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== 'object') return;
    if ('message' in value && typeof value.message === 'string') issues.push({ id: path, message: value.message, fieldId: `review-${path}` });
    for (const [key, child] of Object.entries(value)) if (!['ref', 'message', 'type', 'types'].includes(key)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(errors, '');
  return issues;
}
export { ReviewFields, reviewIssues };
