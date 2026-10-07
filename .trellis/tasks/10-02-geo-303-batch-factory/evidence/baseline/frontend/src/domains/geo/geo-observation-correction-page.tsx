import { zodResolver } from '@hookform/resolvers/zod';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { FormProvider, useForm, useWatch, type FieldPath } from 'react-hook-form';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Textarea } from '@/design-system/primitives/textarea';
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import { productsKeys } from '@/domains/product/product.api';
import type { components } from '@/shared/api/generated/schema';
import {
  createGeoObservation,
  geoKeys,
  geoObservationCorrectionContextQueryOptions,
} from './geo.api';
import { GeoEvidenceUploadView, useGeoEvidenceUpload, type GeoEvidenceUploadController } from './geo-evidence-upload';
import {
  correctionValues,
  geoObservationCorrectionFormSchema,
  mapGeoObservationCorrectionError,
  mergeCorrectionValues,
  toGeoObservationCorrectionCreate,
  type GeoObservationCorrectionField,
  type GeoObservationCorrectionFormValues,
} from './geo-observation-correction.model';
import {
  formatAccuracy,
  formatBoolean,
  formatObservationTime,
  tailManualHistory,
  type GeoObservationCorrectionContext,
  type ManualHistoryItem,
} from './geo-observation-detail.model';
import { accuracyLabels, accuracyValues } from './new-geo-observation.model';

type FileRecord = components['schemas']['FileRecord'];

type GeoObservationCorrectionPageProps = {
  csrfToken: string | null;
  observationId: string;
  onCancel: (observationId: string) => void;
  onCanonicalChange: (observationId: string) => Promise<void>;
  onCreated: (observationId: string) => void | Promise<void>;
};

const fieldIds: Record<Exclude<
GeoObservationCorrectionField,
'article_results' | 'attachment_file_ids'
>, string> = {
  query_topic_id: 'geo-correction-query-topic',
  tested_at: 'geo-correction-tested-at',
  notes: 'geo-correction-notes',
};
const conflictCodes = new Set(['GEO_PUBLICATIONS_CHANGED', 'GEO_OBSERVATION_HAS_SUCCESSOR', 'GEO_OBSERVATION_CONTEXT_INCOMPLETE']);

function GeoObservationCorrectionPage(props: GeoObservationCorrectionPageProps) {
  const id = props.observationId.toLowerCase();
  const [session, setSession] = useState<{ routeId: string; key: string; canonicalTarget?: string }>({ routeId: id, key: id });
  // 只有本会话发起的 canonical replace 才沿用草稿；其他 URL 身份切换创建新会话。
  if (id !== session.routeId) {
    setSession({ routeId: id, key: session.canonicalTarget === id ? session.key : id });
  }
  return <CorrectionSession {...props} key={session.key} onCanonicalChange={async (target) => {
    setSession((current) => ({ ...current, canonicalTarget: target.toLowerCase() }));
    try {
      await props.onCanonicalChange(target);
    } catch (error) {
      setSession((current) => ({ ...current, canonicalTarget: undefined }));
      throw error;
    }
  }} />;
}

function CorrectionSession(props: GeoObservationCorrectionPageProps) {
  const [contextStale, setContextStale] = useState(false);
  const context = useQuery({
    ...geoObservationCorrectionContextQueryOptions(props.observationId),
    enabled: !contextStale,
    refetchOnWindowFocus: (query) => !contextStale && query.state.status !== 'error' ? 'always' : false,
    refetchOnReconnect: false,
  });
  if (context.isPending) {
    return <GeoObservationCorrectionSkeleton observationId={props.observationId} />;
  }
  if (!context.data && context.error) {
    return (
      <CorrectionFailure
        error={context.error}
        onRetry={() => void context.refetch()}
      />
    );
  }
  if (!context.data) return null;
  return (
    <CorrectionFormPage
      contextQuery={context}
      contextStale={contextStale}
      setContextStale={setContextStale}
      initialContext={context.data}
      key={context.data.detail.chain_root_id}
      {...props}
    />
  );
}

