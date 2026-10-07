import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, type Path } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import { queryTopicsQueryOptions } from '@/domains/geo/geo.api';
import { createQuestion, QuestionRequestError, questionKeys, updateQuestion } from './questions.api';
import { mentionLabels, priorityLabels, questionCreate, questionFormSchema, questionUpdate, questionValues, shouldBlockQuestionNavigation, type PromptVariant, type QuestionValues } from './questions.model';
import { QuestionNotice, QuestionSelect, questionErrorMessage } from './question-controls';

function QuestionForm({ variant, copying = false, csrfToken, onSaved, onReload, onCancel, onDirtyChange, readBlocked = false }: {
  variant?: PromptVariant; copying?: boolean; csrfToken: string | null; onSaved: (variant: PromptVariant) => void;
  onReload?: () => Promise<PromptVariant>; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; readBlocked?: boolean;
}) {
  const client = useQueryClient();
  const form = useForm<QuestionValues>({ defaultValues: questionValues(variant), resolver: zodResolver(questionFormSchema), mode: 'onChange' });
  const [baseline, setBaseline] = useState(variant);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editing = Boolean(variant && !copying);
  const allowed = !readBlocked && (!editing || variant!.available_actions.includes('UPDATE'));
  const topics = useQuery({ ...queryTopicsQueryOptions(), enabled: !editing });
  const { isDirty, isValid, isSubmitting, errors } = form.formState;
  useEffect(() => { onDirtyChange?.(isDirty); return () => onDirtyChange?.(false); }, [isDirty, onDirtyChange]);
  const mutation = useMutation({ retry: false, mutationFn: async ({ values, continuation }: { values: QuestionValues; continuation: PrincipalContinuation }) => {
    if (editing && baseline) await client.cancelQueries({ queryKey: questionKeys.detail(baseline.id) });
    continuation.assertCurrent();
    return editing && baseline ? updateQuestion(baseline.id, questionUpdate(values, baseline.revision), csrfToken) : createQuestion(questionCreate(values), csrfToken);
  } });
  const busy = mutation.isPending || refreshing || isSubmitting;
  async function save(values: QuestionValues) {
    if (inFlight.current || conflict || !allowed) return;
    inFlight.current = true;
    let continuation: PrincipalContinuation | undefined;
    setError(undefined); form.clearErrors(); setSavedMessage('');
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ values, continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: questionKeys.detail(canonical.id) });
      if (!continuation.isCurrent() || !mounted.current) return;
      client.setQueryData(questionKeys.detail(canonical.id), canonical);
      setBaseline(canonical); form.reset(questionValues(canonical));
      setSavedMessage(`已保存 · Revision ${canonical.revision}`);
      onSaved(canonical);
    } catch (failure) {
      if ((continuation && !continuation.isCurrent()) || !mounted.current) return;
      setError(failure);
      setConflict(failure instanceof QuestionRequestError && failure.status === 409 && failure.detail?.code !== 'GEO_PROMPT_VARIANT_EXISTS');
      if (failure instanceof QuestionRequestError && failure.detail) {
        const issues = failure.detail.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (!issue || typeof issue !== 'object' || !('loc' in issue) || !('msg' in issue)) continue;
          const location = issue.loc;
          if (Array.isArray(location) && location.length === 2 && location[0] === 'body' && typeof location[1] === 'string' && typeof issue.msg === 'string' && location[1] in form.getValues()) {
            form.setError(location[1] as Path<QuestionValues>, { type: 'server', message: issue.msg });
          }
        }
      }
    } finally { inFlight.current = false; }
  }
  async function reload() {
    if (!onReload || refreshing || inFlight.current) return;
    let continuation: PrincipalContinuation | undefined;
    setRefreshing(true);
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await onReload();
      if (!continuation.isCurrent() || !mounted.current) return;
      setBaseline(canonical); setError(undefined); setConflict(false); form.clearErrors();
      // 只合并提交 revision；本地语义输入必须保留，由用户再次确认提交。
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false); }
  }
  const summary = Object.entries(errors).flatMap(([name, value]) => value?.message ? [{ id: name, message: String(value.message), fieldId: `question-${name}` }] : []);
  const choices = topics.data?.items.map((topic) => ({ value: topic.id, label: topic.canonical_question })) ?? [];
  // 复制源的主题身份由单一详情提供，不把旧 variants 数组作为实际变体。
  if (variant && !choices.some((item) => item.value === variant.query_topic_id)) choices.push({ value: variant.query_topic_id, label: variant.query_topic.canonical_question });
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockQuestionNavigation(current, next)} when={isDirty || busy} />
    <form aria-label={editing ? '编辑问题变体' : copying ? '复制问题变体' : '新建问题变体'} className="min-w-0 space-y-4" onSubmit={(event) => void form.handleSubmit(save)(event)}>
      {copying && <QuestionNotice>复制会创建独立的新变体。请修改文本或维度；完全相同的语义会由服务端拒绝。</QuestionNotice>}
      <fieldset className="min-w-0 space-y-4" disabled={busy || !allowed}>
        {editing ? <p className="break-words text-sm">主题（不可变）：{variant!.query_topic.canonical_question}</p> : <>
          <FormField<QuestionValues, 'query_topic_id'> id="question-query_topic_id" label="问题主题" name="query_topic_id" required render={({ field, inputId, ...aria }) => <QuestionSelect choices={[{ value: '', label: '请选择主题' }, ...choices]} describedBy={aria['aria-describedby']} disabled={busy} id={inputId} invalid={aria['aria-invalid']} label="问题主题" onChange={field.onChange} required={aria['aria-required']} value={field.value} />} />
          {topics.isPending && <p role="status">正在读取主题选项…</p>}
          {topics.error && <QuestionNotice error>{questionErrorMessage(topics.error)}<Button onClick={() => void topics.refetch()} type="button" variant="outline">重试主题选项</Button></QuestionNotice>}
          {topics.data?.items.length === 0 && !variant && <p>尚无问题主题，请先到问题主题页面创建。</p>}
        </>}
        <FormField<QuestionValues, 'prompt_text'> description="完整保存实际提问文本；点名属性须独立选择，不根据文本猜测。" id="question-prompt_text" label="完整问题文本" name="prompt_text" required render={({ field, inputId, ...aria }) => <Textarea {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} id={inputId} maxLength={8000} rows={5} />} />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <FormField<QuestionValues, 'mention_mode'> id="question-mention_mode" label="点名属性" name="mention_mode" required render={({ field, inputId, ...aria }) => <QuestionSelect choices={[{ value: '', label: '请选择点名属性' }, ...Object.entries(mentionLabels).map(([value, label]) => ({ value, label }))]} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label="点名属性" onChange={field.onChange} required={aria['aria-required']} value={field.value} />} />
          <FormField<QuestionValues, 'priority'> id="question-priority" label="优先级" name="priority" required render={({ field, inputId, ...aria }) => <QuestionSelect choices={[{ value: '', label: '请选择优先级' }, ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))]} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label="优先级" onChange={field.onChange} required={aria['aria-required']} value={field.value} />} />
          <FormField<QuestionValues, 'language_code'> description="例如 zh-CN 或 en" id="question-language_code" label="语言代码" name="language_code" required render={({ field, inputId, ...aria }) => <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} id={inputId} maxLength={16} />} />
          <FormField<QuestionValues, 'region_code'> description="两位字母，例如 CN 或 US" id="question-region_code" label="地区代码" name="region_code" required render={({ field, inputId, ...aria }) => <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} id={inputId} maxLength={2} />} />
        </div>
      </fieldset>
      <ErrorSummary errors={summary} />
      {Boolean(error) && <QuestionNotice error>{questionErrorMessage(error)}</QuestionNotice>}
      {conflict && <QuestionNotice><p>变体已被其他操作更新。本地输入已保留，请读取最新版本、核对后再次提交。</p><Button disabled={refreshing} onClick={() => void reload()} type="button" variant="outline">加载最新版本并保留输入</Button></QuestionNotice>}
      {baseline && editing && <p className="break-words text-sm text-text-muted">提交基线 Revision {baseline.revision} · 服务端文本：{baseline.prompt_text}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-text-muted" role="status">{busy ? '提交中…' : savedMessage || (isDirty ? '有未保存的修改' : '未修改或已保存')}</span>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭表单</Button>{allowed && <Button disabled={busy || conflict || !csrfToken || !isValid || (editing && !isDirty)} type="submit">{editing ? '保存变体' : '创建变体'}</Button>}</div>
      </div>
    </form>
  </FormProvider>;
}
export { QuestionForm };
