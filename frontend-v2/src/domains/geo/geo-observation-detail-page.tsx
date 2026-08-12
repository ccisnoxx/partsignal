import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { RowActions } from '@/design-system/data-table/row-actions';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline, type TimelineItem } from '@/design-system/workspace/timeline';
import { productsKeys } from '@/domains/product/product.api';
import {
  deleteGeoObservation,
  GeoRequestError,
  geoKeys,
  geoObservationDetailQueryOptions,
} from './geo.api';
import {
  resolveGeoObservationOverflowActions,
  resolveGeoObservationPrimaryAction,
} from './geo-observation-actions';
import {
  accuracyLabels,
  formatAccuracy,
  formatBoolean,
  formatObservationTime,
  recommendationLabels,
  selectedManualHistory,
  tailManualHistory,
  type GeoObservationDetail,
  type LegacyGeoObservationDetail,
  type ManualHistoryItem,
  type ManualGeoObservationDetail,
} from './geo-observation-detail.model';

type GeoObservationDetailPageProps = {
  csrfToken: string | null;
  observationId: string;
  onDeleted: () => Promise<void>;
};

function GeoObservationDetailPage({
  csrfToken,
  observationId,
  onDeleted,
}: GeoObservationDetailPageProps) {
  const queryClient = useQueryClient();
  const detail = useQuery(geoObservationDetailQueryOptions(observationId));
  const remove = useMutation({
    mutationFn: (targetId: string) => deleteGeoObservation(targetId, csrfToken),
    onSuccess: async () => {
      const productId = detail.data?.product.id;
      const detailIds = detail.data?.observation_kind === 'MANUAL_ARTICLE_SEARCH'
        ? detail.data.correction_history.map((item) => item.observation.id)
        : detail.data
          ? [detail.data.observation.id]
          : [];
      await onDeleted();
      await Promise.all([
        ...detailIds.map((id) => queryClient.invalidateQueries({
          queryKey: geoKeys.detail(id),
          refetchType: 'none',
        })),
        queryClient.invalidateQueries({ queryKey: geoKeys.lists() }),
        ...(productId
          ? [queryClient.invalidateQueries({ queryKey: productsKeys.detail(productId) })]
          : []),
      ]);
    },
  });

  if (detail.isPending) return <DetailSkeleton observationId={observationId} />;
  if (!detail.data && detail.error) {
    return <DetailFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (!detail.data) return null;

  const view = detailView(detail.data);
  const primary = resolveGeoObservationPrimaryAction(view.primaryTask, view.actionTargetId);
  const overflow = resolveGeoObservationOverflowActions({
    actions: view.actions,
    deleting: remove.isPending,
    label: view.queryText,
    observationId: view.actionTargetId,
  });

  function handleCommand(command: string) {
    if (command === 'delete-observation') {
      remove.mutate(view.actionTargetId);
      return;
    }
    throw new Error(`GEO Observation Detail 收到未知页面命令：${command}`);
  }

  return (
    <article aria-labelledby="geo-observation-detail-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{view.kindLabel}</Badge>
            <Badge variant="info">只读记录</Badge>
            <Badge variant={view.current ? 'success' : 'secondary'}>
              {view.current ? '当前链尾' : '历史记录'}
            </Badge>
          </div>
          <h1 className="break-words type-page-title" id="geo-observation-detail-title">
            {view.queryText}
          </h1>
          <p className="break-words text-text-secondary">
            {detail.data.product.label} · {view.platform}
          </p>
        </div>
        <div className="min-w-0 sm:min-w-64">
          <RowActions
            objectLabel={view.queryText}
            onCommand={handleCommand}
            overflow={overflow}
            primary={primary}
          />
        </div>
      </header>

      {detail.error && (
        <InlineError
          message={`刷新失败，已保留当前只读详情：${errorMessage(detail.error)}`}
          onRetry={() => void detail.refetch()}
        />
      )}
      {remove.error && (
        <InlineError message={errorMessage(remove.error)} onRetry={() => remove.reset()} />
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection description="服务端投影的只读阶段、主任务和动作资格。" title="摘要">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metadata label="Workflow stage" value={view.workflowStage} mono />
            <Metadata label="Primary task" value={view.primaryTask} mono />
            <Metadata label="Selected record" value={view.selectedId} mono />
            <Metadata
              label="Available actions"
              value={view.actions.length ? view.actions.join(' · ') : '无'}
              mono
            />
          </dl>
        </DetailSection>

        <DetailSection title="观测记录" className="scroll-mt-4" description="原记录与所有更正均不可原地编辑。">
          <div id="observation-record" className="space-y-5">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metadata label="Query Topic" value={view.topic ?? '历史未记录'} />
              <Metadata label="Product" value={detail.data.product.label} />
              <Metadata label="GEO platform" value={view.platform} />
              <Metadata label="Observation ID" value={view.selectedId} mono />
              <Metadata label="Observed / tested time" value={<Time value={view.testedAt} />} />
              <Metadata label="Created time" value={<Time value={view.createdAt} />} />
              <Metadata label="Recorder" value={`${view.recorder.display_name}（@${view.recorder.username}）`} />
              <Metadata label="Recorder ID" value={view.recorder.id} mono />
            </dl>
            <TextBlock label="完整问题或搜索词" value={view.queryText} />
          </div>
        </DetailSection>

        <DetailSection className="scroll-mt-4" title="结果事实">
          <div id="results">
            {detail.data.observation_kind === 'LEGACY_MODEL_RESULT'
              ? <LegacyResults detail={detail.data} />
              : <ManualResults item={tailManualHistory(detail.data)} />}
          </div>
        </DetailSection>

        <DetailSection title="Evidence" description="仅展示当前所选节点直接拥有的证据；历史节点证据在时间线中保留归属。">
          <EvidenceList evidence={view.evidence} />
        </DetailSection>

        <DetailSection title="Notes">
          <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">
            {view.notes || '无备注'}
          </p>
        </DetailSection>

        {detail.data.observation_kind === 'MANUAL_ARTICLE_SEARCH' && (
          <DetailSection
            className="scroll-mt-4"
            description="服务端按 root→tail 返回完整追加式历史；页面不按时间或 supersedes_id 重排。"
            title="Correction history"
          >
            <div id="correction-history">
              <Timeline items={manualTimeline(detail.data)} />
            </div>
          </DetailSection>
        )}

        <DetailSection title="关联 Published Articles">
          <PublicationList detail={detail.data} />
        </DetailSection>
      </div>
    </article>
  );
}

function detailView(detail: GeoObservationDetail) {
  if (detail.observation_kind === 'LEGACY_MODEL_RESULT') {
    const observation = detail.observation;
    return {
      actionTargetId: observation.id,
      actions: observation.available_actions,
      createdAt: observation.created_at,
      current: false,
      evidence: detail.evidence,
      kindLabel: 'Legacy model result',
      notes: observation.notes,
      platform: [observation.model_name, observation.model_version].filter(Boolean).join(' · '),
      primaryTask: observation.primary_task,
      queryText: observation.actual_prompt,
      recorder: observation.recorder,
      selectedId: observation.id,
      testedAt: observation.tested_at,
      topic: detail.query_topic.canonical_question,
      workflowStage: observation.workflow_stage,
    } as const;
  }
  const selected = selectedManualHistory(detail);
  const tail = tailManualHistory(detail);
  return {
    actionTargetId: detail.chain_tail_id,
    actions: tail.observation.available_actions,
    createdAt: selected.observation.created_at,
    current: selected.is_chain_tail,
    evidence: selected.evidence,
    kindLabel: 'Manual article search',
    notes: selected.observation.notes,
    platform: selected.observation.search_platform,
    primaryTask: tail.observation.primary_task,
    queryText: selected.observation.search_query,
    recorder: selected.observation.recorder,
    selectedId: selected.observation.id,
    testedAt: selected.observation.tested_at,
    topic: selected.query_topic?.canonical_question,
    workflowStage: selected.observation.workflow_stage,
  } as const;
}

function LegacyResults({ detail }: { detail: LegacyGeoObservationDetail }) {
  const observation = detail.observation;
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metadata label="Mentioned" value={formatBoolean(observation.mentioned)} />
        <Metadata label="Recommendation" value={recommendationLabels[observation.recommendation]} />
        <Metadata label="Accuracy" value={accuracyLabels[observation.accuracy]} />
        <Metadata label="Web search" value={formatBoolean(observation.web_search_enabled)} />
      </dl>
      <TextBlock label="Answer summary" value={observation.answer_summary} />
      <div className="space-y-2">
        <h3 className="type-label text-text-primary">Citations</h3>
        {observation.citations.length ? (
          <ul className="space-y-2">
            {observation.citations.map((citation) => (
              <li className="rounded-lg border border-border-subtle p-3 text-sm" key={`${citation.url}-${citation.source_type}`}>
                <a className="break-all text-link hover:underline" href={citation.url} rel="noreferrer" target="_blank">
                  {citation.url}
                </a>
                <p className="mt-1 text-xs text-text-muted">{citation.source_type}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyValue label="无 citation" />}
      </div>
    </div>
  );
}

function ManualResults({ item }: { item: ManualHistoryItem }) {
  return (
    <div className="space-y-3">
      {item.observation.article_results.map((result) => (
        <article className="min-w-0 rounded-lg border border-border-subtle p-3" key={result.published_article_id}>
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="break-words font-medium text-text-primary">{result.title}</h3>
              <p className="text-sm text-text-muted">{result.platform_name}</p>
            </div>
            <a className="shrink-0 text-sm text-link hover:underline" href={result.final_url} rel="noreferrer" target="_blank">
              打开成果
            </a>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            <Metadata label="Discovered" value={formatBoolean(result.discovered)} />
            <Metadata label="Mentioned" value={formatBoolean(result.mentioned)} />
            <Metadata label="Accuracy" value={formatAccuracy(result.accuracy)} />
          </dl>
        </article>
      ))}
    </div>
  );
}

function manualTimeline(detail: ManualGeoObservationDetail): TimelineItem[] {
  return detail.correction_history.map((item, index) => ({
    id: item.observation.id,
    title: index === 0 ? '原记录' : `更正 ${index}`,
    description: item.observation.search_query,
    meta: (
      <div className="flex flex-wrap justify-end gap-1">
        {item.is_selected && <Badge variant="info">当前查看</Badge>}
        {item.is_chain_tail
          ? <Badge variant="success">当前链尾</Badge>
          : <Badge variant="secondary">{index === 0 ? '历史原记录' : '历史更正'}</Badge>}
      </div>
    ),
    content: <HistoryNode item={item} />,
  }));
}

function HistoryNode({ item }: { item: ManualHistoryItem }) {
  const observation = item.observation;
  return (
    <div className="space-y-4 rounded-lg border border-border-subtle bg-muted/30 p-3">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metadata label="Query Topic" value={item.query_topic?.canonical_question ?? '历史未记录'} />
        <Metadata label="GEO platform" value={observation.search_platform} />
        <Metadata label="Observed" value={<Time value={observation.tested_at} />} />
        <Metadata label="Created" value={<Time value={observation.created_at} />} />
        <Metadata label="Recorder" value={observation.recorder.display_name} />
        <Metadata label="Workflow stage" value={observation.workflow_stage} mono />
        <Metadata label="Primary task" value={observation.primary_task} mono />
        <Metadata label="Observation ID" value={observation.id} mono />
      </dl>
      <ManualResults item={item} />
      <EvidenceList evidence={item.evidence} />
      <TextBlock label="Notes" value={observation.notes || '无备注'} />
    </div>
  );
}

function PublicationList({ detail }: { detail: GeoObservationDetail }) {
  const publications = detail.observation_kind === 'LEGACY_MODEL_RESULT'
    ? detail.published_articles.map((item) => ({
        id: item.id,
        title: item.title,
        platform: item.platform_name,
        url: item.final_url,
      }))
    : selectedManualHistory(detail).observation.article_results.map((item) => ({
        id: item.published_article_id,
        title: item.title,
        platform: item.platform_name,
        url: item.final_url,
      }));
  if (!publications.length) return <EmptyValue label="无关联 Published Article" />;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {publications.map((item) => (
        <li className="min-w-0 rounded-lg border border-border-subtle p-3" key={item.id}>
          <a className="break-words font-medium text-link hover:underline" href={`/publishing/articles/${item.id}`}>
            {item.title}
          </a>
          <p className="mt-1 text-sm text-text-muted">{item.platform}</p>
          <a className="mt-2 inline-block break-all text-sm text-link hover:underline" href={item.url} rel="noreferrer" target="_blank">
            {item.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

function EvidenceList({ evidence }: { evidence: ManualHistoryItem['evidence'] }) {
  if (!evidence.length) return <EmptyValue label="无 evidence 文件" />;
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {evidence.map((item) => (
        <li className="min-w-0 rounded-lg border border-border-subtle p-3 text-sm" key={item.file.id}>
          <a className="break-all font-medium text-link hover:underline" href={item.download.url} rel="noreferrer" target="_blank">
            {item.file.original_filename}
          </a>
          <p className="mt-1 text-xs text-text-muted">
            {item.file.content_type} · {formatFileSize(item.file.size)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DetailFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof GeoRequestError ? error.status : undefined;
  const [title, description] = status === 404
    ? ['未找到 GEO Observation', '该记录不存在，或其完整更正链已被删除。']
    : status === 403
      ? ['无法访问 GEO Observation', '当前会话没有读取该记录的权限。']
      : status === 409
        ? ['GEO Observation 暂不可读取', '服务端发现更正链或关联上下文不完整，请重试或联系管理员。']
        : ['GEO Observation 加载失败', errorMessage(error)];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{title}</h1>
      <p className="text-text-secondary">{description}</p>
      <p className="break-words text-sm text-text-muted">{errorMessage(error)}</p>
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href="/geo/observations?page=1&pageSize=20">
          返回观测列表
        </a>
        <Button onClick={onRetry} type="button" variant="outline">重试</Button>
      </div>
    </section>
  );
}

function DetailSkeleton({ observationId }: { observationId: string }) {
  return (
    <article aria-busy="true" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <p className="type-label text-text-muted">GEO Observation Detail</p>
        <h1 className="type-page-title">正在加载观测详情</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{observationId}</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        {['摘要', '观测记录', '结果事实', 'Evidence', 'Notes', '关联 Published Articles'].map((title) => (
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

function Metadata({ label, mono, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/30 p-3">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-text-primary${mono ? ' font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <h3 className="type-label text-text-primary">{label}</h3>
      <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{value}</p>
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      <span>{message}</span>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">重试</Button>
    </div>
  );
}

function EmptyValue({ label = '无' }: { label?: string }) {
  return <p className="text-sm text-text-muted">{label}</p>;
}

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{formatObservationTime(value)}</time>;
}

function formatFileSize(bytes: number) {
  return `${new Intl.NumberFormat('zh-CN').format(bytes)} B`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { GeoObservationDetailPage };
export type { GeoObservationDetailPageProps };
