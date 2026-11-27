import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

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
import { campaignListQueryOptions } from './campaign.api';
import {
  campaignPrimaryTaskLabels,
  campaignStatusRegistry,
  campaignStatusValues,
  workPriorityRegistry,
  workPriorityValues,
  type CampaignsSearch,
  type ContentCampaignStatus,
  type WorkPriority,
} from './campaign.model';

type CampaignListPageProps = {
  search: CampaignsSearch;
  onSearchChange: (next: CampaignsSearch) => Promise<void> | void;
};

const ALL_VALUE = '__ALL__';

function CampaignListPage({ search, onSearchChange }: CampaignListPageProps) {
  const [queryText, setQueryText] = useState(search.q ?? '');
  const campaigns = useQuery(campaignListQueryOptions(search));

  const statusItems = [
    { value: ALL_VALUE, label: '全部状态' },
    ...campaignStatusValues.map((value) => ({ value, label: campaignStatusRegistry[value].label })),
  ];
  const priorityItems = [
    { value: ALL_VALUE, label: '全部优先级' },
    ...workPriorityValues.map((value) => ({ value, label: workPriorityRegistry[value].label })),
  ];

  const totalPages = campaigns.data
    ? Math.max(1, Math.ceil(campaigns.data.total / campaigns.data.page_size))
    : 1;

  return (
    <section className="space-y-6" aria-labelledby="campaigns-page-title">
      <PageHeader
        actions={
          <Link className={buttonVariants()} to="/content/campaigns/new">
            新建内容活动
          </Link>
        }
        description="按活动维度组织目标产品、问题主题、内容平台与 GEO 监测计划，串联内容任务与发布成果归因。"
        title="内容活动"
        titleId="campaigns-page-title"
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-subtle bg-surface-panel p-4">
        <form
          className="flex min-w-60 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onSearchChange({ ...search, q: queryText.trim() || undefined, page: 1 });
          }}
        >
          <Input
            aria-label="搜索内容活动"
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="搜索活动名称、说明或受众"
            value={queryText}
          />
          <Button type="submit" variant="outline">搜索</Button>
        </form>

        <div className="w-40">
          <Select
            items={statusItems}
            onValueChange={(next) => void onSearchChange({
              ...search,
              status: !next || next === ALL_VALUE ? undefined : (next as ContentCampaignStatus),
              page: 1,
            })}
            value={search.status ?? ALL_VALUE}
          >
            <SelectTrigger aria-label="按活动状态筛选">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-40">
          <Select
            items={priorityItems}
            onValueChange={(next) => void onSearchChange({
              ...search,
              priority: !next || next === ALL_VALUE ? undefined : (next as WorkPriority),
              page: 1,
            })}
            value={search.priority ?? ALL_VALUE}
          >
            <SelectTrigger aria-label="按优先级筛选">
              <SelectValue placeholder="全部优先级" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {priorityItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(search.q || search.status || search.priority) && (
          <Button
            onClick={() => {
              setQueryText('');
              void onSearchChange({ page: 1, pageSize: search.pageSize });
            }}
            type="button"
            variant="ghost"
          >
            重置筛选
          </Button>
        )}
      </div>

      {campaigns.isPending && (
        <div className="rounded-xl border border-border-subtle p-6 text-sm text-text-secondary" aria-busy="true">
          正在加载内容活动…
        </div>
      )}

      {campaigns.isError && (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
          <p className="text-sm">{campaigns.error instanceof Error ? campaigns.error.message : String(campaigns.error)}</p>
          <Button onClick={() => void campaigns.refetch()} type="button" variant="outline">重试</Button>
        </div>
      )}

      {campaigns.data && campaigns.data.items.length === 0 && (
        <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-8 text-center">
          <p className="text-sm text-text-secondary">当前筛选条件下暂无内容活动。</p>
          <Link className={buttonVariants({ variant: 'outline' })} to="/content/campaigns/new">
            创建首个内容活动
          </Link>
        </div>
      )}

      {campaigns.data && campaigns.data.items.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-panel">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-subtle bg-surface-muted/50 text-xs text-text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">活动</th>
                  <th className="px-4 py-3 font-medium">状态与优先级</th>
                  <th className="px-4 py-3 font-medium">负责人</th>
                  <th className="px-4 py-3 font-medium">关联范围</th>
                  <th className="px-4 py-3 font-medium">产出进度</th>
                  <th className="px-4 py-3 font-medium">下一步</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {campaigns.data.items.map((item) => {
                  const statusMeta = campaignStatusRegistry[item.status];
                  const priorityMeta = workPriorityRegistry[item.priority];
                  return (
                    <tr className="hover:bg-surface-muted/30" key={item.id}>
                      <td className="px-4 py-3">
                        <Link
                          className="font-medium text-primary hover:underline"
                          params={{ campaignId: item.id }}
                          to="/content/campaigns/$campaignId"
                        >
                          {item.name}
                        </Link>
                        {item.target_audience && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
                            受众：{item.target_audience}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>
                          <Badge variant={priorityMeta.tone}>{priorityMeta.label}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {item.owner.display_name}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        产品 {item.counts.product_count} · 主题 {item.counts.topic_count} · 平台 {item.counts.platform_count}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        任务 {item.counts.task_count} · 已发布 {item.counts.published_article_count}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        {campaignPrimaryTaskLabels[item.primary_task]}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {item.available_actions.includes('PLAN_TASKS') && (
                            <a
                              className={buttonVariants({ size: 'sm', variant: 'outline' })}
                              href={`/content/tasks/new?campaignId=${encodeURIComponent(item.id)}`}
                            >
                              新建任务
                            </a>
                          )}
                          <Link
                            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                            params={{ campaignId: item.id }}
                            to="/content/campaigns/$campaignId"
                          >
                            详情
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>共 {campaigns.data.total} 个活动，第 {campaigns.data.page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <Button
                disabled={campaigns.data.page <= 1}
                onClick={() => void onSearchChange({ ...search, page: Math.max(1, search.page - 1) })}
                size="sm"
                type="button"
                variant="outline"
              >
                上一页
              </Button>
              <Button
                disabled={campaigns.data.page >= totalPages}
                onClick={() => void onSearchChange({ ...search, page: search.page + 1 })}
                size="sm"
                type="button"
                variant="outline"
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export { CampaignListPage };
export type { CampaignListPageProps };
