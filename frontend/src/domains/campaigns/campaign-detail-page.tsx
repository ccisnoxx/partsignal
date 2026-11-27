import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { PageHeader } from '@/design-system/layout/page-header';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { intentLabels } from '@/domains/geo/query-topic-list.model';
import { productFactsFreshnessRegistry } from '@/domains/product/product.model';
import {
  campaignDetailQueryOptions,
  campaignKeys,
  campaignOptionsQueryOptions,
  deleteContentCampaign,
  transitionContentCampaign,
  updateContentCampaign,
  type CampaignTransition,
} from './campaign.api';
import { CampaignAttributionDialogButton } from './campaign-attribution-dialog';
import { CampaignForm } from './campaign-form';
import {
  campaignPrimaryTaskLabels,
  campaignStatusRegistry,
  defaultCampaignFormValues,
  formatRatePercent,
  toCampaignUpdatePayload,
  workPriorityRegistry,
  type CampaignFormValues,
  type ContentCampaignDetail,
} from './campaign.model';

type CampaignDetailPageProps = {
  campaignId: string;
  csrfToken: string | null;
  onDeleted: () => void;
};

const transitionLabels: Record<CampaignTransition, string> = {
  activate: '激活活动',
  pause: '暂停活动',
  resume: '恢复活动',
  complete: '标记完成',
  archive: '归档活动',
};

