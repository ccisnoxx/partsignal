import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
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
import { Textarea } from '@/design-system/primitives/textarea';
import { campaignKeys } from '@/domains/campaigns/campaign.api';
import { intentLabels } from '@/domains/geo/query-topic-list.model';
import { BatchPreviewSection } from './batch-preview-section';
import {
  MAX_BATCH_CELLS,
  buildBatchCells,
  extractBatchPreviewFromError,
  parseAngleLines,
  validateBatchBriefInputs,
  type BatchCellInput,
  type BatchCreateResponse,
  type BatchPlanSearch,
  type BatchPreviewResponse,
} from './content-batch.model';
import {
  ContentRequestError,
  contentKeys,
  contentTaskCreationOptionsQueryOptions,
  createContentTaskBatch,
  previewContentTaskBatch,
} from './content.api';
import type { components } from '@/shared/api/generated/schema';

type CreationOptions = components['schemas']['ContentTaskCreationOptions'];

const NO_CAMPAIGN_VALUE = '__NONE__';

type BatchContentTaskPageProps = {
  csrfToken: string | null;
  search: BatchPlanSearch;
};

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function initialBatchSelection(options: CreationOptions, validCampaignId?: string) {
  const reqCamp = options.requested_campaign;
  if (
    validCampaignId
    && reqCamp?.campaign_id === validCampaignId
    && reqCamp.eligibility === 'ELIGIBLE'
  ) {
    const matched = options.campaigns.find((item) => item.id === validCampaignId);
    if (matched) {
      const availableProducts = new Set(options.products.map((item) => item.id));
      const availableTopics = new Set(options.topics.map((item) => item.id));
      const availablePlatforms = new Set(options.platforms.map((item) => item.id));
      return {
        campaignId: matched.id,
        productIds: matched.product_ids.filter((id) => availableProducts.has(id)),
        topicIds: matched.query_topic_ids.filter((id) => availableTopics.has(id)),
        platformIds: matched.platform_profile_ids.filter((id) => availablePlatforms.has(id)),
        sharedAudience: matched.target_audience,
      };
    }
  }
  return {
    campaignId: '',
    productIds: [] as string[],
    topicIds: [] as string[],
    platformIds: [] as string[],
    sharedAudience: '',
  };
}

function BatchContentTaskPage({ csrfToken, search }: BatchContentTaskPageProps) {
  const validCampaignId = search.campaignId && z.uuid().safeParse(search.campaignId).success
    ? search.campaignId
    : undefined;
  const optionsQuery = useQuery(contentTaskCreationOptionsQueryOptions(undefined, validCampaignId));
  const options = optionsQuery.isPlaceholderData ? undefined : optionsQuery.data;

  return (
    <section aria-labelledby="batch-plan-title" className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: 'outline' })} to="/content/tasks/new">
              单条创建
            </Link>
            <Link className={buttonVariants({ variant: 'ghost' })} to="/content/tasks">
              返回任务列表
            </Link>
          </div>
        )}
        description="通过“产品 × 问题主题 × 内容角度 × 目标平台”矩阵批量规划内容任务；先预检硬阻断与软告警，再按批量幂等键全量原子创建。"
        title="批量任务规划矩阵"
        titleId="batch-plan-title"
      />

      {search.campaignId && !validCampaignId && (
        <InlineBanner tone="warning">
          链接中的 campaignId“{search.campaignId}”不是有效 UUID，未自动关联活动。
        </InlineBanner>
      )}
      {validCampaignId && options?.requested_campaign && options.requested_campaign.eligibility !== 'ELIGIBLE' && (
        <InlineBanner tone="warning">
          {options.requested_campaign.eligibility === 'NOT_FOUND'
            ? '链接指定的内容活动不存在，未自动关联活动。'
            : `链接指定的内容活动“${options.requested_campaign.name ?? validCampaignId}”当前状态不可批量规划任务。`}
        </InlineBanner>
      )}

      {optionsQuery.isPending && (
        <div className="rounded-xl border border-border-subtle p-6 text-sm text-text-secondary" aria-busy="true">
          正在加载可用活动、产品、问题主题与目标平台…
        </div>
      )}
      {optionsQuery.isError && (
        <InlineBanner
          actions={<Button onClick={() => void optionsQuery.refetch()} size="sm" variant="outline">重试</Button>}
          title="加载规划可选项失败"
          tone="danger"
        >
          {optionsQuery.error instanceof Error ? optionsQuery.error.message : '加载规划可选项失败'}
        </InlineBanner>
      )}

      {options && (
        <BatchMatrixWorkspace
          csrfToken={csrfToken}
          key={validCampaignId ?? '__standalone__'}
          options={options}
          validCampaignId={validCampaignId}
        />
      )}
    </section>
  );
}

