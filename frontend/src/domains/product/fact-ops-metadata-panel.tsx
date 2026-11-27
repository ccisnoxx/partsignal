import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
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
  factConfirmReviewSchema,
  mapFactConfirmReviewError,
  toDateTimeLocalInput,
  type FactConfirmReviewValues,
  type FactWorkspace,
  type FactWorkspaceField,
  type FactWorkspaceFormValues,
} from './fact-workspace.model';

const textareaClassName =
  'min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted';

function FactOpsMetadataFields({
  disabled,
  fieldIds,
}: {
  disabled: boolean;
  fieldIds: Record<FactWorkspaceField, string>;
}) {
  return (
    <div className="space-y-4 border-t border-border-subtle pt-4">
      <div>
        <p className="type-label text-text-muted">运营治理元数据（仅内部，不外发第三方 AI）</p>
        <p className="mt-1 text-xs text-text-secondary">
          外部负责人与下次复核时间用于事实新鲜度治理，调整不会使已批准事实失效。
        </p>
      </div>
      <FormField<FactWorkspaceFormValues, 'source_owner'>
        id={fieldIds.source_owner}
        label="外部事实负责人"
        name="source_owner"
        render={(context) => (
          <Input
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            disabled={disabled}
            id={context.inputId}
            maxLength={160}
            placeholder="例如：产品经理 / FAE 姓名"
          />
        )}
      />
      <FormField<FactWorkspaceFormValues, 'next_review_at'>
        id={fieldIds.next_review_at}
        label="下次复核时间"
        name="next_review_at"
        render={(context) => (
          <Input
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            disabled={disabled}
            id={context.inputId}
            type="datetime-local"
          />
        )}
      />
      <div className="border-t border-border-subtle pt-4">
        <p className="type-label text-text-muted">随审核冻结的约束元数据</p>
        <p className="mt-1 text-xs text-text-secondary">
          以下 5 项在提交审核时随 FactVersion 不可变冻结；其中外部资料编号仅内部追溯、不外发第三方 AI。
        </p>
      </div>
      <FormField<FactWorkspaceFormValues, 'source_reference'>
        id={fieldIds.source_reference}
        label="外部资料编号"
        name="source_reference"
        render={(context) => (
          <Input
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            disabled={disabled}
            id={context.inputId}
            maxLength={500}
            placeholder="例如：DS-2026-04 / FAE 评审单号"
          />
        )}
      />
      <FormField<FactWorkspaceFormValues, 'verified_at'>
        id={fieldIds.verified_at}
        label="最近业务确认时间"
        name="verified_at"
        render={(context) => (
          <Input
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            disabled={disabled}
            id={context.inputId}
            type="datetime-local"
          />
        )}
      />
      <FormField<FactWorkspaceFormValues, 'applicable_region'>
        id={fieldIds.applicable_region}
        label="适用市场或地区"
        name="applicable_region"
        render={(context) => (
          <Input
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            disabled={disabled}
            id={context.inputId}
            maxLength={160}
            placeholder="例如：中国大陆 / 全球"
          />
        )}
      />
      <FormField<FactWorkspaceFormValues, 'content_restrictions'>
        id={fieldIds.content_restrictions}
        label="禁止公开表达"
        name="content_restrictions"
        render={(context) => (
          <textarea
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            className={textareaClassName}
            disabled={disabled}
            id={context.inputId}
            maxLength={4000}
            placeholder="例如：禁止宣称 100% Pin-to-Pin 直接替代、禁止披露未量产批次价格"
          />
        )}
      />
      <FormField<FactWorkspaceFormValues, 'approved_claims_summary'>
        id={fieldIds.approved_claims_summary}
        label="允许公开的核心结论摘要"
        name="approved_claims_summary"
        render={(context) => (
          <textarea
            {...context.field}
            aria-describedby={context['aria-describedby']}
            aria-invalid={context['aria-invalid']}
            className={textareaClassName}
            disabled={disabled}
            id={context.inputId}
            maxLength={4000}
            placeholder="提炼业务方允许公开传播的核心卖点与边界结论"
          />
        )}
      />
    </div>
  );
}

function ConfirmReviewDialog({
  blocked = false,
  confirming,
  defaultNextReviewAt,
  onClose,
  onConfirm,
  pendingBlocker,
}: {
  blocked?: boolean;
  confirming: boolean;
  defaultNextReviewAt: string | null;
  onClose: () => void;
  onConfirm: (values: FactConfirmReviewValues) => Promise<FactWorkspace | undefined>;
  pendingBlocker?: { message: string; requestId: string };
}) {
  const [requestId, setRequestId] = useState<string>();
  const [locallyBlocked, setLocallyBlocked] = useState(false);
  const form = useForm<FactConfirmReviewValues>({
    defaultValues: { next_review_at: toDateTimeLocalInput(defaultNextReviewAt) },
    resolver: zodResolver(factConfirmReviewSchema),
  });

  async function submitValues(values: FactConfirmReviewValues) {
    form.clearErrors();
    setRequestId(undefined);
    try {
      const updated = await onConfirm(values);
      if (!updated) return;
      form.reset();
    } catch (error) {
      const mapped = mapFactConfirmReviewError(error);
      if (mapped.fields.next_review_at) {
        form.setError('next_review_at', { type: 'server', message: mapped.fields.next_review_at });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
      if (mapped.recovery === 'FACT_REVIEW_PENDING' || mapped.recovery === 'INVALID_STATE_TRANSITION') {
        setLocallyBlocked(true);
      }
    }
  }

  const submitBlocked = blocked || locallyBlocked || Boolean(pendingBlocker);
  const errors: ErrorSummaryItem[] = [];
  const nextReviewError = form.formState.errors.next_review_at?.message;
  if (nextReviewError) {
    errors.push({ id: 'next_review_at', fieldId: 'fact-confirm-next-review-at', message: nextReviewError });
  }
  const formMessage = form.formState.errors.root?.server?.message;
  const displayedMessage = formMessage ?? pendingBlocker?.message;
  const displayedRequestId = requestId ?? pendingBlocker?.requestId;
  if (displayedMessage) errors.push({ id: 'form', message: displayedMessage });
  if (displayedRequestId) errors.push({ id: 'request-id', message: `请求 ID：${displayedRequestId}` });

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>确认无变更并延期复核</DialogTitle>
          <DialogDescription>
            确认当前已批准事实内容无需修改，仅更新下次复核时间并记录审计，不创建新的 FactVersion。
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form
            className="space-y-4"
            id="fact-confirm-review-form"
            noValidate
            onSubmit={form.handleSubmit(submitValues)}
          >
            <ErrorSummary errors={errors} />
            <FormField<FactConfirmReviewValues, 'next_review_at'>
              description="必须晚于当前时间。"
              id="fact-confirm-next-review-at"
              label="新的下次复核时间"
              name="next_review_at"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  disabled={confirming || submitBlocked}
                  id={context.inputId}
                  type="datetime-local"
                />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose render={<Button disabled={confirming} variant="outline" />}>取消</DialogClose>
          <Button disabled={confirming || submitBlocked} form="fact-confirm-review-form" type="submit">
            {confirming ? '确认中…' : '确认延期复核'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmReviewDialog, FactOpsMetadataFields };