function CampaignDetailPage({ campaignId, csrfToken, onDeleted }: CampaignDetailPageProps) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(campaignDetailQueryOptions(campaignId));
  const [editingSnapshot, setEditingSnapshot] = useState<ContentCampaignDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; revision: number } | null>(null);
  const [actionError, setActionError] = useState<string>();
  const optionsQuery = useQuery({
    ...campaignOptionsQueryOptions(),
    enabled: editingSnapshot !== null,
  });

  const updateMutation = useMutation({
    mutationFn: ({ values, expectedRevision }: { values: CampaignFormValues; expectedRevision: number }) =>
      updateContentCampaign(
        campaignId,
        toCampaignUpdatePayload(values, expectedRevision),
        csrfToken,
      ),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ operation, expectedRevision }: { operation: CampaignTransition; expectedRevision: number }) =>
      transitionContentCampaign(campaignId, operation, expectedRevision, csrfToken),
  });

  const deleteMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      deleteContentCampaign(campaignId, expectedRevision, csrfToken),
  });

  async function refreshCampaign() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
      queryClient.invalidateQueries({ queryKey: campaignKeys.lists() }),
    ]);
  }

  async function handleUpdate(values: CampaignFormValues, snapshot: ContentCampaignDetail) {
    setActionError(undefined);
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await updateMutation.mutateAsync({ values, expectedRevision: snapshot.revision });
      if (!continuation.isCurrent()) return;
      setEditingSnapshot(null);
      await refreshCampaign();
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTransition(operation: CampaignTransition, current: ContentCampaignDetail) {
    setActionError(undefined);
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await transitionMutation.mutateAsync({ operation, expectedRevision: current.revision });
      if (!continuation.isCurrent()) return;
      await refreshCampaign();
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDelete(target: { name: string; revision: number }) {
    setActionError(undefined);
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      await deleteMutation.mutateAsync(target.revision);
      if (!continuation.isCurrent()) return;
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: campaignKeys.lists() });
      if (!continuation.isCurrent()) return;
      onDeleted();
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  if (detailQuery.isPending) {
    return (
      <div className="rounded-xl border border-border-subtle p-6 text-sm text-text-secondary" aria-busy="true">
        正在读取内容活动详情…
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <section className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
        <p className="text-sm">
          {detailQuery.error instanceof Error ? detailQuery.error.message : '读取内容活动详情失败'}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void detailQuery.refetch()} type="button" variant="outline">重试</Button>
          <a className={buttonVariants({ variant: 'ghost' })} href="/content/campaigns">返回活动列表</a>
        </div>
      </section>
    );
  }

  const campaign = detailQuery.data;
  const statusMeta = campaignStatusRegistry[campaign.status];
  const priorityMeta = workPriorityRegistry[campaign.priority];
  const busy = updateMutation.isPending || transitionMutation.isPending || deleteMutation.isPending;

  return (
    <article className="space-y-6" aria-labelledby="campaign-detail-title">
      <PageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            {campaign.available_actions.includes('PLAN_TASKS') && (
              <>
                <a
                  className={buttonVariants()}
                  href={`/content/tasks/batch?campaignId=${encodeURIComponent(campaign.id)}`}
                >
                  批量规划任务
                </a>
                <a
                  className={buttonVariants({ variant: 'outline' })}
                  href={`/content/tasks/new?campaignId=${encodeURIComponent(campaign.id)}`}
                >
                  新建单个任务
                </a>
              </>
            )}
            <CampaignAttributionDialogButton
              campaignId={campaign.id}
              campaignName={campaign.name}
              campaignStatus={campaign.status}
              csrfToken={csrfToken}
            />
            {campaign.available_actions.includes('UPDATE') && (
              <Button disabled={busy} onClick={() => { setActionError(undefined); setEditingSnapshot(campaign); }} type="button" variant="outline">
                编辑活动
              </Button>
            )}
            {campaign.available_actions.includes('ACTIVATE') && (
              <Button disabled={busy} onClick={() => void handleTransition('activate', campaign)} type="button" variant="outline">
                {transitionLabels.activate}
              </Button>
            )}
            {campaign.available_actions.includes('PAUSE') && (
              <Button disabled={busy} onClick={() => void handleTransition('pause', campaign)} type="button" variant="outline">
                {transitionLabels.pause}
              </Button>
            )}
            {campaign.available_actions.includes('RESUME') && (
              <Button disabled={busy} onClick={() => void handleTransition('resume', campaign)} type="button" variant="outline">
                {transitionLabels.resume}
              </Button>
            )}
            {campaign.available_actions.includes('COMPLETE') && (
              <Button disabled={busy} onClick={() => void handleTransition('complete', campaign)} type="button" variant="outline">
                {transitionLabels.complete}
              </Button>
            )}
            {campaign.available_actions.includes('ARCHIVE') && (
              <Button disabled={busy} onClick={() => void handleTransition('archive', campaign)} type="button" variant="outline">
                {transitionLabels.archive}
              </Button>
            )}
            {campaign.available_actions.includes('DELETE') && (
              <Button
                disabled={busy}
                onClick={() => {
                  setActionError(undefined);
                  setDeleteTarget({ name: campaign.name, revision: campaign.revision });
                }}
                type="button"
                variant="destructive"
              >
                删除草稿
              </Button>
            )}
          </div>
        }
        description={`负责人：${campaign.owner.display_name}（${campaign.owner.username}） · 建议下一步：${campaignPrimaryTaskLabels[campaign.primary_task]}`}
        title={campaign.name}
        titleId="campaign-detail-title"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>
        <Badge variant={priorityMeta.tone}>优先级：{priorityMeta.label}</Badge>
        <span className="text-xs text-text-muted">版本 r{campaign.revision}</span>
        {campaign.start_date || campaign.end_date ? (
          <span className="text-xs text-text-muted">
            周期：{campaign.start_date ?? '未定'} 至 {campaign.end_date ?? '未定'}
          </span>
        ) : null}
        {campaign.budget_amount && campaign.budget_currency ? (
          <span className="text-xs text-text-muted">
            预算：{campaign.budget_amount} {campaign.budget_currency}
          </span>
        ) : null}
      </div>

      {actionError && !editingSnapshot && !deleteTarget && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          {actionError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
        <DetailSection description="实时归因计数基于内容任务与发布成果直接派生。" title="策划概览与目标">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p><span className="text-text-muted">目标受众：</span>{campaign.target_audience || '未填写'}</p>
              <p className="whitespace-pre-wrap"><span className="text-text-muted">活动策略：</span>{campaign.description || '未填写'}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <MetricTile label="关联任务" value={`${campaign.counts.task_count} 个`} href={`/content/tasks?campaignId=${encodeURIComponent(campaign.id)}&archiveStatus=ALL&page=1&pageSize=20`} />
              <MetricTile label="已核验文章" value={`${campaign.counts.published_article_count} 篇`} />
              <MetricTile
                label="目标篇数"
                value={campaign.target_metrics.target_content_count ? `${campaign.target_metrics.target_content_count} 篇` : '未设定'}
              />
              <MetricTile label="目标发现率" value={formatRatePercent(campaign.target_metrics.target_discovery_rate)} />
              <MetricTile label="目标提及率" value={formatRatePercent(campaign.target_metrics.target_mention_rate)} />
              <MetricTile label="目标推荐率" value={formatRatePercent(campaign.target_metrics.target_recommendation_rate)} />
              <MetricTile label="目标引用率" value={formatRatePercent(campaign.target_metrics.target_citation_rate)} />
            </dl>
          </div>
        </DetailSection>

        <DetailSection description="任务创建时仅允许选择活动范围内的产品、主题与平台。" title="关联范围">
          <div className="grid gap-4 lg:grid-cols-2">
            <ScopeCard title={`目标产品（${campaign.products.length}）`}>
              {campaign.products.length === 0 ? <EmptyScope /> : (
                <ul className="space-y-1.5 text-sm">
                  {campaign.products.map((product) => (
                    <li className="flex items-center justify-between gap-2" key={product.id}>
                      <a className="text-primary hover:underline" href={`/products/${encodeURIComponent(product.id)}`}>
                        {product.brand} · {product.part_number}
                      </a>
                      <div className="flex gap-1">
                        <Badge variant={product.has_approved_fact ? 'success' : 'warning'}>
                          {product.has_approved_fact ? '有批准事实' : '缺批准事实'}
                        </Badge>
                        <Badge variant={productFactsFreshnessRegistry[product.facts_freshness].tone}>
                          {productFactsFreshnessRegistry[product.facts_freshness].label}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScopeCard>

            <ScopeCard title={`目标问题主题（${campaign.topics.length}）`}>
              {campaign.topics.length === 0 ? <EmptyScope /> : (
                <ul className="space-y-1.5 text-sm">
                  {campaign.topics.map((topic) => (
                    <li className="flex items-center justify-between gap-2" key={topic.id}>
                      <span className="truncate">{topic.canonical_question}</span>
                      <div className="flex shrink-0 gap-1">
                        <Badge variant="outline">{intentLabels[topic.intent_type]}</Badge>
                        {!topic.is_active && <Badge variant="secondary">已停用</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScopeCard>

            <ScopeCard title={`目标平台（${campaign.platforms.length}）`}>
              {campaign.platforms.length === 0 ? <EmptyScope /> : (
                <ul className="space-y-1.5 text-sm">
                  {campaign.platforms.map((platform) => (
                    <li className="flex items-center justify-between gap-2" key={platform.id}>
                      <span>{platform.name}</span>
                      <div className="flex gap-1">
                        <Badge variant={platform.configuration_complete ? 'info' : 'outline'}>
                          {platform.configuration_complete ? 'Prompt 已配置' : '无 Prompt'}
                        </Badge>
                        {!platform.is_active && <Badge variant="secondary">已停用</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScopeCard>

            <ScopeCard title={`关联 GEO 监测计划（${campaign.monitoring_plans.length}）`}>
              {campaign.monitoring_plans.length === 0 ? <EmptyScope /> : (
                <ul className="space-y-1.5 text-sm">
                  {campaign.monitoring_plans.map((plan) => (
                    <li className="flex items-center justify-between gap-2" key={plan.id}>
                      <a className="text-primary hover:underline" href="/geo/plans">{plan.name}</a>
                      <Badge variant="secondary">{plan.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </ScopeCard>
          </div>
        </DetailSection>
      </div>

      {editingSnapshot && (
        <Dialog onOpenChange={(open) => { if (!open && !updateMutation.isPending) setEditingSnapshot(null); }} open>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl" showCloseButton={!updateMutation.isPending}>
            <DialogHeader>
              <DialogTitle>编辑内容活动</DialogTitle>
              <DialogDescription>
                修改活动元信息与关联范围，提交时校验打开弹窗时冻结的版本 r{editingSnapshot.revision} 乐观锁。
              </DialogDescription>
            </DialogHeader>
            {optionsQuery.isPending && <p className="text-sm text-text-secondary">正在加载可选项…</p>}
            {optionsQuery.isError && (
              <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
                <p className="text-sm">
                  {optionsQuery.error instanceof Error ? optionsQuery.error.message : '加载活动可选项失败'}
                </p>
                <div className="flex gap-2">
                  <Button onClick={() => void optionsQuery.refetch()} type="button" variant="outline">重试</Button>
                  <Button onClick={() => setEditingSnapshot(null)} type="button" variant="ghost">取消</Button>
                </div>
              </div>
            )}
            {optionsQuery.data && (
              <CampaignForm
                currentCampaign={editingSnapshot}
                initialValues={defaultCampaignFormValues(editingSnapshot.owner.id, editingSnapshot)}
                onCancel={() => setEditingSnapshot(null)}
                onSubmit={(values) => handleUpdate(values, editingSnapshot)}
                options={optionsQuery.data}
                pending={updateMutation.isPending}
                serverError={actionError}
                submitLabel="保存更改"
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }} open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认删除草稿内容活动</DialogTitle>
              <DialogDescription>
                仅允许物理删除无关联任务的草稿活动“{deleteTarget.name}”（版本 r{deleteTarget.revision}）。删除后不可恢复。
              </DialogDescription>
            </DialogHeader>
            {actionError && <p className="text-sm text-destructive" role="alert">{actionError}</p>}
            <DialogFooter>
              <DialogClose disabled={deleteMutation.isPending} render={<Button variant="outline" />}>取消</DialogClose>
              <Button
                disabled={deleteMutation.isPending}
                onClick={() => void handleDelete(deleteTarget)}
                type="button"
                variant="destructive"
              >
                {deleteMutation.isPending ? '删除中…' : '确认删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </article>
  );
}

function MetricTile({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle p-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-text-primary">
        {href ? <a className="text-primary underline underline-offset-2" href={href}>{value}</a> : value}
      </dd>
    </div>
  );
}

function ScopeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle p-3">
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      {children}
    </div>
  );
}

function EmptyScope() {
  return <p className="text-xs text-text-muted">暂未关联</p>;
}

export { CampaignDetailPage };
export type { CampaignDetailPageProps };
