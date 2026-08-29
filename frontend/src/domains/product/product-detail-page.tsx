import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { RowActions } from '@/design-system/data-table/row-actions';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, FormActions, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline } from '@/design-system/workspace/timeline';
import type { components } from '@/shared/api/generated/schema';
import {
  deleteProduct,
  productDetailQueryOptions,
  productsKeys,
  updateProduct,
} from './product.api';
import {
  contentStageRegistry,
  formatProductRate,
  mapProductUpdateError,
  productActivityTargetHref,
  productDetailErrorKind,
  productToUpdateValues,
  productUpdateFormSchema,
  publicationStatusRegistry,
  toProductUpdate,
  type ProductDetail,
  type ProductUpdateField,
  type ProductUpdateFormValues,
} from './product-detail.model';
import { ProductDeletionConditionsDialog } from './product-deletion-dialog';
import {
  confidentialityRegistry,
  formatExactProductTime,
  productStatusRegistry,
  productWorkflowStageRegistry,
  resolveProductOverflowActions,
  resolveProductPrimaryAction,
  type Product,
} from './product.model';

type ProductList = components['schemas']['ProductList'];

type ProductDetailPageProps = {
  csrfToken: string | null;
  onDeleted: () => Promise<void>;
  productId: string;
};

function ProductDetailPage({ csrfToken, onDeleted, productId }: ProductDetailPageProps) {
  const queryClient = useQueryClient();
  const detail = useQuery(productDetailQueryOptions(productId));
  const [updateOpen, setUpdateOpen] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (product: Product) => deleteProduct(product, csrfToken),
    onSuccess: async (_data, product) => {
      queryClient.setQueriesData<ProductList>({ queryKey: productsKeys.lists() }, (current) => (
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== product.id),
              total: Math.max(0, current.total - 1),
            }
          : current
      ));
      await onDeleted();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsKeys.detail(product.id), refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: productsKeys.lists() }),
      ]);
    },
    onError: async () => {
      await detail.refetch();
    },
  });

  if (detail.isPending) return <ProductDetailSkeleton productId={productId} />;
  if (detail.error) {
    return (
      <ProductDetailFailure
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const product = detail.data.product;
  const primary = resolveProductPrimaryAction(product);
  const overflow = resolveProductOverflowActions(product, {
    deleting: remove.isPending,
    surface: 'detail',
  });

  function handleCommand(command: string) {
    if (command === 'update-product') {
      setUpdateOpen(true);
      return;
    }
    if (command === 'view-delete-conditions') {
      setConditionsOpen(true);
      return;
    }
    if (command === 'delete-product') {
      remove.mutate(product);
      return;
    }
    throw new Error(`Product Detail 收到未知页面命令：${command}`);
  }

  const conditionsVisible = conditionsOpen && Boolean(product.deletion?.blockers.length);

  return (
    <article className="min-w-0 space-y-4" aria-labelledby="product-detail-title">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="type-label text-text-muted">产品详情</p>
          <h1 className="break-words font-mono type-page-title" id="product-detail-title">
            {product.part_number}
          </h1>
          <p className="break-words text-text-secondary">{product.brand} · {product.category}</p>
        </div>
        <div className="min-w-0 sm:min-w-64">
          <RowActions
            objectLabel={product.part_number}
            onCommand={handleCommand}
            overflow={overflow}
            primary={primary}
          />
        </div>
      </header>

      {remove.error && (
        <InlineError error={remove.error} onClose={() => remove.reset()} />
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection title="摘要" description="服务端投影的当前产品阶段与可尝试动作。">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="产品状态">
              <StatusBadge presentation={productStatusRegistry[product.status]} />
            </SummaryItem>
            <SummaryItem label="Workflow stage">
              <StatusBadge presentation={productWorkflowStageRegistry[product.workflow_stage]} />
            </SummaryItem>
            <SummaryItem label="Primary task">
              <span>{primary.label}</span>
              <code className="mt-1 block break-all text-xs text-text-muted">{product.primary_task}</code>
            </SummaryItem>
            <SummaryItem label="Available actions">
              {product.available_actions.length > 0 ? (
                <ul className="flex flex-wrap gap-1" aria-label="可用动作">
                  {product.available_actions.map((action) => (
                    <li key={action}><Badge variant="outline">{action}</Badge></li>
                  ))}
                </ul>
              ) : <EmptyValue />}
            </SummaryItem>
          </div>
        </DetailSection>

        <DetailSection title="基本信息">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metadata label="型号" value={product.part_number} mono />
            <Metadata label="品牌" value={product.brand} />
            <Metadata label="类别" value={product.category} />
            <Metadata label="Revision" value={String(product.revision)} mono />
            <Metadata label="创建时间" value={<ProductTime value={product.created_at} />} />
            <Metadata label="最近更新" value={<ProductTime value={product.updated_at} />} />
          </dl>
        </DetailSection>

        <DetailSection title="事实" description="只展示事实版本摘要；正文在事实工作区和后续只读版本页处理。">
          <div className="grid gap-3 md:grid-cols-2">
            <FactSummary
              fact={detail.data.approved_fact}
              href={detail.data.approved_fact
                ? `/products/${encodeURIComponent(product.id)}/facts/versions/${encodeURIComponent(detail.data.approved_fact.id)}`
                : undefined}
              title="当前批准事实"
              timestampLabel="批准时间"
              timestamp={detail.data.approved_fact?.approved_at ?? null}
            />
            <FactSummary
              fact={detail.data.pending_fact}
              href={detail.data.pending_fact
                ? `/products/${encodeURIComponent(product.id)}/facts/versions/${encodeURIComponent(detail.data.pending_fact.id)}`
                : undefined}
              title="当前待审核或待修订事实"
              timestampLabel="创建时间"
              timestamp={detail.data.pending_fact?.created_at ?? null}
            />
          </div>
          <a
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border-default px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={`/products/${encodeURIComponent(product.id)}/facts/versions?page=1&pageSize=20`}
          >
            查看完整事实版本历史
          </a>
        </DetailSection>

        <DetailSection title="内容任务">
          <CompactSummary countLabel="任务数量" count={detail.data.content.task_count}>
            {detail.data.content.latest_task ? (
              <a
                className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={`/content/tasks/${encodeURIComponent(detail.data.content.latest_task.task_id)}`}
              >
                最近任务：{contentStageRegistry[detail.data.content.latest_task.workflow_stage]}
              </a>
            ) : <EmptyValue />}
          </CompactSummary>
        </DetailSection>

        <DetailSection title="发布成果">
          <CompactSummary countLabel="成果数量" count={detail.data.publishing.published_article_count}>
            {detail.data.publishing.latest ? (
              <a
                className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={detail.data.publishing.latest.article_id
                  ? `/publishing/articles/${encodeURIComponent(detail.data.publishing.latest.article_id)}`
                  : `/publishing/work/${encodeURIComponent(detail.data.publishing.latest.work_id)}`}
              >
                {detail.data.publishing.latest.actual_title ?? '最近发布工作'} · {publicationStatusRegistry[detail.data.publishing.latest.status]}
              </a>
            ) : <EmptyValue />}
          </CompactSummary>
        </DetailSection>

        <DetailSection title="GEO 摘要">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="观测数量" value={String(detail.data.geo.observation_count)} />
            <Metric label="逐篇结果" value={String(detail.data.geo.article_result_count)} />
            <Metric label="发现率" value={formatProductRate(detail.data.geo.discovery_rate)} />
            <Metric label="提及率" value={formatProductRate(detail.data.geo.mention_rate)} />
            <Metric label="准确率" value={formatProductRate(detail.data.geo.accuracy_rate)} />
          </dl>
        </DetailSection>

        <DetailSection title="最近 Activity" description="按服务端权威时间顺序展示最近十项。">
          <Timeline
            emptyMessage="暂无 Activity"
            items={detail.data.activity.map((item) => ({
              id: item.id,
              title: item.label,
              description: item.actor
                ? `${item.actor.display_name}（${item.actor.username}）`
                : '系统记录',
              meta: (
                <div className="flex flex-col items-end gap-1">
                  <ProductTime value={item.timestamp} />
                  <a
                    className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    href={productActivityTargetHref(product.id, item.target)}
                  >
                    查看{item.target.label}
                  </a>
                </div>
              ),
            }))}
          />
        </DetailSection>
      </div>

      {updateOpen && (
        <ProductUpdateDialog
          csrfToken={csrfToken}
          detail={detail.data}
          onClose={() => setUpdateOpen(false)}
          onRefresh={async () => (await detail.refetch()).data}
          onUpdated={async (canonical) => {
            queryClient.setQueryData<ProductDetail>(productsKeys.detail(product.id), (current) => (
              current ? { ...current, product: canonical } : current
            ));
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: productsKeys.detail(product.id) }),
              queryClient.invalidateQueries({ queryKey: productsKeys.lists() }),
            ]);
          }}
        />
      )}

      <ProductDeletionConditionsDialog
        onClose={() => setConditionsOpen(false)}
        onRefresh={async () => { await detail.refetch(); }}
        open={conditionsVisible}
        product={product}
        refreshing={detail.isFetching}
      />
    </article>
  );
}