function BatchMatrixWorkspace({
  csrfToken,
  options,
  validCampaignId,
}: {
  csrfToken: string | null;
  options: CreationOptions;
  validCampaignId?: string;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(
    () => initialBatchSelection(options, validCampaignId),
    // 仅在首次挂载（或按 key 重置）时计算默认选中，避免焦点刷新覆盖用户编辑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [campaignId, setCampaignId] = useState(initial.campaignId);
  const [productIds, setProductIds] = useState<string[]>(initial.productIds);
  const [topicIds, setTopicIds] = useState<string[]>(initial.topicIds);
  const [platformIds, setPlatformIds] = useState<string[]>(initial.platformIds);
  const [anglesText, setAnglesText] = useState('国产替代选型指南');
  const [sharedAudience, setSharedAudience] = useState(initial.sharedAudience);
  const [sharedContentFormat, setSharedContentFormat] = useState('');
  const [sharedCta, setSharedCta] = useState('');
  const [sharedKeywordsText, setSharedKeywordsText] = useState('');
  const [sharedForbiddenText, setSharedForbiddenText] = useState('');
  const [sharedNotes, setSharedNotes] = useState('');
  const [preview, setPreview] = useState<BatchPreviewResponse | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [createdResult, setCreatedResult] = useState<BatchCreateResponse | null>(null);

  const idempotency = useRef<{ signature: string; key: string } | undefined>(undefined);
  const submittingRef = useRef(false);
  const audienceCustomizedRef = useRef(false);

  const selectedCampaign = options.campaigns.find((item) => item.id === campaignId);
  const effectiveCampaignId = selectedCampaign ? selectedCampaign.id : '';
  const campaignUnavailableNotice = Boolean(campaignId && !selectedCampaign);

  const scopedProducts = useMemo(() => {
    const all = options.products;
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.product_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [options.products, selectedCampaign]);

  const scopedTopics = useMemo(() => {
    const all = options.topics;
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.query_topic_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [options.topics, selectedCampaign]);

  const scopedPlatforms = useMemo(() => {
    const all = options.platforms;
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.platform_profile_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [options.platforms, selectedCampaign]);

  const activeProductIds = useMemo(() => {
    const valid = new Set(scopedProducts.map((item) => item.id));
    return productIds.filter((id) => valid.has(id));
  }, [productIds, scopedProducts]);

  const activeTopicIds = useMemo(() => {
    const valid = new Set(scopedTopics.map((item) => item.id));
    return topicIds.filter((id) => valid.has(id));
  }, [topicIds, scopedTopics]);

  const activePlatformIds = useMemo(() => {
    const valid = new Set(scopedPlatforms.map((item) => item.id));
    return platformIds.filter((id) => valid.has(id));
  }, [platformIds, scopedPlatforms]);

  const parsedAngles = useMemo(() => parseAngleLines(anglesText), [anglesText]);
  const briefErrors = useMemo(
    () =>
      validateBatchBriefInputs({
        angles: parsedAngles,
        sharedAudience,
        sharedContentFormat,
        sharedCta,
        sharedKeywordsText,
        sharedForbiddenText,
        sharedNotes,
      }),
    [
      parsedAngles,
      sharedAudience,
      sharedContentFormat,
      sharedCta,
      sharedKeywordsText,
      sharedForbiddenText,
      sharedNotes,
    ],
  );

  const cells = useMemo(
    () =>
      buildBatchCells({
        productIds: activeProductIds,
        topicIds: activeTopicIds,
        platformIds: activePlatformIds,
        angles: parsedAngles,
        options,
        sharedAudience,
        sharedContentFormat,
        sharedCta,
        sharedKeywordsText,
        sharedForbiddenText,
        sharedNotes,
      }),
    [
      options,
      activeProductIds,
      activeTopicIds,
      activePlatformIds,
      parsedAngles,
      sharedAudience,
      sharedContentFormat,
      sharedCta,
      sharedKeywordsText,
      sharedForbiddenText,
      sharedNotes,
    ],
  );

  const currentPayloadSignature = useMemo(
    () => JSON.stringify({ campaign_id: effectiveCampaignId || null, cells }),
    [effectiveCampaignId, cells],
  );
  const previewIsStale = preview !== null && previewSignature !== currentPayloadSignature;

  const previewMutation = useMutation({
    mutationFn: (body: { campaign_id: string | null; cells: BatchCellInput[] }) =>
      previewContentTaskBatch(body, csrfToken),
  });

  const commitMutation = useMutation({
    mutationFn: ({
      body,
      key,
    }: {
      body: { campaign_id: string | null; cells: BatchCellInput[]; acknowledge_warnings: boolean };
      key: string;
    }) => createContentTaskBatch(body, csrfToken, key),
  });

  function handleCampaignChange(next: string) {
    const resolved = next === NO_CAMPAIGN_VALUE ? '' : next;
    setCampaignId(resolved);
    setPreview(null);
    setPreviewSignature(null);
    setAcknowledgeWarnings(false);
    setCreatedResult(null);
    setActionError(undefined);
    if (!resolved) {
      if (!audienceCustomizedRef.current) setSharedAudience('');
      return;
    }
    const matched = options.campaigns.find((item) => item.id === resolved);
    if (!matched) return;
    const availableProducts = new Set(options.products.map((item) => item.id));
    const availableTopics = new Set(options.topics.map((item) => item.id));
    const availablePlatforms = new Set(options.platforms.map((item) => item.id));
    setProductIds(matched.product_ids.filter((id) => availableProducts.has(id)));
    setTopicIds(matched.query_topic_ids.filter((id) => availableTopics.has(id)));
    setPlatformIds(matched.platform_profile_ids.filter((id) => availablePlatforms.has(id)));
    if (!audienceCustomizedRef.current) {
      setSharedAudience(matched.target_audience);
    }
  }

  async function handlePreview() {
    if (briefErrors.length > 0 || cells.length === 0 || cells.length > MAX_BATCH_CELLS) return;
    setActionError(undefined);
    setCreatedResult(null);
    setPreview(null);
    setPreviewSignature(null);
    setAcknowledgeWarnings(false);
    const body = { campaign_id: effectiveCampaignId || null, cells };
    const signature = currentPayloadSignature;
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const result = await previewMutation.mutateAsync(body);
      if (!continuation.isCurrent()) return;
      setPreview(result);
      setPreviewSignature(signature);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCommit() {
    if (submittingRef.current || !preview || previewIsStale || !preview.can_commit) return;
    submittingRef.current = true;
    setActionError(undefined);
    const signature = currentPayloadSignature;
    const key = idempotency.current?.signature === signature
      ? idempotency.current.key
      : crypto.randomUUID();
    idempotency.current = { signature, key };
    const body = {
      campaign_id: effectiveCampaignId || null,
      cells,
      acknowledge_warnings: acknowledgeWarnings,
    };
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const result = await commitMutation.mutateAsync({ body, key });
      if (!continuation.isCurrent()) return;
      idempotency.current = undefined;
      setPreview(null);
      setPreviewSignature(null);
      setAcknowledgeWarnings(false);
      setCreatedResult(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        ...(result.campaign_id
          ? [queryClient.invalidateQueries({ queryKey: campaignKeys.all() })]
          : []),
      ]);
    } catch (error) {
      if (!continuation.isCurrent()) return;
      const latestPreview = extractBatchPreviewFromError(error);
      if (latestPreview) {
        setPreview(latestPreview);
        setPreviewSignature(signature);
      }
      if (error instanceof ContentRequestError && error.detail?.code === 'IDEMPOTENCY_CONFLICT') {
        idempotency.current = undefined;
      }
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
    }
  }

  const productNames = useMemo(
    () => new Map(options.products.map((item) => [item.id, `${item.brand} · ${item.part_number}`])),
    [options.products],
  );
  const topicNames = useMemo(
    () => new Map(options.topics.map((item) => [item.id, item.canonical_question])),
    [options.topics],
  );
  const platformNames = useMemo(
    () => new Map(options.platforms.map((item) => [item.id, item.name])),
    [options.platforms],
  );

  const busy = previewMutation.isPending || commitMutation.isPending;
  const tooManyCells = cells.length > MAX_BATCH_CELLS;
  const canPreview = !busy && cells.length > 0 && !tooManyCells && briefErrors.length === 0;
  const canCommit = Boolean(
    !busy
    && preview
    && !previewIsStale
    && preview.can_commit
    && (!preview.requires_warning_acknowledgement || acknowledgeWarnings),
  );
  const isDirty = Boolean(
    activeProductIds.length > 0
    || activeTopicIds.length > 0
    || activePlatformIds.length > 0
    || sharedAudience.trim()
    || sharedContentFormat.trim()
    || sharedCta.trim()
    || sharedKeywordsText.trim()
    || sharedForbiddenText.trim()
    || sharedNotes.trim(),
  );

  return (
    <div className="space-y-6">
      <DirtyGuard when={isDirty && !createdResult} />
      {campaignUnavailableNotice && (
        <InlineBanner tone="warning">
          原选内容活动已不在可规划列表（可能已暂停、完成或归档），当前已自动回退为“不关联内容活动”，请确认后再预览。
        </InlineBanner>
      )}
      <section className="space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text-primary">1. 选择活动与矩阵维度</h2>
                <p className="text-xs text-text-secondary">
                  单次批量上限 {MAX_BATCH_CELLS} 个单元格；每个任务将自动冻结独立不可变 Brief 快照与产品最新已批准事实。
                </p>
              </div>
              <Badge variant={tooManyCells ? 'destructive' : cells.length > 0 ? 'info' : 'secondary'}>
                当前组合：{activeProductIds.length} × {activeTopicIds.length} × {parsedAngles.length} × {activePlatformIds.length} = {cells.length} 格
              </Badge>
            </div>

            <div className="max-w-md space-y-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="batch-campaign-select">
                所属内容活动（可选）
              </label>
              <Select
                disabled={busy}
                items={[
                  { value: NO_CAMPAIGN_VALUE, label: '不关联内容活动（独立批量规划）' },
                  ...options.campaigns.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onValueChange={(next) => next && handleCampaignChange(next)}
                value={effectiveCampaignId || NO_CAMPAIGN_VALUE}
              >
                <SelectTrigger id="batch-campaign-select">
                  <SelectValue placeholder="不关联内容活动" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value={NO_CAMPAIGN_VALUE}>不关联内容活动（独立批量规划）</SelectItem>
                  {options.campaigns.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <MatrixMultiSelect
                disabled={busy}
                emptyText="暂无符合条件的产品"
                items={scopedProducts.map((item) => ({
                  id: item.id,
                  label: `${item.brand} · ${item.part_number}`,
                  meta: `最新事实 v${item.approved_fact_versions[0]?.version ?? '-'}`,
                }))}
                onSelectAll={() => setProductIds(scopedProducts.map((item) => item.id))}
                onClear={() => setProductIds([])}
                onToggle={(id) => setProductIds((prev) => toggleId(prev, id))}
                selected={activeProductIds}
                title={`产品（已选 ${activeProductIds.length}）`}
              />
              <MatrixMultiSelect
                disabled={busy}
                emptyText="暂无活跃问题主题"
                items={scopedTopics.map((item) => ({
                  id: item.id,
                  label: item.canonical_question,
                  meta: intentLabels[item.intent_type],
                }))}
                onSelectAll={() => setTopicIds(scopedTopics.map((item) => item.id))}
                onClear={() => setTopicIds([])}
                onToggle={(id) => setTopicIds((prev) => toggleId(prev, id))}
                selected={activeTopicIds}
                title={`问题主题（已选 ${activeTopicIds.length}）`}
              />
              <MatrixMultiSelect
                disabled={busy}
                emptyText="暂无活跃目标平台"
                items={scopedPlatforms.map((item) => ({
                  id: item.id,
                  label: item.name,
                  meta: '活跃平台',
                }))}
                onSelectAll={() => setPlatformIds(scopedPlatforms.map((item) => item.id))}
                onClear={() => setPlatformIds([])}
                onToggle={(id) => setPlatformIds((prev) => toggleId(prev, id))}
                selected={activePlatformIds}
                title={`目标平台（已选 ${activePlatformIds.length}）`}
              />
            </div>

            <div className="grid gap-4 border-t border-border-subtle pt-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary" htmlFor="batch-angles">
                  内容角度（每行一个，必填，最多 160 字/条）
                </label>
                <Textarea
                  disabled={busy}
                  id="batch-angles"
                  onChange={(event) => setAnglesText(event.target.value)}
                  placeholder={'国产替代选型指南\n关键参数差异对比\n应用排障案例'}
                  rows={3}
                  value={anglesText}
                />
              </div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary" htmlFor="batch-audience">
                      共享目标受众（可选）
                    </label>
                    <Input
                      disabled={busy}
                      id="batch-audience"
                      maxLength={500}
                      onChange={(event) => {
                        audienceCustomizedRef.current = true;
                        setSharedAudience(event.target.value);
                      }}
                      placeholder="例如：电源硬件工程师"
                      value={sharedAudience}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary" htmlFor="batch-format">
                      共享内容形式（可选）
                    </label>
                    <Input
                      disabled={busy}
                      id="batch-format"
                      maxLength={80}
                      onChange={(event) => setSharedContentFormat(event.target.value)}
                      placeholder="例如：技术选型指南"
                      value={sharedContentFormat}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary" htmlFor="batch-keywords">
                      共享目标关键词（逗号或换行分隔）
                    </label>
                    <Input
                      disabled={busy}
                      id="batch-keywords"
                      onChange={(event) => setSharedKeywordsText(event.target.value)}
                      placeholder="TPS5430, 国产替代"
                      value={sharedKeywordsText}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary" htmlFor="batch-cta">
                      共享 CTA（可选）
                    </label>
                    <Input
                      disabled={busy}
                      id="batch-cta"
                      maxLength={500}
                      onChange={(event) => setSharedCta(event.target.value)}
                      placeholder="联系技术支持获取样品与评估板"
                      value={sharedCta}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-secondary" htmlFor="batch-forbidden">
                  自定义禁止表达（每行一条；留空则自动带出各产品最新事实版本的禁止表达）
                </label>
                <Textarea
                  disabled={busy}
                  id="batch-forbidden"
                  onChange={(event) => setSharedForbiddenText(event.target.value)}
                  rows={2}
                  value={sharedForbiddenText}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-secondary" htmlFor="batch-notes">
                  共享成功标准备注（可选）
                </label>
                <Textarea
                  disabled={busy}
                  id="batch-notes"
                  maxLength={500}
                  onChange={(event) => setSharedNotes(event.target.value)}
                  rows={2}
                  value={sharedNotes}
                />
              </div>
            </div>

            {briefErrors.length > 0 && (
              <InlineBanner title="请修正以下 Brief 参数后再预览" tone="danger">
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                  {briefErrors.map((err) => <li key={err}>{err}</li>)}
                </ul>
              </InlineBanner>
            )}
            {tooManyCells && (
              <InlineBanner tone="danger">
                当前矩阵共 {cells.length} 格，超过单批上限 {MAX_BATCH_CELLS} 格，请缩减维度后再预览。
              </InlineBanner>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Button disabled={!canPreview} onClick={() => void handlePreview()} type="button">
                {previewMutation.isPending ? '正在预检矩阵…' : `预览规划矩阵（${cells.length} 格）`}
              </Button>
            </div>
          </section>

          {actionError && (
            <InlineBanner tone="danger" title="批量规划操作失败">
              {actionError}
            </InlineBanner>
          )}

          {createdResult && (
            <InlineBanner
              actions={(
                <Link
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  search={
                    createdResult.campaign_id
                      ? { campaignId: createdResult.campaign_id, archiveStatus: 'ALL', page: 1, pageSize: 20 }
                      : { archiveStatus: 'ACTIVE', page: 1, pageSize: 20 }
                  }
                  to="/content/tasks"
                >
                  查看任务列表
                </Link>
              )}
              title={
                createdResult.replayed
                  ? `已复用幂等回执（原批次共 ${createdResult.created_count} 个任务）`
                  : `已原子创建 ${createdResult.created_count} 个内容任务`
              }
              tone="success"
            >
              {createdResult.replayed && createdResult.tasks.length < createdResult.created_count && (
                <p className="text-xs">
                  原批次中已有 {createdResult.created_count - createdResult.tasks.length} 个历史任务被后续删除，以下列出当前仍存在的任务：
                </p>
              )}
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {createdResult.tasks.slice(0, 10).map((task) => (
                  <li key={task.id}>
                    <Link
                      className="underline underline-offset-2"
                      params={{ taskId: task.id }}
                      to="/content/tasks/$taskId"
                    >
                      {task.id}（{task.workflow_stage}）
                    </Link>
                  </li>
                ))}
                {createdResult.tasks.length > 10 && (
                  <li>其余 {createdResult.tasks.length - 10} 个任务请在任务列表查看。</li>
                )}
              </ul>
            </InlineBanner>
          )}

      {preview && (
        <BatchPreviewSection
          acknowledgeWarnings={acknowledgeWarnings}
          busy={busy}
          canCommit={canCommit}
          committing={commitMutation.isPending}
          onAcknowledgeWarningsChange={setAcknowledgeWarnings}
          onCommit={() => void handleCommit()}
          platformNames={platformNames}
          preview={preview}
          previewIsStale={previewIsStale}
          productNames={productNames}
          topicNames={topicNames}
        />
      )}
    </div>
  );
}

function MatrixMultiSelect({
  disabled,
  emptyText,
  items,
  onClear,
  onSelectAll,
  onToggle,
  selected,
  title,
}: {
  disabled: boolean;
  emptyText: string;
  items: { id: string; label: string; meta: string }[];
  onClear: () => void;
  onSelectAll: () => void;
  onToggle: (id: string) => void;
  selected: string[];
  title: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-primary">{title}</span>
        <div className="flex gap-2 text-xs">
          <button
            className="text-primary hover:underline disabled:opacity-50"
            disabled={disabled || items.length === 0}
            onClick={onSelectAll}
            type="button"
          >
            全选
          </button>
          <button
            className="text-text-muted hover:underline disabled:opacity-50"
            disabled={disabled || selected.length === 0}
            onClick={onClear}
            type="button"
          >
            清空
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">{emptyText}</p>
      ) : (
        <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <label
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border-subtle/70 px-2.5 py-1.5 text-xs hover:bg-surface-muted/40"
              key={item.id}
            >
              <input
                checked={selected.includes(item.id)}
                className="mt-0.5"
                disabled={disabled}
                onChange={() => onToggle(item.id)}
                type="checkbox"
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium text-text-primary">{item.label}</span>
                <span className="text-text-muted">{item.meta}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export { BatchContentTaskPage };
export type { BatchContentTaskPageProps };
