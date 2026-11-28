import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  checklistKeys,
  createDirectObservation,
  dailyChecklistQueryOptions,
  ensureDailyChecklist,
  type DailyChecklistItem,
  type PromptCategory,
  type RunStatus,
} from './daily-checklist.api';
import { DailyChecklistCapture } from './daily-checklist-capture';
import { promptCategoryLabels, runStatusLabels, todayLocalDate } from './daily-checklist.model';

type Props = {
  csrfToken: string | null;
};

export function DailyChecklistPage({ csrfToken }: Props) {
  const queryClient = useQueryClient();
  const [targetDate, setTargetDate] = useState(todayLocalDate);
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | ''>('');
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [directOpen, setDirectOpen] = useState(false);
  const [directKind, setDirectKind] = useState<'BACKFILL' | 'EXPLORATORY' | 'ARTICLE_LOOKUP'>('BACKFILL');
  const [directPromptId, setDirectPromptId] = useState('');
  const [directProfileId, setDirectProfileId] = useState('');
  const [directBackfillSource, setDirectBackfillSource] = useState('');
  const [directPubId, setDirectPubId] = useState('');
  const [directCollectedAt, setDirectCollectedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [directAnswer, setDirectAnswer] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryParams = {
    target_date: targetDate,
    category: categoryFilter || undefined,
    status: statusFilter || undefined,
  };
  const checklistQuery = useQuery(dailyChecklistQueryOptions(queryParams));

  const ensureMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      return ensureDailyChecklist(targetDate, csrfToken);
    },
    onSuccess: async (data) => {
      setErrorMsg(null);
      setFeedback(
        data.created_run_count > 0
          ? `已生成 ${data.created_run_count} 条待监测样本`
          : '当日核心基线清单已存在，未重复生成',
      );
      await queryClient.invalidateQueries({ queryKey: checklistKeys.all });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '生成今日清单失败'),
  });

  const directMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      if (!directPromptId || !directProfileId) throw new Error('请选择问题和监测平台');
      return createDirectObservation(
        {
          entry_kind: directKind,
          prompt_variant_id: directPromptId,
          collection_profile_id: directProfileId,
          backfill_source: directKind === 'BACKFILL' ? directBackfillSource.trim() : null,
          target_article_publication_id:
            directKind === 'ARTICLE_LOOKUP' && directPubId ? directPubId : null,
          answer_text: directAnswer.trim() || null,
          collected_at: directAnswer.trim() ? new Date(directCollectedAt).toISOString() : null,
          inline_review: directAnswer.trim()
            ? { confirm_all: true, subject_decisions: [], citation_decisions: [], comment: '直录提交' }
            : null,
        },
        csrfToken,
      );
    },
    onSuccess: async (data) => {
      setDirectOpen(false);
      setDirectAnswer('');
      setDirectBackfillSource('');
      setErrorMsg(null);
      setFeedback(`已登记单条观测（当前状态：${runStatusLabels[data.run_status]}）`);
      await queryClient.invalidateQueries({ queryKey: checklistKeys.all });
      if (data.run_status === 'PENDING') {
        setActiveRunId(data.run_id);
      }
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '单条直录失败'),
  });

  const data = checklistQuery.data;
  const items = data?.items ?? [];
  const activeItem: DailyChecklistItem | undefined = items.find((i) => i.run_id === activeRunId);

  async function handleRunCompleted() {
    await queryClient.invalidateQueries({ queryKey: checklistKeys.all });
    const nextPending = items.find((i) => i.run_id !== activeRunId && i.status === 'PENDING');
    setActiveRunId(nextPending ? nextPending.run_id : null);
    setFeedback('已保存当前记录并同步完成分析');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="今日监测"
        description="按行完成自然需求核心基线采样，或随时补录历史证据、录入探索性问题与文章定位核查。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            <Button variant="outline" onClick={() => setDirectOpen((v) => !v)}>
              + 历史补录 / 单条直录
            </Button>
            <Button
              disabled={ensureMutation.isPending}
              onClick={() => ensureMutation.mutate()}
            >
              {ensureMutation.isPending ? '生成中…' : '生成今日清单'}
            </Button>
          </div>
        }
      />

      {feedback && <InlineBanner tone="success">{feedback}</InlineBanner>}
      {errorMsg && <InlineBanner role="alert" tone="danger">{errorMsg}</InlineBanner>}

      {data && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {[
            ['计划总数', data.summary.planned_total],
            ['已完成', data.summary.completed_count],
            ['待采集', data.summary.pending_count],
            ['待判断', data.summary.needs_review_count],
            ['采集异常', data.summary.failed_count],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
              <div className="text-xs text-text-muted">{label}</div>
              <div className="mt-1 text-2xl font-semibold">{val}</div>
            </div>
          ))}
        </div>
      )}

      {directOpen && data && (
        <section className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h2 className="text-base font-medium">单条直录（无需理解 Plan/Batch 或输入 UUID）</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-text-muted">记录类型</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={directKind}
                onChange={(e) => setDirectKind(e.target.value as typeof directKind)}
              >
                <option value="BACKFILL">历史补录（保留原采集时间）</option>
                <option value="EXPLORATORY">探索性新问题（不混入固定基线）</option>
                <option value="ARTICLE_LOOKUP">文章定位核查（单独统计）</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">选择问题 *</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={directPromptId}
                onChange={(e) => setDirectPromptId(e.target.value)}
              >
                <option value="">请选择问题…</option>
                {data.prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">选择平台入口 *</label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={directProfileId}
                onChange={(e) => setDirectProfileId(e.target.value)}
              >
                <option value="">请选择平台…</option>
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {directKind === 'BACKFILL' && (
              <div>
                <label className="text-xs text-text-muted">补录来源说明 *</label>
                <Input
                  placeholder="如：上周豆包聊天记录截图"
                  value={directBackfillSource}
                  onChange={(e) => setDirectBackfillSource(e.target.value)}
                />
              </div>
            )}
            {directKind === 'ARTICLE_LOOKUP' && (
              <div>
                <label className="text-xs text-text-muted">目标发布文章（可选）</label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={directPubId}
                  onChange={(e) => setDirectPubId(e.target.value)}
                >
                  <option value="">不限定</option>
                  {data.publications.map((pub) => (
                    <option key={pub.id} value={pub.id}>
                      {pub.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-text-muted">实际采集时间</label>
              <Input
                type="datetime-local"
                value={directCollectedAt}
                onChange={(e) => setDirectCollectedAt(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted">回答原文（可选：留空则仅加入待监测队列，填写则立即分析入库）</label>
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
              value={directAnswer}
              onChange={(e) => setDirectAnswer(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDirectOpen(false)}>取消</Button>
            <Button disabled={directMutation.isPending} onClick={() => directMutation.mutate()}>
              {directMutation.isPending ? '保存中…' : '确认直录'}
            </Button>
          </div>
        </section>
      )}

      {activeItem && activeItem.status === 'PENDING' && (
        <DailyChecklistCapture
          key={activeItem.run_id}
          csrfToken={csrfToken}
          item={activeItem}
          onClose={() => setActiveRunId(null)}
          onCompleted={handleRunCompleted}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as PromptCategory | '')}
        >
          <option value="">全部问题类型</option>
          <option value="NATURAL_DEMAND">自然需求</option>
          <option value="BRAND_MODEL">品牌/型号</option>
          <option value="ARTICLE_LOOKUP">文章定位核查</option>
        </select>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RunStatus | '')}
        >
          <option value="">全部状态</option>
          <option value="PENDING">待采集</option>
          <option value="NEEDS_REVIEW">待判断</option>
          <option value="COMPLETED">已完成</option>
          <option value="FAILED">采集异常</option>
        </select>
      </div>

      {checklistQuery.isLoading ? (
        <p className="text-sm text-text-muted">正在加载今日待监测清单…</p>
      ) : checklistQuery.isError ? (
        <InlineBanner role="alert" tone="danger">
          {checklistQuery.error instanceof Error ? checklistQuery.error.message : '加载失败'}
        </InlineBanner>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
          当天暂无待监测记录。可点击右上角“生成今日清单”或“历史补录 / 单条直录”。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2.5">问题</th>
                <th className="px-4 py-2.5">类型</th>
                <th className="px-4 py-2.5">平台</th>
                <th className="px-4 py-2.5">负责人</th>
                <th className="px-4 py-2.5">状态 / 结果</th>
                <th className="px-4 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((row) => (
                <tr key={row.run_id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 max-w-md">
                    <div className="font-medium line-clamp-2">{row.prompt_text}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-text-muted">
                      {row.is_backfill && <Badge variant="outline">补录：{row.backfill_source}</Badge>}
                      {row.query_modified && <Badge variant="outline">实际已改问</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{promptCategoryLabels[row.prompt_category]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div>{row.platform_name}</div>
                    <div className="text-xs text-text-muted">{row.profile_name}</div>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{row.assignee_name ?? '未分派'}</td>
                  <td className="px-4 py-3 space-y-1">
                    <Badge variant={row.status === 'COMPLETED' ? 'default' : 'secondary'}>
                      {runStatusLabels[row.status]}
                    </Badge>
                    {row.has_brand_or_product_mention !== null && (
                      <div className="text-xs text-text-muted">
                        {row.has_brand_or_product_mention ? '命中品牌/产品' : '未提及'}
                        {row.linked_article_count > 0 ? ` · 引用 ${row.linked_article_count} 篇` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'PENDING' ? (
                      <Button size="sm" onClick={() => setActiveRunId(row.run_id)}>
                        开始录入
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {row.error_summary ?? '已入库'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
