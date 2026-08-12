import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormProvider, useForm, useWatch, type FieldPath } from 'react-hook-form';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { StickyActionBar, type StickyAction } from '@/design-system/workspace/sticky-action-bar';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import { productsKeys, productsListQueryOptions } from '@/domains/product/product.api';
import type { components } from '@/shared/api/generated/schema';
import {
  createGeoObservation,
  geoKeys,
  geoPublicationCandidatesQueryOptions,
  queryTopicsQueryOptions,
} from './geo.api';
import { GeoEvidenceUpload } from './geo-evidence-upload';
import {
  accuracyLabels,
  accuracyValues,
  emptyGeoObservationValues,
  mapGeoObservationCreateError,
  newGeoObservationFormSchema,
  syncArticleResults,
  toGeoObservationCreate,
  type NewGeoObservationField,
  type NewGeoObservationFormValues,
} from './new-geo-observation.model';

type FileRecord = components['schemas']['FileRecord'];
type GeoPublicationCandidateList = components['schemas']['GeoPublicationCandidateList'];
type ProductList = components['schemas']['ProductList'];
type ProductListItem = components['schemas']['ProductListItem'];
type QueryTopic = components['schemas']['QueryTopic'];
type QueryTopicList = components['schemas']['QueryTopicList'];

type NewGeoObservationPageProps = {
  csrfToken: string | null;
  onCancel: () => void;
  onCreated: () => void;
};

const fieldIds: Record<Exclude<NewGeoObservationField, 'article_results' | 'attachment_file_ids'>, string> = {
  product_id: 'new-geo-product',
  query_topic_id: 'new-geo-query-topic',
  search_platform: 'new-geo-platform',
  search_query: 'new-geo-search-query',
  tested_at: 'new-geo-tested-at',
  notes: 'new-geo-notes',
};
const textareaClass = 'min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-text-secondary';

