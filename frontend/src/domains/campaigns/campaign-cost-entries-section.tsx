import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { geoInterventionKeys } from '@/domains/geo-interventions/geo-intervention.api';
import {
  campaignCostEntriesQueryOptions,
  createOperatingCostEntry,
  voidOperatingCostEntry,
  type OperatingCostEntryCreate,
} from './operations-attribution.api';

const COST_AMOUNT_RE = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

const costCategoryLabels: Record<OperatingCostEntryCreate['category'], string> = {
  LABOR: '人工工时',
  EXTERNAL_PLACEMENT: '外采投放',
  OTHER: '其他费用',
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type CampaignCostEntriesSectionProps = {
  campaignId: string;
  canRecordCost: boolean;
  csrfToken: string | null;
  onBusyChange: (busy: boolean) => void;
};

export function CampaignCostEntriesSection({
  campaignId,
  canRecordCost,
  csrfToken,
  onBusyChange,
}: CampaignCostEntriesSectionProps) {
  const queryClient = useQueryClient();
  const [includeVoided, setIncludeVoided] = useState(false);
  const [category, setCategory] = useState<OperatingCostEntryCreate['category']>('LABOR');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [incurredOn, setIncurredOn] = useState(todayIsoDate);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const costEntries = useQuery(campaignCostEntriesQueryOptions(campaignId, includeVoided));

  const invalidateCostData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-attribution', campaignId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['operations', 'campaign-cost-entries', campaignId],
      }),
      queryClient.invalidateQueries({
        queryKey: geoInterventionKeys.byCampaign(campaignId),
      }),
    ]);
  };

  const createCostMutation = useMutation({
    mutationFn: () => {
      onBusyChange(true);
      return createOperatingCostEntry(
        {
          campaign_id: campaignId,
          category,
          amount: amount.trim(),
          currency: currency.trim().toUpperCase(),
          incurred_on: incurredOn,
          note: note.trim(),
        },
        csrfToken,
      );
    },
    onSuccess: async () => {
      setAmount('');
      setNote('');
      setFormError(null);
      await invalidateCostData();
      onBusyChange(false);
    },
    onError: (err) => {
      onBusyChange(false);
      setFormError(err instanceof Error ? err.message : '登记运营费用失败');
    },
  });

  const voidCostMutation = useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) => {
      onBusyChange(true);
      return voidOperatingCostEntry(entryId, reason, csrfToken);
    },
    onSuccess: async () => {
      setVoidTargetId(null);
      setVoidReason('');
      setFormError(null);
      await invalidateCostData();
      onBusyChange(false);
    },
    onError: (err) => {
      onBusyChange(false);
      setFormError(err instanceof Error ? err.message : '作废运营费用失败');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createCostMutation.isPending) return;
    const amt = amount.trim();
    const curr = currency.trim().toUpperCase();
    if (!COST_AMOUNT_RE.test(amt)) {
      setFormError('费用金额必须为非负数字，最多 12 位整数和 2 位小数');
      return;
    }
    if (!CURRENCY_RE.test(curr)) {
      setFormError('币种必须为 3 位大写 ISO-4217 代码（如 CNY、USD）');
      return;
    }
    if (note.trim().length > 500) {
      setFormError('备注长度不能超过 500 字符');
      return;
    }
    setFormError(null);
    createCostMutation.mutate();
  };

  return (
    <section className="space-y-2 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">人工与外采运营费用台账</h3>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input
            checked={includeVoided}
            onChange={(e) => setIncludeVoided(e.target.checked)}
            type="checkbox"
          />
          显示已作废记录
        </label>
      </div>

      {formError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs" role="alert">
          {formError}
        </div>
      )}

      {canRecordCost && (
        <form
          className="grid gap-2 rounded-lg border border-border-subtle bg-surface-subtle/40 p-3 sm:grid-cols-6"
          onSubmit={handleCreateSubmit}
        >
          <select
            aria-label="费用分类"
            className="h-9 rounded-md border border-border-default bg-surface-panel px-2 text-xs"
            onChange={(e) => setCategory(e.target.value as OperatingCostEntryCreate['category'])}
            value={category}
          >
            <option value="LABOR">人工工时</option>
            <option value="EXTERNAL_PLACEMENT">外采投放</option>
            <option value="OTHER">其他费用</option>
          </select>
          <Input
            aria-label="费用金额"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金额（如 800.00）"
            required
            value={amount}
          />
          <Input
            aria-label="币种"
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="CNY / USD"
            required
            value={currency}
          />
          <Input
            aria-label="发生日期"
            onChange={(e) => setIncurredOn(e.target.value)}
            required
            type="date"
            value={incurredOn}
          />
          <Input
            aria-label="费用备注"
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            value={note}
          />
          <Button disabled={createCostMutation.isPending} size="sm" type="submit">
            {createCostMutation.isPending ? '登记中…' : '登记费用'}
          </Button>
        </form>
      )}

      {costEntries.isPending ? (
        <p className="text-xs text-text-muted">正在加载运营费用台账…</p>
      ) : costEntries.error && !costEntries.data ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs" role="alert">
          <span>
            {costEntries.error instanceof Error ? costEntries.error.message : '加载运营费用台账失败'}
          </span>
          <Button onClick={() => void costEntries.refetch()} size="sm" type="button" variant="outline">
            重试
          </Button>
        </div>
      ) : costEntries.data && costEntries.data.items.length > 0 ? (
        <div className="space-y-1.5">
          {costEntries.data.total > costEntries.data.items.length && (
            <p className="text-xs text-text-muted">
              当前展示最新 {costEntries.data.items.length} 条，共 {costEntries.data.total} 条台账记录。
            </p>
          )}
          <ul className="space-y-1.5 text-xs">
            {costEntries.data.items.map((entry) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle p-2.5"
                key={entry.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{costCategoryLabels[entry.category]}</Badge>
                    <strong className="font-mono">
                      {entry.amount} {entry.currency}
                    </strong>
                    <span className="text-text-muted">{entry.incurred_on}</span>
                    {entry.is_voided && <Badge variant="secondary">已作废</Badge>}
                  </div>
                  {entry.note && <p className="mt-0.5 text-text-secondary">{entry.note}</p>}
                  {entry.void_reason && (
                    <p className="mt-0.5 text-text-muted">作废原因：{entry.void_reason}</p>
                  )}
                </div>
                {!entry.is_voided && (
                  voidTargetId === entry.id ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        aria-label="作废原因"
                        className="h-8 w-44 text-xs"
                        maxLength={300}
                        onChange={(e) => setVoidReason(e.target.value)}
                        placeholder="填写作废原因"
                        value={voidReason}
                      />
                      <Button
                        disabled={voidCostMutation.isPending || !voidReason.trim()}
                        onClick={() => {
                          if (voidCostMutation.isPending) return;
                          voidCostMutation.mutate({
                            entryId: entry.id,
                            reason: voidReason.trim(),
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        确认作废
                      </Button>
                      <Button
                        disabled={voidCostMutation.isPending}
                        onClick={() => {
                          setVoidTargetId(null);
                          setVoidReason('');
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button
                      disabled={voidCostMutation.isPending}
                      onClick={() => {
                        setVoidTargetId(entry.id);
                        setVoidReason('');
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      作废
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-text-muted">暂无运营费用台账记录。</p>
      )}
    </section>
  );
}