function CorrectionFormPage({
  contextQuery,
  contextStale,
  setContextStale,
  csrfToken,
  initialContext,
  observationId,
  onCancel,
  onCanonicalChange,
  onCreated,
}: GeoObservationCorrectionPageProps & {
  contextQuery: UseQueryResult<GeoObservationCorrectionContext>;
  contextStale: boolean;
  setContextStale: (stale: boolean) => void;
  initialContext: GeoObservationCorrectionContext;
}) {
  const queryClient = useQueryClient();
  const [context, setContext] = useState(initialContext);
  const [requestId, setRequestId] = useState<string>();
  const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
  const [created, setCreated] = useState<{
    continuation: PrincipalContinuation;
    id: string;
  }>();
  const acceptedId = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const [navigationError, setNavigationError] = useState<string>();
  const [reloading, setReloading] = useState(false);
  const [uploadBlocking, setUploadBlocking] = useState(false);
  const uploadBlockingRef = useRef(false);
  const uploadedFilesRef = useRef<FileRecord[]>([]);
  const updateUploadBlocking = useCallback((blocking: boolean) => {
    uploadBlockingRef.current = blocking;
    setUploadBlocking(blocking);
  }, []);
  const submitting = useRef(false);
  const formElement = useRef<HTMLFormElement>(null);
  const summaryContainer = useRef<HTMLDivElement>(null);
  const form = useForm<GeoObservationCorrectionFormValues>({
    defaultValues: correctionValues(initialContext),
    resolver: zodResolver(geoObservationCorrectionFormSchema),
  });
  const create = useMutation({
    mutationFn: ({
      submissionContext,
      values,
    }: {
      continuation: PrincipalContinuation;
      submissionContext: GeoObservationCorrectionContext;
      values: GeoObservationCorrectionFormValues;
    }) => createGeoObservation(
      toGeoObservationCorrectionCreate(submissionContext, values),
      csrfToken,
    ),
  });
  const upload = useGeoEvidenceUpload({
    csrfToken,
    disabled: create.isPending || Boolean(created) || contextStale,
    onBlockingChange: updateUploadBlocking,
    onUploaded: (file) => {
      if (!mounted.current || acceptedId.current || uploadedFilesRef.current.some((item) => item.id === file.id)) return;
      const next = [...uploadedFilesRef.current, file];
      uploadedFilesRef.current = next;
      setUploadedFiles(next);
      form.setValue('attachment_file_ids', next.map((item) => item.id), { shouldDirty: true, shouldValidate: true });
    },
  });
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const contextChanged = Boolean(contextQuery.data && contextSignature(contextQuery.data) !== contextSignature(context));
  useEffect(() => {
    if (!acceptedId.current && (contextQuery.isError || contextChanged)) setContextStale(true);
  }, [contextQuery.isError, contextChanged, setContextStale]);

  const openCreated = useCallback(async (id: string, continuation: PrincipalContinuation) => {
    if (!continuation.isCurrent()) return;
    setNavigationError(undefined);
    try {
      await onCreated(id);
      if (!continuation.isCurrent()) return;
    } catch (error) {
      if (continuation.isCurrent() && mounted.current) setNavigationError(errorMessage(error));
    }
  }, [onCreated]);
  const handoffStarted = useRef(false);

  useEffect(() => {
    if (created && !isDirty && !handoffStarted.current && created.continuation.isCurrent()) {
      handoffStarted.current = true;
      void openCreated(created.id, created.continuation);
    }
  }, [created, isDirty, openCreated]);

  function submissionBlocked() {
    const current = queryClient.getQueryState<GeoObservationCorrectionContext>(geoKeys.correctionContext(observationId));
    return blocked || acceptedId.current || uploadBlockingRef.current || current?.status !== 'success'
      || current.fetchStatus !== 'idle' || !current.data
      || contextSignature(current.data) !== contextSignature(context);
  }

  async function submit(values: GeoObservationCorrectionFormValues) {
    if (submissionBlocked()) return;
    const submissionContext = context;
    const continuation = capturePrincipalContinuation(queryClient);
    form.clearErrors();
    setRequestId(undefined);
    create.reset();
    try {
      const observation = await create.mutateAsync({
        continuation,
        submissionContext,
        values,
      });
      if (!continuation.isCurrent()) return;
      acceptedId.current = observation.id;
      if (mounted.current) {
        form.reset(values);
        setCreated({ continuation, id: observation.id });
        setContextStale(true);
      }
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: geoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.details() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.correctionContexts() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.detail(observation.id) }),
        queryClient.invalidateQueries({ queryKey: geoKeys.insights() }),
        queryClient.invalidateQueries({ queryKey: geoKeys.topicLists() }),
        queryClient.invalidateQueries({
          queryKey: productsKeys.detail(submissionContext.detail.product.id),
        }),
      ]);
    } catch (error) {
      if (!continuation.isCurrent() || !mounted.current) return;
      const mapped = mapGeoObservationCorrectionError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<GeoObservationCorrectionFormValues>, {
          type: 'server',
          message,
        });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      if (mapped.code && conflictCodes.has(mapped.code)) setContextStale(true);
      setRequestId(mapped.requestId);
      queueMicrotask(() => {
        summaryContainer.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
      });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current || submissionBlocked()) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    void form.handleSubmit(submit, () => {
      create.reset();
      setRequestId(undefined);
    })(event).finally(() => {
      submitting.current = false;
    });
  }

  async function reloadContext() {
    if (reloading || acceptedId.current) return;
    setReloading(true);
    setContextStale(true);
    try {
      const result = await contextQuery.refetch();
      if (!mounted.current) return;
      if (!result.isSuccess || result.isFetching || !result.data) {
        form.setError('root.server', { type: 'server', message: errorMessage(result.error) });
        return;
      }
      const merged = mergeCorrectionValues(result.data, form.getValues());
      setContext(result.data);
      form.reset(merged, { keepDirty: true });
      if (result.data.detail.chain_tail_id.toLowerCase() !== observationId.toLowerCase()) {
        await onCanonicalChange(result.data.detail.chain_tail_id);
      }
      if (!mounted.current) return;
      form.clearErrors('root.server');
      setContextStale(false);
      setRequestId(undefined);
    } catch (error) {
      if (mounted.current) form.setError('root.server', { type: 'server', message: errorMessage(error) });
    } finally {
      if (mounted.current) setReloading(false);
    }
  }

  const tail = tailManualHistory(context.detail);
  const articleResults = useWatch({ control: form.control, name: 'article_results' });
  const summaryErrors = buildSummaryErrors(
    form.formState.errors,
    context.correction_article_results,
  );
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  const topicUnavailable = tail.query_topic === null && context.query_topic_options.length === 0;
  const locked = create.isPending || Boolean(created);
  const blocked = locked
    || reloading
    || uploadBlocking
    || upload.busy
    || Boolean(upload.pendingIntent)
    || contextQuery.isFetching
    || contextQuery.isError
    || contextChanged
    || contextStale
    || context.correction_article_results.length === 0
    || topicUnavailable;
  const actions: StickyAction[] = [
    {
      key: 'cancel',
      label: '返回当前 Detail',
      intent: 'secondary',
      enabled: !locked,
      disabledReason: '正在追加更正',
      onSelect: () => onCancel(context.detail.chain_tail_id),
    },
    {
      key: 'correct',
      label: create.isPending ? '提交中…' : '追加 Correction',
      intent: 'primary',
      enabled: !blocked,
      disabledReason: created ? '更正已创建' : uploadBlocking ? '请先完成或放弃证据上传' : contextQuery.isFetching ? '正在读取最新上下文' : correctionDisabledReason({
        contextStale,
        createPending: create.isPending,
        hasArticles: context.correction_article_results.length > 0,
        topicUnavailable,
      }),
      onSelect: () => formElement.current?.requestSubmit(),
    },
  ];

  return (
    <section aria-labelledby="geo-correction-title" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="warning">追加式 Correction</Badge>
          <Badge variant="outline">历史只读</Badge>
        </div>
        <h1 className="type-page-title" id="geo-correction-title">更正 GEO Observation</h1>
        <p className="max-w-3xl text-text-secondary">
          本页会追加一条新的 Correction，不会编辑或覆盖原 Observation、历史事实或历史证据。
        </p>
      </header>

      <FormProvider {...form}>
        <form className="min-w-0 space-y-4" noValidate onSubmit={handleSubmit} ref={formElement}>
          <div ref={summaryContainer}>
            <ErrorSummary errors={summaryErrors} title="GEO Correction 尚未提交" />
          </div>
          {created && (
            <div role="status" className="space-y-2 rounded-lg border border-border-subtle p-3">
              <p>更正已创建：{created.id}</p>
              {navigationError && <p role="alert">打开新观测失败：{navigationError}</p>}
              <Button onClick={() => void openCreated(created.id, capturePrincipalContinuation(queryClient))} type="button" variant="outline">打开新观测</Button>
            </div>
          )}
          {!created && contextQuery.error && (
            <InlineProblem
              message={`后台刷新失败，已保留当前上下文与草稿：${errorMessage(contextQuery.error)}`}
              onRetry={() => void reloadContext()}
            />
          )}
          {!created && (contextStale || contextChanged) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
              <span>更正链尾或 Published Article 候选已经变化。草稿与本次上传仍保留，系统不会自动重放提交。</span>
              <Button disabled={reloading} onClick={() => void reloadContext()} type="button" variant="outline">
                重新加载最新上下文
              </Button>
            </div>
          )}
          <WorkspaceShell
            ariaLabel="GEO Observation 更正工作区"
            context={{
              label: 'Original / 当前尾',
              content: <HistoryContextPanel context={context} />,
            }}
            main={{
              label: '本次更正事实',
              content: (
                <CorrectionMainPanel
                  articleResults={articleResults}
                  context={context}
                  disabled={locked || contextStale || contextChanged || contextQuery.isError}
                />
              ),
            }}
            reference={{
              label: '新证据与原因',
              content: (
                <CorrectionReferencePanel
                  upload={upload}
                  disabled={locked || contextStale || contextChanged || contextQuery.isError}
                  onRemove={(fileId) => {
                    if (acceptedId.current) return;
                    const next = uploadedFilesRef.current.filter((item) => item.id !== fileId);
                    uploadedFilesRef.current = next;
                    setUploadedFiles(next);
                    form.setValue('attachment_file_ids', next.map((item) => item.id), {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  uploadedFiles={uploadedFiles}
                />
              ),
            }}
          />
          <StickyActionBar
            actions={actions}
            status={(
              <span aria-live="polite">
                {created
                  ? '更正已创建，可打开新观测'
                  : create.isPending
                    ? '正在由服务端复核当前链尾、文章集合与证据…'
                  : contextStale
                    ? '上下文已过期，必须显式重新加载'
                    : `下一节点将追加到 ${context.detail.chain_tail_id}`}
              </span>
            )}
          />
        </form>
      </FormProvider>
      <DirtyGuard
        description="离开后，本次更正事实、原因和已上传证据选择将会丢失。"
        when={!created && (isDirty || uploadBlocking || create.isPending)}
      />
    </section>
  );
}

function HistoryContextPanel({ context }: { context: GeoObservationCorrectionContext }) {
  return (
    <div className="space-y-4 p-4">
      <dl className="space-y-3">
        <Metadata label="Product" value={context.detail.product.label} />
        <Metadata
          label="Current tail"
          mono
          value={context.detail.chain_tail_id}
        />
      </dl>
      <ol className="space-y-3">
        {context.detail.correction_history.map((item, index) => (
          <li key={item.observation.id}>
            <details
              className="rounded-lg border border-border-subtle p-3"
              open={item.is_original || item.is_chain_tail}
            >
              <summary className="cursor-pointer font-medium text-text-primary">
                {item.is_original ? 'Original' : `Correction ${index}`}
                {item.is_chain_tail ? ' · 当前尾' : ''}
              </summary>
              <HistoryNode item={item} />
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HistoryNode({ item }: { item: ManualHistoryItem }) {
  const observation = item.observation;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <dl className="space-y-2">
        <Metadata label="Query Topic" value={item.query_topic?.canonical_question ?? '历史未记录'} />
        <Metadata label="GEO platform" value={observation.search_platform} />
        <Metadata label="Search query" value={observation.search_query} />
        <Metadata label="Tested at" value={<Time value={observation.tested_at} />} />
        <Metadata
          label="Recorder"
          value={`${observation.recorder.display_name}（@${observation.recorder.username}）`}
        />
        <Metadata label="Observation ID" mono value={observation.id} />
      </dl>
      <div className="space-y-2">
        <h3 className="type-label">历史文章事实</h3>
        {observation.article_results.map((result) => (
          <div className="rounded-md bg-muted/30 p-2" key={result.published_article_id}>
            <a className="break-words font-medium text-link hover:underline" href={result.final_url} rel="noreferrer" target="_blank">
              {result.title}
            </a>
            <p className="text-xs text-text-muted">{result.platform_name}</p>
            <p className="mt-1 text-xs text-text-secondary">
              发现：{formatBoolean(result.discovered)} · 提及：{formatBoolean(result.mentioned)} · 准确性：{formatAccuracy(result.accuracy)}
            </p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="type-label">历史 Evidence</h3>
        {item.evidence.length ? (
          <ul className="space-y-1">
            {item.evidence.map((evidence) => (
              <li key={evidence.file.id}>
                <a className="break-all text-link hover:underline" href={evidence.download.url} rel="noreferrer" target="_blank">
                  {evidence.file.original_filename}
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="text-text-muted">无</p>}
      </div>
      <div>
        <h3 className="type-label">Notes</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-text-secondary">
          {observation.notes || '无备注'}
        </p>
      </div>
    </div>
  );
}

function CorrectionMainPanel({
  articleResults,
  context,
  disabled,
}: {
  articleResults: GeoObservationCorrectionFormValues['article_results'];
  context: GeoObservationCorrectionContext;
  disabled: boolean;
}) {
  const tail = tailManualHistory(context.detail);
  return (
    <div className="space-y-5 p-4">
      <div className="rounded-lg border border-border-subtle bg-muted/30 p-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metadata label="Product（冻结）" value={context.detail.product.label} />
          <Metadata label="GEO platform（冻结）" value={tail.observation.search_platform} />
        </dl>
        <div className="mt-3">
          <Metadata label="Search query（冻结）" value={tail.observation.search_query} />
        </div>
      </div>
      {tail.query_topic ? (
        <Metadata label="Query Topic（冻结）" value={tail.query_topic.canonical_question} />
      ) : (
        <FormField<GeoObservationCorrectionFormValues, 'query_topic_id'>
          description="历史记录没有 Query Topic；首次更正必须补全真实 Topic，后续节点将冻结该值。"
          id={fieldIds.query_topic_id}
          label="补全 Query Topic"
          name="query_topic_id"
          required
          render={(field) => (
            <FormSelect
              context={field}
              disabled={disabled || context.query_topic_options.length === 0}
              items={context.query_topic_options.map((item) => ({
                label: item.canonical_question,
                value: item.id,
              }))}
              onChange={field.field.onChange}
              placeholder="选择 Query Topic"
              value={field.field.value}
            />
          )}
        />
      )}
      <FormField<GeoObservationCorrectionFormValues, 'tested_at'>
        description="记录本次重新观测的时间，不复制历史时间。"
        id={fieldIds.tested_at}
        label="本次观测时间"
        name="tested_at"
        required
        render={(field) => (
          <Input
            {...inputAria(field)}
            {...field.field}
            disabled={disabled}
            id={field.inputId}
            type="datetime-local"
          />
        )}
      />
      <section className="space-y-3" aria-labelledby="geo-correction-articles-title">
        <div>
          <h2 className="type-section-title" id="geo-correction-articles-title">当前 Published Article 事实</h2>
          <p className="mt-1 text-sm text-text-secondary">
            集合由服务端当前快照提供；未知事实必须显式选择，准确性可以留空。
          </p>
        </div>
        {context.correction_article_results.length === 0 && (
          <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3" role="status">
            <p>该 Product 当前没有符合 GEO 资格的 Published Article，无法追加 Correction。</p>
            <a className={buttonVariants({ variant: 'outline' })} href="/publishing/articles?page=1&pageSize=20">
              查看 Published Articles
            </a>
          </div>
        )}
        {context.correction_article_results.map((article, index) => (
          <fieldset className="min-w-0 space-y-4 rounded-xl border border-border-subtle p-4" key={article.published_article_id}>
            <legend className="max-w-full px-1 font-medium text-text-primary">{article.title}</legend>
            <div className="min-w-0 text-sm text-text-secondary">
              <p>{article.platform_name}</p>
              <a className="break-all text-link hover:underline" href={article.final_url} rel="noreferrer" target="_blank">
                打开 Published Article
              </a>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <ArticleSelect disabled={disabled} index={index} kind="discovered" label="是否发现" value={articleResults[index]?.discovered ?? null} />
              <ArticleSelect disabled={disabled} index={index} kind="mentioned" label="是否提及" value={articleResults[index]?.mentioned ?? null} />
              <AccuracySelect disabled={disabled} index={index} value={articleResults[index]?.accuracy ?? null} />
            </div>
          </fieldset>
        ))}
      </section>
    </div>
  );
}

function CorrectionReferencePanel({
  upload,
  disabled,
  onRemove,
  uploadedFiles,
}: {
  upload: GeoEvidenceUploadController;
  disabled: boolean;
  onRemove: (fileId: string) => void;
  uploadedFiles: FileRecord[];
}) {
  return (
    <div className="space-y-5 p-4">
      <section className="space-y-3" aria-labelledby="geo-correction-evidence-title">
        <div>
          <h2 className="type-section-title" id="geo-correction-evidence-title">本次新 Evidence</h2>
          <p className="mt-1 text-sm text-text-secondary">
            历史证据只在左侧读取；POST 只关联这里新上传的截图。
          </p>
        </div>
        <GeoEvidenceUploadView controller={upload} />
        {uploadedFiles.length > 0 && (
          <ul className="space-y-2">
            {uploadedFiles.map((file) => (
              <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border-subtle p-2 text-sm" key={file.id}>
                <span className="min-w-0 break-all">{file.original_filename}</span>
                <Button disabled={disabled} onClick={() => onRemove(file.id)} size="sm" type="button" variant="outline">
                  移除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <FormField<GeoObservationCorrectionFormValues, 'notes'>
        description="填写本次更正原因或人工说明；不会覆盖历史 Notes。"
        id={fieldIds.notes}
        label="更正原因 / Notes"
        name="notes"
        render={(field) => (
          <Textarea
            {...inputAria(field)}
            {...field.field}
            disabled={disabled}
            id={field.inputId}
            rows={6}
          />
        )}
      />
    </div>
  );
}

function ArticleSelect({
  disabled,
  index,
  kind,
  label,
  value,
}: {
  disabled: boolean;
  index: number;
  kind: 'discovered' | 'mentioned';
  label: string;
  value: boolean | null;
}) {
  const name = `article_results.${index}.${kind}` as const;
  const id = `geo-correction-article-${index}-${kind}`;
  return (
    <FormField<GeoObservationCorrectionFormValues, typeof name>
      id={id}
      label={label}
      name={name}
      required
      render={(field) => (
        <FormSelect
          context={field}
          disabled={disabled}
          items={[{ label: '是', value: 'true' }, { label: '否', value: 'false' }]}
          onChange={(next) => field.field.onChange(next === 'true')}
          placeholder="请选择"
          value={value === null ? '' : String(value)}
        />
      )}
    />
  );
}

function AccuracySelect({
  disabled,
  index,
  value,
}: {
  disabled: boolean;
  index: number;
  value: string | null;
}) {
  const name = `article_results.${index}.accuracy` as const;
  return (
    <FormField<GeoObservationCorrectionFormValues, typeof name>
      id={`geo-correction-article-${index}-accuracy`}
      label="准确性"
      name={name}
      render={(field) => (
        <FormSelect
          context={field}
          disabled={disabled}
          items={[
            { label: '未判断', value: 'UNASSESSED' },
            ...accuracyValues.map((item) => ({ label: accuracyLabels[item], value: item })),
          ]}
          onChange={(next) => field.field.onChange(next === 'UNASSESSED' ? null : next)}
          placeholder="未判断"
          value={value ?? 'UNASSESSED'}
        />
      )}
    />
  );
}

type SelectContext = {
  inputId: string;
  'aria-describedby'?: string;
  'aria-invalid': boolean;
  'aria-required'?: boolean;
};

function FormSelect({
  context,
  disabled,
  items,
  onChange,
  placeholder,
  value,
}: {
  context: SelectContext;
  disabled: boolean;
  items: { label: string; value: string }[];
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <Select disabled={disabled} items={items} onValueChange={(next) => next && onChange(next)} value={value || null}>
      <SelectTrigger className="w-full max-w-full" id={context.inputId} {...inputAria(context)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Metadata({ label, mono, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-text-primary${mono ? ' font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{formatObservationTime(value)}</time>;
}

function InlineProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
      <span>{message}</span>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button>
    </div>
  );
}

function CorrectionFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">GEO Correction Workspace 无法加载</h1>
      <p className="break-words text-text-secondary">{errorMessage(error)}</p>
      <div className="flex flex-wrap gap-2">
        <a className={buttonVariants({ variant: 'outline' })} href="/geo/observations?page=1&pageSize=20">
          返回观测列表
        </a>
        <Button onClick={onRetry} type="button">重试</Button>
      </div>
    </section>
  );
}

function GeoObservationCorrectionSkeleton({ observationId }: { observationId: string }) {
  return (
    <section aria-busy="true" className="min-w-0 space-y-4">
      <div className="space-y-2">
        <p className="type-label text-text-muted">GEO Correction Workspace</p>
        <h1 className="type-page-title">正在加载更正上下文</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{observationId}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        <Skeleton className="h-80" />
        <Skeleton className="h-[32rem]" />
        <Skeleton className="h-80" />
      </div>
    </section>
  );
}

function inputAria(context: SelectContext) {
  return {
    'aria-describedby': context['aria-describedby'],
    'aria-invalid': context['aria-invalid'],
    'aria-required': context['aria-required'],
  };
}

function buildSummaryErrors(
  errors: ReturnType<typeof useForm<GeoObservationCorrectionFormValues>>['formState']['errors'],
  articles: readonly components['schemas']['GeoArticleResult'][],
) {
  const summary: ErrorSummaryItem[] = [];
  for (const field of Object.keys(fieldIds) as (keyof typeof fieldIds)[]) {
    const message = errors[field]?.message;
    if (typeof message === 'string') {
      summary.push({ id: field, fieldId: fieldIds[field], message });
    }
  }
  if (typeof errors.article_results?.message === 'string') {
    summary.push({ id: 'article-results', message: errors.article_results.message });
  }
  articles.forEach((article, index) => {
    const row = errors.article_results?.[index];
    for (const field of ['discovered', 'mentioned', 'accuracy'] as const) {
      const message = row?.[field]?.message;
      if (typeof message === 'string') {
        summary.push({
          id: `article-${index}-${field}`,
          fieldId: `geo-correction-article-${index}-${field}`,
          message: `${article.title}：${message}`,
        });
      }
    }
  });
  return summary;
}

function correctionDisabledReason(state: {
  contextStale: boolean;
  createPending: boolean;
  hasArticles: boolean;
  topicUnavailable: boolean;
}) {
  if (state.createPending) return '正在追加更正';
  if (state.contextStale) return '请先重新加载最新上下文';
  if (!state.hasArticles) return '当前 Product 没有合格 Published Article';
  if (state.topicUnavailable) return '历史 Topic 为空且当前没有可选 Query Topic';
  return undefined;
}

// 只比较可写上下文；历史选中节点与短期下载 URL 不改变更正身份。
function contextSignature(context: GeoObservationCorrectionContext) {
  const tail = tailManualHistory(context.detail);
  return JSON.stringify({
    root: context.detail.chain_root_id,
    product: context.detail.product.id,
    tail: tail.observation,
    topic: tail.query_topic,
    articles: context.correction_article_results,
    options: context.query_topic_options,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export {
  GeoObservationCorrectionPage,
  GeoObservationCorrectionSkeleton,
};
export type { GeoObservationCorrectionPageProps };