function NewGeoObservationPage({
  csrfToken,
  onCancel,
  onCreated,
}: NewGeoObservationPageProps) {
  const queryClient = useQueryClient();
  const [productSearch, setProductSearch] = useState('');
  const [productSearchInput, setProductSearchInput] = useState('');
  const [requestId, setRequestId] = useState<string>();
  const [candidateStale, setCandidateStale] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
  const [created, setCreated] = useState(false);
  const submitting = useRef(false);
  const formElement = useRef<HTMLFormElement>(null);
  const form = useForm<NewGeoObservationFormValues>({
    defaultValues: emptyGeoObservationValues(),
    resolver: zodResolver(newGeoObservationFormSchema),
  });
  const selectedProductId = useWatch({ control: form.control, name: 'product_id' });
  const productsSearch = useMemo(() => ({
    q: productSearch || undefined,
    page: 1,
    pageSize: 20 as const,
    sort: 'UPDATED_DESC' as const,
  }), [productSearch]);
  const products = useQuery(productsListQueryOptions(productsSearch));
  const topics = useQuery(queryTopicsQueryOptions());
  const candidates = useQuery(geoPublicationCandidatesQueryOptions(selectedProductId));
  const create = useMutation({
    mutationFn: (values: NewGeoObservationFormValues) => (
      createGeoObservation(toGeoObservationCreate(values), csrfToken)
    ),
  });
  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (!candidates.data) return;
    form.setValue(
      'article_results',
      syncArticleResults(candidates.data.items, form.getValues('article_results')),
      { shouldDirty: isDirty, shouldValidate: false },
    );
  }, [candidates.data, form, isDirty]);

  useEffect(() => {
    if (created && !isDirty) onCreated();
  }, [created, isDirty, onCreated]);

  async function submit(values: NewGeoObservationFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    create.reset();
    try {
      await create.mutateAsync(values);
      form.reset(values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: geoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: productsKeys.detail(values.product_id) }),
      ]);
      setCreated(true);
    } catch (error) {
      const mapped = mapGeoObservationCreateError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<NewGeoObservationFormValues>, {
          type: 'server',
          message,
        });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setCandidateStale(mapped.code === 'GEO_PUBLICATIONS_CHANGED');
      setRequestId(mapped.requestId);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) {
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

  async function refreshCandidates() {
    const result = await candidates.refetch();
    if (result.data) {
      form.clearErrors('root.server');
      setCandidateStale(false);
      setRequestId(undefined);
    }
  }

  const articleResults = useWatch({ control: form.control, name: 'article_results' });
  const summaryErrors = buildSummaryErrors(form.formState.errors, candidates.data?.items ?? []);
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  const blocked = create.isPending
    || products.isPending
    || topics.isPending
    || Boolean(products.error)
    || Boolean(topics.error)
    || !topics.data?.items.length
    || candidateStale
    || !selectedProductId
    || !candidates.data?.items.length;
  const actions: StickyAction[] = [
    {
      key: 'cancel',
      label: '取消',
      intent: 'secondary',
      enabled: !create.isPending,
      disabledReason: '正在创建观测',
      onSelect: onCancel,
    },
    {
      key: 'create',
      label: create.isPending ? '创建中…' : '创建 Observation',
      intent: 'primary',
      enabled: !blocked,
      disabledReason: submitDisabledReason({
        candidateStale,
        candidates: candidates.data?.items.length ?? 0,
        createPending: create.isPending,
        productsFailed: Boolean(products.error),
        productsPending: products.isPending,
        selectedProductId,
        topicsFailed: Boolean(topics.error),
        topicsPending: topics.isPending,
        topics: topics.data?.items.length ?? 0,
      }),
      onSelect: () => formElement.current?.requestSubmit(),
    },
  ];

  return (
    <section aria-labelledby="new-geo-observation-title" className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h1 className="type-page-title" id="new-geo-observation-title">新建 GEO Observation</h1>
        <p className="max-w-3xl text-text-secondary">
          记录一次人工站外搜索，并逐篇提交当前产品全部可观测 Published Article 的独立事实。
        </p>
      </header>

      <FormProvider {...form}>
        <form className="min-w-0 space-y-4" noValidate onSubmit={handleSubmit} ref={formElement}>
          <ErrorSummary errors={summaryErrors} title="GEO Observation 尚未创建" />
          {candidateStale && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
              <span>Published Article 候选已经变化。请重新读取后确认新增或移除的文章。</span>
              <Button onClick={() => void refreshCandidates()} type="button" variant="outline">
                重新读取候选
              </Button>
            </div>
          )}
          <WorkspaceShell
            ariaLabel="新建 GEO Observation 工作区"
            context={{
              label: '观测上下文',
              content: (
                <ContextPanel
                  createPending={create.isPending}
                  onProductSearch={() => setProductSearch(productSearchInput.trim())}
                  onProductSearchInput={setProductSearchInput}
                  productSearchInput={productSearchInput}
                  products={products}
                  topics={topics}
                  onProductChange={(productId) => {
                    form.setValue('product_id', productId, { shouldDirty: true, shouldValidate: true });
                    form.setValue('article_results', [], { shouldDirty: true });
                    form.clearErrors('article_results');
                    setCandidateStale(false);
                  }}
                />
              ),
            }}
            main={{
              label: '逐篇观测结果',
              content: (
                <MainPanel
                  articleResults={articleResults}
                  candidates={candidates}
                  createPending={create.isPending}
                  selectedProductId={selectedProductId}
                />
              ),
            }}
            reference={{
              label: '证据与备注',
              content: (
                <ReferencePanel
                  createPending={create.isPending}
                  csrfToken={csrfToken}
                  onUploaded={(file) => {
                    if (uploadedFiles.some((item) => item.id === file.id)) return;
                    const next = [...uploadedFiles, file];
                    setUploadedFiles(next);
                    form.setValue('attachment_file_ids', next.map((item) => item.id), {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  onRemove={(fileId) => {
                    const next = uploadedFiles.filter((item) => item.id !== fileId);
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
            status={<span aria-live="polite">{create.isPending ? '正在提交并由服务端校验候选…' : '尚未创建'}</span>}
          />
        </form>
      </FormProvider>
      <DirtyGuard when={isDirty} />
    </section>
  );
}

function ContextPanel({
  createPending,
  onProductChange,
  onProductSearch,
  onProductSearchInput,
  productSearchInput,
  products,
  topics,
}: {
  createPending: boolean;
  onProductChange: (productId: string) => void;
  onProductSearch: () => void;
  onProductSearchInput: (value: string) => void;
  productSearchInput: string;
  products: UseQueryResult<ProductList>;
  topics: UseQueryResult<QueryTopicList>;
}) {
  const productItems = products.data?.items ?? [];
  const topicItems = topics.data?.items ?? [];
  return (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <label className="type-label block" htmlFor="new-geo-product-search">搜索产品</label>
        <div className="flex gap-2">
          <Input
            disabled={createPending}
            id="new-geo-product-search"
            maxLength={200}
            onChange={(event) => onProductSearchInput(event.currentTarget.value)}
            placeholder="品牌或型号"
            value={productSearchInput}
          />
          <Button disabled={createPending} onClick={onProductSearch} type="button" variant="outline">搜索</Button>
        </div>
        {products.isPending && <p aria-live="polite" className="text-sm text-text-secondary">正在读取产品…</p>}
        {products.error && <QueryProblem error={products.error} onRetry={() => void products.refetch()} />}
        {products.data && productItems.length === 0 && <p className="text-sm text-text-secondary">没有匹配产品。</p>}
      </div>
      <FormField<NewGeoObservationFormValues, 'product_id'>
        description="搜索结果来自服务端；选择后再读取该产品的权威文章候选。"
        id={fieldIds.product_id}
        label="Product"
        name="product_id"
        required
        render={(context) => (
          <FormSelect
            context={context}
            disabled={createPending || products.isPending || Boolean(products.error)}
            items={productItems.map(productOption)}
            onChange={onProductChange}
            placeholder="选择产品"
            value={context.field.value}
          />
        )}
      />
      <FormField<NewGeoObservationFormValues, 'query_topic_id'>
        description="使用已配置的标准 Query Topic，不在本页创建或推导问题主题。"
        id={fieldIds.query_topic_id}
        label="Query Topic"
        name="query_topic_id"
        required
        render={(context) => (
          <>
            <FormSelect
              context={context}
              disabled={createPending || topics.isPending || Boolean(topics.error)}
              items={topicItems.map(topicOption)}
              onChange={context.field.onChange}
              placeholder="选择 Query Topic"
              value={context.field.value}
            />
            {topics.isPending && <p aria-live="polite" className="mt-2 text-sm text-text-secondary">正在读取 Query Topic…</p>}
            {topics.error && <QueryProblem error={topics.error} onRetry={() => void topics.refetch()} />}
            {topics.data && topicItems.length === 0 && (
              <p className="mt-2 text-sm text-warning" role="status">当前没有 Query Topic，暂时无法创建 Observation。</p>
            )}
          </>
        )}
      />
      <FormField<NewGeoObservationFormValues, 'search_platform'>
        description="填写实际执行人工搜索的 GEO 平台。"
        id={fieldIds.search_platform}
        label="GEO platform"
        name="search_platform"
        required
        render={(context) => (
          <Input {...inputAria(context)} {...context.field} disabled={createPending} id={context.inputId} maxLength={160} placeholder="例如 DeepSeek" />
        )}
      />
      <FormField<NewGeoObservationFormValues, 'tested_at'>
        id={fieldIds.tested_at}
        label="观测时间"
        name="tested_at"
        required
        render={(context) => (
          <Input {...inputAria(context)} {...context.field} disabled={createPending} id={context.inputId} type="datetime-local" />
        )}
      />
    </div>
  );
}

function MainPanel({
  articleResults,
  candidates,
  createPending,
  selectedProductId,
}: {
  articleResults: NewGeoObservationFormValues['article_results'];
  candidates: UseQueryResult<GeoPublicationCandidateList>;
  createPending: boolean;
  selectedProductId: string;
}) {
  return (
    <div className="space-y-5 p-4">
      <FormField<NewGeoObservationFormValues, 'search_query'>
        description="填写在 GEO 平台实际提交的问题；不使用 Query Topic 文案自动代填。"
        id={fieldIds.search_query}
        label="实际搜索问题"
        name="search_query"
        required
        render={(context) => (
          <textarea {...inputAria(context)} {...context.field} className={textareaClass} disabled={createPending} id={context.inputId} rows={3} />
        )}
      />
      <div className="space-y-3">
        <div>
          <h2 className="type-section-title">Published Article 结果</h2>
          <p className="mt-1 text-sm text-text-secondary">发现、提及互相独立且必须显式选择；准确性可以留空。</p>
        </div>
        {!selectedProductId && <p className="rounded-lg border border-border-subtle p-3 text-sm text-text-secondary">请先选择 Product。</p>}
        {selectedProductId && candidates.isLoading && <p aria-live="polite" className="rounded-lg border border-border-subtle p-3 text-sm text-text-secondary">正在读取权威 Published Article 候选…</p>}
        {selectedProductId && candidates.error && <QueryProblem error={candidates.error} onRetry={() => void candidates.refetch()} />}
        {candidates.data && candidates.data.items.length === 0 && (
          <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3" role="status">
            <p>该 Product 当前没有符合 GEO 资格的 Published Article，无法创建 Observation。</p>
            <a className={buttonVariants({ variant: 'outline' })} href="/publishing/articles?page=1&pageSize=20">查看 Published Articles</a>
          </div>
        )}
        {candidates.data?.items.map((candidate, index) => (
          <fieldset className="min-w-0 space-y-4 rounded-xl border border-border-subtle p-4" key={candidate.published_article_id}>
            <legend className="max-w-full px-1 font-medium text-text-primary">{candidate.title}</legend>
            <div className="min-w-0 text-sm text-text-secondary">
              <p>{candidate.platform_name}</p>
              <a className="break-all text-link underline-offset-2 hover:underline" href={candidate.final_url} rel="noreferrer" target="_blank">打开 Published Article</a>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <ArticleSelect index={index} kind="discovered" label="是否发现" value={articleResults[index]?.discovered ?? null} disabled={createPending} />
              <ArticleSelect index={index} kind="mentioned" label="是否提及" value={articleResults[index]?.mentioned ?? null} disabled={createPending} />
              <AccuracySelect index={index} value={articleResults[index]?.accuracy ?? null} disabled={createPending} />
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function ReferencePanel({
  createPending,
  csrfToken,
  onRemove,
  onUploaded,
  uploadedFiles,
}: {
  createPending: boolean;
  csrfToken: string | null;
  onRemove: (fileId: string) => void;
  onUploaded: (file: FileRecord) => void;
  uploadedFiles: FileRecord[];
}) {
  return (
    <div className="space-y-5 p-4">
      <section className="space-y-3" aria-labelledby="new-geo-evidence-title">
        <div>
          <h2 className="type-section-title" id="new-geo-evidence-title">Evidence attachments</h2>
          <p className="mt-1 text-sm text-text-secondary">可选截图只作为人工证据，系统不会解析或推导结果。</p>
        </div>
        <GeoEvidenceUpload csrfToken={csrfToken} disabled={createPending} onUploaded={onUploaded} />
        {uploadedFiles.length > 0 && (
          <ul className="space-y-2">
            {uploadedFiles.map((file) => (
              <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border-subtle p-2 text-sm" key={file.id}>
                <span className="min-w-0 break-all">{file.original_filename}</span>
                <Button disabled={createPending} onClick={() => onRemove(file.id)} size="sm" type="button" variant="outline">移除</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <FormField<NewGeoObservationFormValues, 'notes'>
        description="可选人工说明；不用于替代逐篇事实。"
        id={fieldIds.notes}
        label="Notes"
        name="notes"
        render={(context) => (
          <textarea {...inputAria(context)} {...context.field} className={textareaClass} disabled={createPending} id={context.inputId} rows={5} />
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
  const id = `new-geo-article-${index}-${kind}`;
  return (
    <FormField<NewGeoObservationFormValues, typeof name>
      id={id}
      label={label}
      name={name}
      required
      render={(context) => (
        <FormSelect
          context={context}
          disabled={disabled}
          items={[{ label: '是', value: 'true' }, { label: '否', value: 'false' }]}
          onChange={(next) => context.field.onChange(next === 'true')}
          placeholder="请选择"
          value={value === null ? '' : String(value)}
        />
      )}
    />
  );
}

function AccuracySelect({ disabled, index, value }: { disabled: boolean; index: number; value: string | null }) {
  const name = `article_results.${index}.accuracy` as const;
  return (
    <FormField<NewGeoObservationFormValues, typeof name>
      id={`new-geo-article-${index}-accuracy`}
      label="准确性"
      name={name}
      render={(context) => (
        <FormSelect
          context={context}
          disabled={disabled}
          items={[
            { label: '未判断', value: 'UNASSESSED' },
            ...accuracyValues.map((item) => ({ label: accuracyLabels[item], value: item })),
          ]}
          onChange={(next) => context.field.onChange(next === 'UNASSESSED' ? null : next)}
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

function QueryProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
      <p>{errorMessage(error)}</p>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button>
    </div>
  );
}

function productOption(product: ProductListItem) {
  return { value: product.id, label: `${product.brand} · ${product.part_number}` };
}

function topicOption(topic: QueryTopic) {
  return { value: topic.id, label: topic.canonical_question };
}

function inputAria(context: SelectContext) {
  return {
    'aria-describedby': context['aria-describedby'],
    'aria-invalid': context['aria-invalid'],
    'aria-required': context['aria-required'],
  };
}

function buildSummaryErrors(
  errors: ReturnType<typeof useForm<NewGeoObservationFormValues>>['formState']['errors'],
  candidates: readonly components['schemas']['GeoPublicationCandidate'][],
) {
  const summary: ErrorSummaryItem[] = [];
  for (const field of Object.keys(fieldIds) as (keyof typeof fieldIds)[]) {
    const message = errors[field]?.message;
    if (typeof message === 'string') summary.push({ id: field, fieldId: fieldIds[field], message });
  }
  if (typeof errors.article_results?.message === 'string') {
    summary.push({ id: 'article-results', message: errors.article_results.message });
  }
  candidates.forEach((candidate, index) => {
    const row = errors.article_results?.[index];
    for (const field of ['discovered', 'mentioned', 'accuracy'] as const) {
      const message = row?.[field]?.message;
      if (typeof message === 'string') {
        summary.push({
          id: `article-${index}-${field}`,
          fieldId: `new-geo-article-${index}-${field}`,
          message: `${candidate.title}：${message}`,
        });
      }
    }
  });
  return summary;
}

function submitDisabledReason(state: {
  candidateStale: boolean;
  candidates: number;
  createPending: boolean;
  productsFailed: boolean;
  productsPending: boolean;
  selectedProductId: string;
  topicsFailed: boolean;
  topicsPending: boolean;
  topics: number;
}) {
  if (state.createPending) return '正在创建观测';
  if (state.productsPending || state.topicsPending) return '正在读取创建选项';
  if (state.productsFailed || state.topicsFailed) return '创建选项读取失败';
  if (state.topics === 0) return '当前没有可用 Query Topic';
  if (!state.selectedProductId) return '请先选择 Product';
  if (state.candidateStale) return '请先重新读取 Published Article 候选';
  if (state.candidates === 0) return '当前 Product 没有合格 Published Article';
  return undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { NewGeoObservationPage };
export type { NewGeoObservationPageProps };