function ProductDetailSkeleton({ productId }: { productId: string }) {
  return (
    <article className="min-w-0 space-y-4" aria-busy="true" aria-labelledby="product-detail-loading-title">
      <header className="space-y-2">
        <p className="type-label text-text-muted">产品详情</p>
        <h1 className="type-page-title" id="product-detail-loading-title">正在加载产品</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{productId}</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        {['摘要', '基本信息', '事实', '内容任务', '发布成果', 'GEO 摘要', '最近 Activity'].map((title) => (
          <DetailSection key={title} title={title}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </DetailSection>
        ))}
      </div>
    </article>
  );
}

function ProductDetailFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = productDetailErrorKind(error);
  const content = {
    'not-found': ['未找到产品', '该产品不存在，或已被删除。'],
    forbidden: ['无法访问产品详情', '当前会话没有读取该产品详情的权限。'],
    generic: ['产品详情加载失败', error instanceof Error ? error.message : '读取产品详情时发生未知错误。'],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href="/products">返回产品列表</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function ProductUpdateDialog({
  csrfToken,
  detail,
  onClose,
  onRefresh,
  onUpdated,
}: {
  csrfToken: string | null;
  detail: ProductDetail;
  onClose: () => void;
  onRefresh: () => Promise<ProductDetail | undefined>;
  onUpdated: (product: Product) => Promise<void>;
}) {
  const [requestId, setRequestId] = useState<string>();
  const form = useForm<ProductUpdateFormValues>({
    defaultValues: productToUpdateValues(detail.product),
    resolver: zodResolver(productUpdateFormSchema),
  });
  const update = useMutation({
    mutationFn: (values: ProductUpdateFormValues) => updateProduct(
      detail.product.id,
      toProductUpdate(values, detail.product.revision),
      csrfToken,
    ),
  });

  async function submit(values: ProductUpdateFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    try {
      const product = await update.mutateAsync(values);
      await onUpdated(product);
      form.reset(productToUpdateValues(product));
      onClose();
    } catch (error) {
      const mapped = mapProductUpdateError(error);
      if (mapped.refreshCanonical) {
        const canonical = await onRefresh() ?? detail;
        form.reset(productToUpdateValues(canonical.product));
      }
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as ProductUpdateField, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
    }
  }

  const fieldIds: Record<ProductUpdateField, string> = {
    part_number: 'update-product-part-number',
    brand: 'update-product-brand',
    category: 'update-product-category',
    status: 'update-product-status',
  };
  const summaryErrors: ErrorSummaryItem[] = (Object.keys(fieldIds) as ProductUpdateField[])
    .flatMap((field) => {
      const message = form.formState.errors[field]?.message;
      return message ? [{ id: field, fieldId: fieldIds[field], message }] : [];
    });
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });
  const statusItems = [
    { value: 'ACTIVE', label: productStatusRegistry.ACTIVE.label },
    { value: 'RETIRED', label: productStatusRegistry.RETIRED.label },
  ] as const;

  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑产品基本信息</DialogTitle>
          <DialogDescription>只修改型号、品牌、类别和产品状态；事实正文不在此处编辑。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="product-update-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={summaryErrors} />
            <FormField<ProductUpdateFormValues, 'part_number'>
              id={fieldIds.part_number}
              label="产品型号"
              name="part_number"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} maxLength={160} />
              )}
            />
            <FormField<ProductUpdateFormValues, 'brand'>
              id={fieldIds.brand}
              label="品牌"
              name="brand"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} maxLength={160} />
              )}
            />
            <FormField<ProductUpdateFormValues, 'category'>
              id={fieldIds.category}
              label="类别"
              name="category"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} maxLength={160} />
              )}
            />
            <FormField<ProductUpdateFormValues, 'status'>
              id={fieldIds.status}
              label="产品状态"
              name="status"
              required
              render={(context) => (
                <Select
                  items={statusItems}
                  onValueChange={(value) => value && context.field.onChange(value)}
                  value={context.field.value}
                >
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <FormActions>
            <DialogClose render={<Button disabled={update.isPending} variant="outline" />}>取消</DialogClose>
            <Button disabled={update.isPending} form="product-update-form" type="submit">
              {update.isPending ? '保存中…' : '保存'}
            </Button>
          </FormActions>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-raised p-3">
      <p className="type-label text-text-muted">{label}</p>
      <div className="mt-2 min-w-0 text-sm font-medium text-text-primary">{children}</div>
    </div>
  );
}

