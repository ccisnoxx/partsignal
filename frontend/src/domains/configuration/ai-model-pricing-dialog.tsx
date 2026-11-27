import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

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
  aiModelPricingQueryOptions,
  isRevisionConflictError,
  operationsDashboardKeys,
  updateAIModelPricing,
  type AIModelPricingOut,
} from '@/domains/campaigns/operations-attribution.api';
import { aiChannelKeys } from './ai-channel.api';

const PRICE_PER_1M_RE = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

type AIModelPricingButtonProps = {
  modelId: string;
  modelDisplayName: string;
  csrfToken: string | null;
  disabled?: boolean;
};

export function AIModelPricingButton({
  modelId,
  modelDisplayName,
  csrfToken,
  disabled = false,
}: AIModelPricingButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        定价
      </Button>
      {open && (
        <AIModelPricingDialog
          csrfToken={csrfToken}
          modelDisplayName={modelDisplayName}
          modelId={modelId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AIModelPricingDialog({
  modelId,
  modelDisplayName,
  csrfToken,
  onClose,
}: Omit<AIModelPricingButtonProps, 'disabled'> & { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const pricing = useQuery(aiModelPricingQueryOptions(modelId));

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving) onClose(); }} open>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>模型定价 · {modelDisplayName}</DialogTitle>
          <DialogDescription>
            配置每百万 Token 单价与 3 位大写币种。未配置时作业冻结成本保持 NULL（绝不伪造 0）；更新单价不改写历史冻结成本，也不重置模型测试或启用状态。
          </DialogDescription>
        </DialogHeader>
        {pricing.isPending ? (
          <p className="py-6 text-center text-sm text-text-muted">正在加载定价配置…</p>
        ) : pricing.error && !pricing.data ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
              {pricing.error instanceof Error ? pricing.error.message : '加载定价配置失败'}
            </div>
            <DialogFooter>
              <Button onClick={() => void pricing.refetch()} type="button" variant="outline">
                重试加载
              </Button>
              <DialogClose render={<Button type="button" variant="outline">关闭</Button>} />
            </DialogFooter>
          </div>
        ) : pricing.data ? (
          <AIModelPricingForm
            csrfToken={csrfToken}
            key={`${pricing.data.model_id}:${pricing.data.revision}`}
            onClose={onClose}
            onPendingChange={setSaving}
            onReloadPricing={() => void pricing.refetch()}
            pricing={pricing.data}
            reloading={pricing.isFetching}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AIModelPricingForm({
  pricing,
  csrfToken,
  onClose,
  onPendingChange,
  onReloadPricing,
  reloading,
}: {
  pricing: AIModelPricingOut;
  csrfToken: string | null;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onReloadPricing: () => void;
  reloading: boolean;
}) {
  const queryClient = useQueryClient();
  const [inputPrice, setInputPrice] = useState(pricing.input_price_per_1m_tokens ?? '');
  const [outputPrice, setOutputPrice] = useState(pricing.output_price_per_1m_tokens ?? '');
  const [currency, setCurrency] = useState(pricing.price_currency ?? 'USD');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasRevisionConflict, setHasRevisionConflict] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (clearPricing: boolean) => {
      onPendingChange(true);
      return updateAIModelPricing(
        pricing.model_id,
        clearPricing
          ? {
              input_price_per_1m_tokens: null,
              output_price_per_1m_tokens: null,
              price_currency: null,
              expected_revision: pricing.revision,
            }
          : {
              input_price_per_1m_tokens: inputPrice.trim(),
              output_price_per_1m_tokens: outputPrice.trim(),
              price_currency: currency.trim().toUpperCase(),
              expected_revision: pricing.revision,
            },
        csrfToken,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: operationsDashboardKeys.aiModelPricing(pricing.model_id),
        }),
        queryClient.invalidateQueries({
          queryKey: aiChannelKeys.models(pricing.channel_id),
        }),
      ]);
      onPendingChange(false);
      onClose();
    },
    onError: (err) => {
      onPendingChange(false);
      setHasRevisionConflict(isRevisionConflictError(err));
      setSubmitError(err instanceof Error ? err.message : '更新模型定价失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMutation.isPending) return;
    const inVal = inputPrice.trim();
    const outVal = outputPrice.trim();
    const currVal = currency.trim().toUpperCase();
    if (!PRICE_PER_1M_RE.test(inVal) || !PRICE_PER_1M_RE.test(outVal)) {
      setSubmitError('输入/输出单价必须为非负十进制数字，最多 8 位整数与 6 位小数');
      setHasRevisionConflict(false);
      return;
    }
    if (!CURRENCY_RE.test(currVal)) {
      setSubmitError('币种必须为 3 位大写 ISO-4217 代码（如 USD、CNY）');
      setHasRevisionConflict(false);
      return;
    }
    setSubmitError(null);
    setHasRevisionConflict(false);
    saveMutation.mutate(false);
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {submitError && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs" role="alert">
          <p>{submitError}</p>
          {hasRevisionConflict && (
            <Button
              disabled={reloading}
              onClick={onReloadPricing}
              size="sm"
              type="button"
              variant="outline"
            >
              {reloading ? '正在重新加载…' : '重新加载最新定价'}
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">输入单价（/1M Token）</span>
          <Input
            onChange={(e) => setInputPrice(e.target.value)}
            placeholder="如 2.5"
            required
            value={inputPrice}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">输出单价（/1M Token）</span>
          <Input
            onChange={(e) => setOutputPrice(e.target.value)}
            placeholder="如 10.0"
            required
            value={outputPrice}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-text-secondary">币种（ISO-4217）</span>
          <Input
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="USD / CNY"
            required
            value={currency}
          />
        </label>
      </div>
      <p className="text-xs text-text-muted">当前模型版本：r{pricing.revision}</p>
      <DialogFooter className="flex flex-wrap justify-between gap-2">
        {pricing.pricing_configured ? (
          <Button
            disabled={saveMutation.isPending}
            onClick={() => {
              if (saveMutation.isPending) return;
              setSubmitError(null);
              setHasRevisionConflict(false);
              saveMutation.mutate(true);
            }}
            type="button"
            variant="outline"
          >
            清空单价
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button
            disabled={saveMutation.isPending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={saveMutation.isPending} type="submit">
            {saveMutation.isPending ? '保存中…' : '保存单价'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
