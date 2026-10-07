import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { ErrorSummary, FormActions, FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import {
  manualDraft,
  manualFormSchema,
  manualSubmissionIssues,
  manualSubmit,
  manualValues,
  shouldBlockManualNavigation,
  type ManualContext,
  type ManualDraft,
  type ManualSubmit,
  type ManualValues,
} from './manual.model';
import { manualEntryOptions, runKeys, RunRequestError, saveManualDraft, submitManualObservation } from './runs.api';
import {
  ManualFields,
  ManualReadState,
  ScreenshotValue,
  CitationFields,
  FrozenInput,
  DraftComparison,
  Notice,
  errorMessage,
  formIssues,
} from './manual-editor-view';
import { RunUpload } from './run-upload';

type ManualEditorProps = {
  runId: string;
  csrfToken: string | null;
  onSubmitted: (runId: string) => void;
  onClose: () => void;
};
type SubmitRequest = {
  key: string;
  payload: ManualSubmit;
  outcome: 'unknown' | 'rejected';
  owner: PrincipalContinuation;
};
class ManualCommandNotSentError extends Error {}

function ManualEditor(props: ManualEditorProps) {
  const query = useQuery(manualEntryOptions(props.runId));
  if (!query.data)
    return (
      <ManualReadState
        error={query.error}
        pending={query.isPending}
        fetching={query.isFetching}
        onClose={props.onClose}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <ManualEditorForm
      {...props}
      context={query.data}
      key={props.runId}
      readError={query.isError ? query.error : undefined}
    />
  );
}

function ManualEditorForm({
  runId,
  csrfToken,
  onSubmitted,
  onClose,
  context,
  readError,
}: ManualEditorProps & { context: ManualContext; readError?: unknown }) {
  const client = useQueryClient();
  const form = useForm<ManualValues>({
    defaultValues: manualValues(context.draft?.draft),
    resolver: zodResolver(manualFormSchema),
    mode: 'onChange',
  });
  const { isDirty, errors } = form.formState;
  const [revision, setRevision] = useState(context.draft_revision);
  const [retained, setRetained] = useState<ManualDraft | null>(context.draft?.draft ?? null);
  const [latest, setLatest] = useState<ManualContext>();
  const [frozen, setFrozen] = useState(Boolean(readError));
  const [readFailure, setReadFailure] = useState<unknown>(readError);
  const [error, setError] = useState<unknown>();
  const [operation, setOperation] = useState<'save' | 'submit' | 'reload'>();
  const [uploadBlocking, setUploadBlocking] = useState(false);
  const [request, setRequest] = useState<SubmitRequest>();
  const [saved, setSaved] = useState(false);
  const [completed, setCompleted] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const unknown = request?.outcome === 'unknown';
  const allowed = context.available_actions.includes('ENTER_MANUAL_OBSERVATION') && !frozen && !readError;
  const allowedRef = useRef(allowed);
  useLayoutEffect(() => {
    allowedRef.current = allowed;
  }, [allowed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error' || event.query.state.status !== 'error') return;
        if (event.query !== client.getQueryCache().find({ queryKey: runKeys.manual(runId), exact: true })) return;
        // 后台成功读取不得解除旧读资格失败；只由本编辑器的显式 reload 恢复。
        setReadFailure(event.query.state.error);
        setFrozen(true);
      }),
    [client, runId],
  );
  const busy = Boolean(operation);
  const fieldsDisabled = busy || unknown || !allowed || completed;
  const guarded = !completed && (isDirty || busy || uploadBlocking || unknown);
  function isCurrent(continuation: PrincipalContinuation) {
    return mounted.current && continuation.isCurrent();
  }
  function failure(reason: unknown) {
    setError(reason);
    setSaved(false);
    if (
      reason instanceof ManualCommandNotSentError ||
      (reason instanceof RunRequestError &&
        (reason.status === 409 ||
          reason.status === 401 ||
          reason.status === 403 ||
          reason.status === 404 ||
          reason.detail?.code === 'GEO_PLAN_PROFILE_INELIGIBLE'))
    )
      setFrozen(true);
  }
  const saveMutation = useMutation({
    retry: false,
    mutationFn: async ({ values, continuation }: { values: ManualValues; continuation: PrincipalContinuation }) => {
      continuation.assertCurrent();
      if (
        !mounted.current ||
        !allowedRef.current ||
        !client
          .getQueryData<ManualContext>(runKeys.manual(runId))
          ?.available_actions.includes('ENTER_MANUAL_OBSERVATION')
      )
        throw new ManualCommandNotSentError('当前人工录入资格已变化，请重新读取');
      return saveManualDraft(
        runId,
        { expected_draft_revision: revision, draft: manualDraft(values, retained) },
        csrfToken,
      );
    },
  });
  const submitMutation = useMutation({
    retry: false,
    mutationFn: async ({
      attempt,
      continuation,
      recovery,
    }: {
      attempt: SubmitRequest;
      continuation: PrincipalContinuation;
      recovery: boolean;
    }) => {
      continuation.assertCurrent();
      attempt.owner.assertCurrent();
      // 同键回执恢复仍使用原 payload；服务端先查提交身份，再裁决当前运行资格。
      if (
        !mounted.current ||
        (!recovery &&
          (!allowedRef.current ||
            !client
              .getQueryData<ManualContext>(runKeys.manual(runId))
              ?.available_actions.includes('ENTER_MANUAL_OBSERVATION')))
      )
        throw new ManualCommandNotSentError('当前人工录入资格已变化，请重新读取');
      return submitManualObservation(runId, attempt.payload, attempt.key, csrfToken);
    },
  });
  async function save(values: ManualValues) {
    if (inFlight.current || uploadBlocking || unknown || !allowed || !csrfToken) return;
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      inFlight.current = true;
      setOperation('save');
      setError(undefined);
      await client.cancelQueries({ queryKey: runKeys.manual(runId), exact: true });
      if (!isCurrent(continuation)) return;
      const canonical = await saveMutation.mutateAsync({ values, continuation });
      if (!isCurrent(continuation)) return;
      if (
        canonical.run_id !== runId ||
        !Number.isSafeInteger(canonical.draft_revision) ||
        canonical.draft_revision < revision ||
        !canonical.draft ||
        typeof canonical.draft.answer_text !== 'string' ||
        !['TEXT', 'MARKDOWN', 'HTML_TEXT'].includes(canonical.draft.answer_format)
      ) {
        setFrozen(true);
        throw new Error('保存回执不完整，已保留本地输入，请显式读取最新草稿核对');
      }
      const canonicalValues = manualValues(canonical.draft);
      if (!manualFormSchema.safeParse(canonicalValues).success) {
        setFrozen(true);
        throw new Error('保存回执包含无法编辑的草稿，已保留本地输入，请显式读取最新草稿核对');
      }
      await client.cancelQueries({ queryKey: runKeys.manual(runId), exact: true });
      if (!isCurrent(continuation)) return;
      setRevision(canonical.draft_revision);
      setRetained(canonical.draft);
      form.reset(canonicalValues);
      setLatest(undefined);
      setRequest(undefined);
      setSaved(true);
      client.setQueryData<ManualContext>(runKeys.manual(runId), (current) =>
        current ? { ...current, draft_revision: canonical.draft_revision, draft: canonical } : undefined,
      );
      void client.invalidateQueries({ queryKey: runKeys.detail(runId), exact: true });
    } catch (reason) {
      if (mounted.current && (!continuation || continuation.isCurrent())) {
        failure(reason);
        if (!(
          reason instanceof RunRequestError &&
          reason.detail &&
          reason.status !== undefined &&
          reason.status >= 400 &&
          reason.status < 500
        ))
          setFrozen(true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && (!continuation || continuation.isCurrent())) setOperation(undefined);
    }
  }
  async function submit(values: ManualValues, recovery = false) {
    if (inFlight.current || uploadBlocking || !csrfToken || completed || (!recovery && (!allowed || unknown))) return;
    let continuation: PrincipalContinuation | undefined;
    let attempt: SubmitRequest | undefined;
    let dispatched = false;
    try {
      continuation = capturePrincipalContinuation(client);
      if (!recovery) {
        const issues = manualSubmissionIssues(values, context.require_screenshot, retained);
        const first = issues[0];
        if (first) {
          issues.forEach((issue) => form.setError(issue.field, { message: issue.message }));
          form.setFocus(first.field);
          return;
        }
      }
      const payload = manualSubmit(values, revision, retained);
      attempt = recovery
        ? request
        : {
            key:
              request && JSON.stringify(request.payload) === JSON.stringify(payload)
                ? request.key
                : crypto.randomUUID(),
            payload,
            outcome: 'unknown',
            owner: continuation,
          };
      if (!attempt) return;
      inFlight.current = true;
      setOperation('submit');
      setError(undefined);
      setSaved(false);
      await client.cancelQueries({ queryKey: runKeys.manual(runId), exact: true });
      if (!isCurrent(continuation)) return;
      setRequest({ ...attempt, outcome: 'unknown' });
      dispatched = true;
      const receipt = await submitMutation.mutateAsync({ attempt, continuation, recovery });
      if (!isCurrent(continuation)) return;
      if (
        receipt.run_id !== runId ||
        receipt.draft_revision !== attempt.payload.expected_draft_revision ||
        receipt.collection_status !== 'COLLECTED' ||
        receipt.analysis_dispatch !== 'NOT_IMPLEMENTED' ||
        typeof receipt.answer_snapshot_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receipt.answer_snapshot_id) ||
        typeof receipt.answer_sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(receipt.answer_sha256)
      )
        throw new Error('提交回执不完整，结果未知，请使用同一请求安全重试');
      form.reset(form.getValues());
      setRequest(undefined);
      setCompleted(true);
      void client.invalidateQueries({ queryKey: runKeys.root(), refetchType: 'none' });
      onSubmitted(receipt.run_id);
    } catch (reason) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      failure(reason);
      const explicit =
        reason instanceof ManualCommandNotSentError ||
        (reason instanceof RunRequestError &&
          reason.detail &&
          reason.status !== undefined &&
          reason.status >= 400 &&
          reason.status < 500);
      if (attempt && dispatched) setRequest({ ...attempt, outcome: explicit ? 'rejected' : 'unknown' });
    } finally {
      inFlight.current = false;
      if (mounted.current && (!continuation || continuation.isCurrent())) setOperation(undefined);
    }
  }
  async function reload() {
    if (inFlight.current || uploadBlocking || unknown || completed) return;
    let continuation: PrincipalContinuation | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      inFlight.current = true;
      setOperation('reload');
      await client.cancelQueries({ queryKey: runKeys.manual(runId), exact: true });
      if (!isCurrent(continuation)) return;
      const canonical = await client.fetchQuery({ ...manualEntryOptions(runId), staleTime: 0 });
      if (!isCurrent(continuation)) return;
      // 显式读取只推进 CAS 基线；本地正文、引用与已校验截图继续保留供比较。
      setRevision(canonical.draft_revision);
      setLatest(canonical);
      setFrozen(false);
      setReadFailure(undefined);
      setError(undefined);
      setSaved(false);
      form.clearErrors();
    } catch (reason) {
      if (mounted.current && (!continuation || continuation.isCurrent())) failure(reason);
    } finally {
      inFlight.current = false;
      if (mounted.current && (!continuation || continuation.isCurrent())) setOperation(undefined);
    }
  }
  function adopt() {
    if (!latest || busy || uploadBlocking || unknown) return;
    form.reset(manualValues(latest.draft?.draft));
    setRetained(latest.draft?.draft ?? null);
    setRequest(undefined);
    setLatest(undefined);
    setSaved(false);
  }
  const issues = formIssues(errors);
  return (
    <FormProvider {...form}>
      <DirtyGuard
        description={
          unknown
            ? '提交结果尚未确认。离开会丢失本地同键恢复信息，请优先安全重试确认结果。'
            : uploadBlocking
              ? '截图尚未确认完成。离开会丢失待校验上传和未保存的修改。'
              : undefined
        }
        shouldBlockNavigation={({ current, next }) => shouldBlockManualNavigation(current, next)}
        when={guarded}
      />
      <form
        aria-label="人工采集编辑器"
        className="min-w-0 space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit((values) => submit(values))(event);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-section-title">人工采集录入</h2>
          <p aria-live="polite" className="text-sm text-text-secondary">
            草稿 Revision {revision} ·{' '}
            {operation === 'save' ? '保存中' : isDirty ? '未保存' : saved ? '已保存' : '未修改'}
          </p>
        </div>
        <FrozenInput context={context} />
        {(readFailure ?? readError) !== undefined && (
          <Notice error>后台读取失败，已保留本地输入。{errorMessage(readFailure ?? readError)}</Notice>
        )}
        {!allowed && <Notice error>当前人工录入资格不可用。输入已保留，请显式读取最新上下文后核对。</Notice>}
        {context.collection_blockers.length > 0 && (
          <Notice error>
            采集阻断：{context.collection_blockers.map((blocker) => `${blocker.code} (${blocker.field})`).join('；')}
          </Notice>
        )}
        <div className="min-w-0 space-y-5">
          <fieldset disabled={fieldsDisabled}>
            <ManualFields disabled={fieldsDisabled} />
          </fieldset>
          <FormSection
            description={
              context.require_screenshot
                ? '冻结的采集配置要求截图证据。上传只有校验成功后才关联到草稿。'
                : '正式提交需要截图或已有原始证据。'
            }
            title="截图与原始证据"
          >
            <ScreenshotValue disabled={fieldsDisabled || uploadBlocking} />
            {retained?.raw_payload_file_id && (
              <p className="break-all text-sm">已有原始证据：{retained.raw_payload_file_id}（保留）</p>
            )}
            <RunUpload
              csrfToken={csrfToken}
              disabled={fieldsDisabled}
              recoveryDisabled={busy || unknown || completed}
              inputId="manual-screenshot_file_id"
              describedBy={errors.screenshot_file_id ? 'manual-screenshot_file_id-error' : undefined}
              invalid={Boolean(errors.screenshot_file_id)}
              onBlockingChange={setUploadBlocking}
              onUploaded={(file) => {
                if (mounted.current) {
                  form.setValue('screenshot_file_id', file.id, { shouldDirty: true, shouldValidate: true });
                  setSaved(false);
                }
              }}
            />
          </FormSection>
          <fieldset disabled={fieldsDisabled}>
            <CitationFields />
          </fieldset>
        </div>
        <ErrorSummary errors={issues} />
        {error !== undefined && <Notice error>{errorMessage(error)}</Notice>}
        {(frozen || readError !== undefined) && !unknown && (
          <Notice>
            <p>服务端资格或草稿已变化。不会自动重发写操作。显式读取会保留全部本地输入，并提供最新服务端草稿供比较。</p>
            <Button disabled={busy || uploadBlocking} onClick={() => void reload()} type="button" variant="outline">
              读取最新上下文并保留输入
            </Button>
          </Notice>
        )}
        {latest && (
          <section
            aria-label="最新服务端草稿供比较"
            className="min-w-0 space-y-3 rounded-lg border border-border-default p-4"
          >
            <h3 className="font-medium">最新服务端草稿 · Revision {latest.draft_revision}</h3>
            <DraftComparison draft={latest.draft?.draft} />
            <p className="text-sm text-text-secondary">
              本地输入已保留。下一次显式保存或提交使用此修订号；采用服务端草稿会替换本地输入。
            </p>
            <Button disabled={busy || uploadBlocking || unknown} onClick={adopt} type="button" variant="outline">
              采用服务端草稿
            </Button>
          </section>
        )}
        {unknown && (
          <Notice error>
            <p>提交结果未知。原提交内容和幂等键已保留；在结果确认前不可编辑、保存或创建新提交。</p>
            <Button
              disabled={busy || uploadBlocking || !csrfToken}
              onClick={() => void submit(form.getValues(), true)}
              type="button"
              variant="outline"
            >
              使用同一请求安全重试
            </Button>
          </Notice>
        )}
        {completed && <Notice>人工原文已采集并冻结。分析与复核进度以运行详情为准。</Notice>}
        <FormActions>
          <Button onClick={onClose} type="button" variant="outline">
            返回运行详情
          </Button>
          <Button
            disabled={fieldsDisabled || uploadBlocking || !csrfToken || !isDirty}
            onClick={() => void form.handleSubmit(save)()}
            type="button"
            variant="outline"
          >
            {operation === 'save' ? '保存中…' : '保存人工草稿'}
          </Button>
          <Button disabled={fieldsDisabled || uploadBlocking || !csrfToken} type="submit">
            {operation === 'submit' ? '提交中…' : '正式提交人工观测'}
          </Button>
        </FormActions>
      </form>
    </FormProvider>
  );
}

export { ManualEditor };
export type { ManualEditorProps };