function StatusBadge({ presentation }: { presentation: { label: string; tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info' } }) {
  return <Badge variant={presentation.tone}>{presentation.label}</Badge>;
}

function Metadata({ label, mono = false, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function FactSummary({
  fact,
  href,
  timestamp,
  timestampLabel,
  title,
}: {
  fact: ProductDetail['approved_fact'] | ProductDetail['pending_fact'];
  href?: string;
  timestamp: string | null;
  timestampLabel: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border-subtle p-3" aria-label={title}>
      <h3 className="font-medium text-text-primary">{title}</h3>
      {!fact ? <div className="mt-3"><EmptyValue /></div> : (
        <dl className="mt-3 grid gap-2 text-sm">
          <Metadata label="版本" value={href ? <a className="text-primary underline-offset-4 hover:underline" href={href}>v{fact.version}</a> : `v${fact.version}`} mono />
          <Metadata label="状态" value={fact.status} mono />
          <Metadata label="分级" value={confidentialityRegistry[fact.classification]} />
          <Metadata label={timestampLabel} value={timestamp ? <ProductTime value={timestamp} /> : <EmptyValue />} />
        </dl>
      )}
    </section>
  );
}

function CompactSummary({ children, count, countLabel }: { children: ReactNode; count: number; countLabel: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      <Metric label={countLabel} value={String(count)} />
      <div className="min-w-0 rounded-lg border border-border-subtle p-3 text-sm">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-3">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function ProductTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatExactProductTime(value)}</time>;
}

function EmptyValue() {
  return <span className="text-sm font-normal text-text-muted">暂无</span>;
}

function InlineError({ error, onClose }: { error: unknown; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      <Button onClick={onClose} size="sm" variant="outline">关闭</Button>
    </div>
  );
}

export { ProductDetailPage };
export type { ProductDetailPageProps };
