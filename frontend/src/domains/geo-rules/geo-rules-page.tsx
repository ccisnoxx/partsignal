import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { ErrorSummary, FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';
import { GeoRulesRequestError, geoRulesErrorMessage, geoRulesKey, geoRulesQueryOptions, getGeoRules, previewGeoRules, updateGeoRules } from './geo-rules.api';
import { RuleFields, SampleFields } from './geo-rules-fields';
import { allRuleFields, previewSamplesSchema, ruleConfigurationSchema, type GeoRulePreview, type GeoRuleSet, type PreviewSamples, type RuleFormValues } from './geo-rules.model';
import { GeoRulesPreview } from './geo-rules-preview';

function GeoRulesPage({ csrfToken }: { csrfToken: string | null }) {
  const query = useQuery(geoRulesQueryOptions());
  const unavailable = query.error instanceof GeoRulesRequestError && [401, 403].includes(query.error.status ?? 0);
  return <section aria-labelledby="geo-rules-title" className="min-w-0 space-y-5">
    <header className="space-y-1"><h1 id="geo-rules-title" className="type-page-title">GEO 规则与阈值</h1>
      <p className="max-w-3xl text-text-secondary">维护当前规则集的样本、阈值、去重窗口和复测恢复条件。保存仅影响未来评估，历史快照保持不变。</p></header>
    {query.isPending && <p role="status">正在读取当前规则集…</p>}
    {query.error && <section role="alert" className="space-y-2 rounded-lg border border-danger/30 p-4">
      <p>{unavailable ? '当前会话无权读取或操作 GEO 规则，请使用有权限的管理员账号。' : geoRulesErrorMessage(query.error)}</p>
      {!unavailable && <Button type="button" variant="outline" onClick={() => void query.refetch()}>重新读取规则</Button>}
    </section>}
    {query.data && <GeoRulesEditor initial={query.data} csrfToken={csrfToken} unavailable={unavailable} actions={query.data.available_actions} />}
  </section>;
}

function GeoRulesEditor({ initial, csrfToken, unavailable, actions }: {
  initial: GeoRuleSet; csrfToken: string | null; unavailable: boolean; actions: GeoRuleSet['available_actions'];
}) {
  const client = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const form = useForm<RuleFormValues>({ resolver: zodResolver(ruleConfigurationSchema), defaultValues: ruleConfigurationSchema.parse(initial.configuration) });
  const samples = useForm<PreviewSamples>({ resolver: zodResolver(previewSamplesSchema), defaultValues: { current_runs: 0, previous_runs: 0 } });
  const [preview, setPreview] = useState<GeoRulePreview | null>(null);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [denied, setDenied] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'reloading'>('idle');
  const [previewPending, setPreviewPending] = useState(false);
  const [previousToken, setPreviousToken] = useState(csrfToken);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const commandPending = useRef(false);
  const token = useRef(csrfToken);
  const tokenEpoch = useRef(0);
  const previewEpoch = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  const mutation = useMutation({ mutationFn: ({ values, revision, csrf }: { values: RuleFormValues; revision: number; csrf: string | null }) =>
    updateGeoRules({ expected_revision: revision, configuration: values }, csrf), retry: false });
  // 令牌切换先清除展示结果；A → B → A 也不能重新显示旧 A 的预览。
  if (previousToken !== csrfToken) {
    setPreviousToken(csrfToken); setPreview(null); setPreviewPending(false);
  }

  const invalidatePreview = useCallback(() => {
    previewEpoch.current += 1;
    previewAbort.current?.abort();
    previewAbort.current = null;
    setPreview(null); setPreviewPending(false);
  }, []);
  // 提交时同步失效，避免旧响应在新令牌commit与passive effect之间写回。
  useLayoutEffect(() => {
    token.current = csrfToken;
    tokenEpoch.current += 1;
    previewEpoch.current += 1;
    previewAbort.current?.abort();
    previewAbort.current = null;
  }, [csrfToken]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewEpoch.current += 1; previewAbort.current?.abort(); };
  }, []);
  const blocked = unavailable || denied;
  const canUpdate = !blocked && actions.includes('UPDATE');
  const canPreview = !blocked && actions.includes('PREVIEW');
  const busy = phase !== 'idle';
  function current(continuation: PrincipalContinuation | undefined, requestedToken: string | null, requestedEpoch: number) {
    return mounted.current && (!continuation || continuation.isCurrent()) && token.current === requestedToken && tokenEpoch.current === requestedEpoch;
  }
  function recordFailure(failure: unknown) {
    setError(failure);
    if (failure instanceof GeoRulesRequestError) {
      if (failure.status === 409) { setConflict(true); invalidatePreview(); }
      if (failure.status === 401 || failure.status === 403) { setDenied(true); invalidatePreview(); }
      const issues = failure.detail?.details.errors;
      if (Array.isArray(issues)) for (const issue of issues) {
        if (!issue || typeof issue !== 'object' || !('loc' in issue) || !Array.isArray(issue.loc) || !('msg' in issue) || typeof issue.msg !== 'string') continue;
        const path = issue.loc.slice(0, 2).join('.') === 'body.configuration' ? issue.loc.slice(2).join('.') : '';
        const field = allRuleFields.find((candidate) => candidate.name === path);
        if (field) form.setError(field.name, { type: 'server', message: issue.msg });
        if (issue.loc.slice(0, 2).join('.') === 'body.samples') {
          const name = issue.loc[2];
          if (name === 'current_runs' || name === 'previous_runs') samples.setError(name, { type: 'server', message: issue.msg });
        }
      }
    }
  }
  async function save(values: RuleFormValues) {
    if (commandPending.current || conflict || !canUpdate) return;
    commandPending.current = true;
    const requestedToken = csrfToken;
    const requestedEpoch = tokenEpoch.current;
    let continuation: PrincipalContinuation | undefined;
    setPhase('saving'); setError(undefined); setMessage(''); invalidatePreview();
    try {
      continuation = capturePrincipalContinuation(client);
      await client.cancelQueries({ queryKey: geoRulesKey });
      if (!current(continuation, requestedToken, requestedEpoch)) return;
      const canonical = await mutation.mutateAsync({ values, revision: baseline.revision, csrf: requestedToken });
      if (!current(continuation, requestedToken, requestedEpoch)) return;
      await client.cancelQueries({ queryKey: geoRulesKey });
      if (!current(continuation, requestedToken, requestedEpoch)) return;
      client.setQueryData(geoRulesKey, canonical);
      setBaseline(canonical); form.reset(ruleConfigurationSchema.parse(canonical.configuration)); setConflict(false);
      setMessage(`规则已保存（revision ${canonical.revision}），仅用于未来评估。`);
    } catch (failure) { if (current(continuation, requestedToken, requestedEpoch)) recordFailure(failure); }
    finally { commandPending.current = false; if (mounted.current) setPhase('idle'); }
  }
  async function reloadBaseline() {
    if (commandPending.current || blocked) return;
    commandPending.current = true;
    const requestedToken = csrfToken;
    const requestedEpoch = tokenEpoch.current;
    let continuation: PrincipalContinuation | undefined;
    setPhase('reloading'); setMessage(''); invalidatePreview();
    try {
      continuation = capturePrincipalContinuation(client);
      await client.cancelQueries({ queryKey: geoRulesKey });
      if (!current(continuation, requestedToken, requestedEpoch)) return;
      const canonical = await getGeoRules();
      if (!current(continuation, requestedToken, requestedEpoch)) return;
      const draft = form.getValues();
      // 显式重读只更新比较基线；草稿独立于 Query cache，必须由用户核对后再次提交。
      form.reset(ruleConfigurationSchema.parse(canonical.configuration));
      form.reset(draft, { keepDefaultValues: true });
      client.setQueryData(geoRulesKey, canonical); setBaseline(canonical); setConflict(false); setError(undefined);
      setMessage('最新基线已加载，本地草稿已保留。请核对配置后再次预览或保存。');
    } catch (failure) { if (current(continuation, requestedToken, requestedEpoch)) recordFailure(failure); }
    finally { commandPending.current = false; if (mounted.current) setPhase('idle'); }
  }
  async function runPreview(configuration: RuleFormValues, counts: PreviewSamples) {
    if (previewAbort.current || commandPending.current || conflict || !canPreview) return;
    invalidatePreview();
    const controller = new AbortController();
    previewAbort.current = controller;
    const epoch = previewEpoch.current;
    const requestedToken = csrfToken;
    const requestedEpoch = tokenEpoch.current;
    let continuation: PrincipalContinuation | undefined;
    setPreviewPending(true); setError(undefined); setMessage('');
    try {
      continuation = capturePrincipalContinuation(client);
      const result = await previewGeoRules({ expected_revision: baseline.revision, configuration, samples: counts }, requestedToken, controller.signal);
      if (!current(continuation, requestedToken, requestedEpoch) || epoch !== previewEpoch.current || controller.signal.aborted) return;
      setPreview(result);
    } catch (failure) {
      if (current(continuation, requestedToken, requestedEpoch) && epoch === previewEpoch.current && !controller.signal.aborted) recordFailure(failure);
    } finally {
      if (mounted.current && epoch === previewEpoch.current) { previewAbort.current = null; setPreviewPending(false); }
    }
  }
  const formErrors = allRuleFields.flatMap((field) => {
    const issue = form.getFieldState(field.name, form.formState).error;
    return issue ? [{ id: field.name, fieldId: `geo-rule-${field.name}`, message: `${field.label}：${issue.message}` }] : [];
  });
  const sampleErrors = (['current_runs', 'previous_runs'] as const).flatMap((name) => samples.formState.errors[name]
    ? [{ id: name, fieldId: `geo-preview-${name}`, message: String(samples.formState.errors[name]?.message) }] : []);
  const status = busy ? phase === 'saving' ? '保存中…' : '正在重新加载基线…' : conflict ? '版本冲突，草稿已保留' : form.formState.isDirty ? '有未保存修改' : message ? '已保存 / 基线已加载' : '未修改';
  return <div className="min-w-0 space-y-5 rounded-xl border border-border-default bg-surface-panel p-4">
    <p className="break-words text-sm text-text-muted">当前编辑基线 revision {baseline.revision} · 更新时间 {baseline.updated_at} · 更新人 {baseline.updated_by ?? '系统初始化'}</p>
    {(!canUpdate || !canPreview) && <p role="status" className="text-text-secondary">{blocked ? '当前会话无权操作 GEO 规则，草稿已保留。请重新登录或使用有权限的管理员账号。' : `服务端当前未授权${!canUpdate ? '保存' : ''}${!canUpdate && !canPreview ? '和' : ''}${!canPreview ? '预览' : ''}操作。`}</p>}
    <ErrorSummary errors={[...formErrors, ...sampleErrors]} />
    {Boolean(error) && <p role="alert" className="break-words text-danger">{geoRulesErrorMessage(error)}</p>}
    {message && <p role="status" className="text-text-secondary">{message}</p>}
    {conflict && <section role="alert" className="space-y-2 rounded-lg border border-warning/30 p-3"><p>规则版本已变化。本地草稿已保留；请显式加载最新基线并核对，系统不会自动覆盖草稿或重新提交。</p><Button type="button" variant="outline" disabled={busy || blocked} onClick={() => void reloadBaseline()}>加载最新基线并保留草稿</Button></section>}
    <FormProvider {...form}><form onSubmit={(event) => void form.handleSubmit(save)(event)} noValidate>
      <RuleFields disabled={!canUpdate || busy} onChange={() => { invalidatePreview(); setMessage(''); }} />
    </form></FormProvider>
    <FormSection title="服务端预览" description="输入当前与前期样本数，只预览配置和样本资格；不会创建或修改业务记录。">
      <FormProvider {...samples}><SampleFields disabled={!canPreview || busy || conflict} onChange={invalidatePreview} /></FormProvider>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!canPreview || busy || conflict || previewPending || !csrfToken}
        onClick={() => void form.handleSubmit((configuration) => samples.handleSubmit((counts) => runPreview(configuration, counts))())()}> {previewPending ? '预览中…' : '预览配置与样本资格'}</Button>
        {previewPending && <Button type="button" variant="outline" onClick={invalidatePreview}>取消预览</Button>}</div>
      {previewPending && <p role="status">正在读取服务端预览…</p>}
      {preview && canPreview && <GeoRulesPreview preview={preview} />}
    </FormSection>
    <StickyActionBar status={<span role="status">{status}</span>} actions={[
      { key: 'reload', label: '重新加载基线并保留草稿', intent: 'secondary', enabled: !busy && !blocked, onSelect: () => void reloadBaseline() },
      ...(canUpdate ? [{ key: 'save', label: '保存规则', intent: 'primary' as const, enabled: !busy && !conflict && Boolean(csrfToken) && form.formState.isDirty,
        disabledReason: conflict ? '请先重新加载最新基线' : !csrfToken ? '缺少会话安全令牌' : '没有可保存的修改', onSelect: () => void form.handleSubmit(save)() }] : []),
    ]} />
    <DirtyGuard when={form.formState.isDirty} />
  </div>;
}
export { GeoRulesPage };
