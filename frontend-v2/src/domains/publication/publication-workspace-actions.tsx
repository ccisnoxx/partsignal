import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Controller,
  useForm,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { z } from 'zod';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import {
  StickyActionBar,
  type StickyAction,
} from '@/design-system/workspace/sticky-action-bar';
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
import type { components } from '@/shared/api/generated/schema';
import {
  closePublicationWork,
  mapPublicationError,
  markPublicationPlatformReview,
  registerPublicationResult,
  updatePublicationPreparation,
  type PublicationStartErrorMapping,
} from './publication.api';
import { PublicationEvidenceUpload } from './publication-evidence-upload';
import {
  closeFormSchema,
  platformReviewFormSchema,
  preparationFormSchema,
  publicationCoreActions,
  resultFormSchema,
  type PublicationCoreAction,
  type PublicationWorkspaceContext,
} from './publication-workspace.model';

type PublicationWork = components['schemas']['PublicationWork'];
type FileRecord = components['schemas']['FileRecord'];
type PreparationValues = z.infer<typeof preparationFormSchema>;
type PlatformReviewValues = z.infer<typeof platformReviewFormSchema>;
type ResultValues = z.infer<typeof resultFormSchema>;
type CloseValues = z.infer<typeof closeFormSchema>;

type PublicationWorkspaceActionsProps = {
  context: PublicationWorkspaceContext;
  csrfToken: string | null;
  onCanonicalWork: (work: PublicationWork) => Promise<void>;
  onReload: () => Promise<void>;
};

type Command =
  | { action: 'UPDATE_PREPARATION'; values: PreparationValues }
  | { action: 'MARK_PLATFORM_REVIEW'; values: PlatformReviewValues }
  | { action: 'REGISTER_RESULT'; values: ResultValues; attachmentFileIds: string[] }
  | { action: 'CLOSE'; values: CloseValues };

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PublicationWorkspaceActions({
  context,
  csrfToken,
  onCanonicalWork,
  onReload,
}: PublicationWorkspaceActionsProps) {
  const [openAction, setOpenAction] = useState<PublicationCoreAction>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const [contextStale, setContextStale] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastActionRef = useRef<PublicationCoreAction | undefined>(undefined);
  const preparation = useForm<PreparationValues>({
    defaultValues: {
      platformAccountId: context.work.platform_account_id ?? '',
      comment: '',
    },
    resolver: zodResolver(preparationFormSchema),
  });
  const platformReview = useForm<PlatformReviewValues>({
    defaultValues: { comment: '' },
    resolver: zodResolver(platformReviewFormSchema),
  });
  const result = useForm<ResultValues>({
    defaultValues: {
      actualTitle: context.work.actual_title ?? context.content.title,
      finalUrl: context.work.final_url ?? '',
      publishedAt: toLocalDateTime(context.work.published_at),
      comment: '',
    },
    resolver: zodResolver(resultFormSchema),
  });
  const close = useForm<CloseValues>({
    defaultValues: { reason: 'OTHER', comment: '' },
    resolver: zodResolver(closeFormSchema),
  });

  const mutation = useMutation({
    mutationFn: (command: Command) => {
      const revision = context.work.revision;
      switch (command.action) {
        case 'UPDATE_PREPARATION':
          return updatePublicationPreparation(context.work.id, {
            platform_account_id: command.values.platformAccountId,
            expected_revision: revision,
            comment: command.values.comment,
          }, csrfToken);
        case 'MARK_PLATFORM_REVIEW':
          return markPublicationPlatformReview(context.work.id, {
            expected_revision: revision,
            comment: command.values.comment,
          }, csrfToken);
        case 'REGISTER_RESULT':
          return registerPublicationResult(context.work.id, {
            actual_title: command.values.actualTitle,
            final_url: command.values.finalUrl,
            published_at: new Date(command.values.publishedAt).toISOString(),
            expected_revision: revision,
            comment: command.values.comment,
            attachment_file_ids: command.attachmentFileIds,
          }, csrfToken);
        case 'CLOSE':
          return closePublicationWork(context.work.id, {
            reason: command.values.reason,
            comment: command.values.comment,
            expected_revision: revision,
          }, csrfToken);
      }
    },
  });

  const dirty = preparation.formState.isDirty
    || platformReview.formState.isDirty
    || result.formState.isDirty
    || close.formState.isDirty
    || uploadedFiles.length > 0;

  async function run(command: Command) {
    if (mutation.isPending || contextStale) return;
    setServerError(undefined);
    try {
      const work = await mutation.mutateAsync(command);
      if (command.action === 'UPDATE_PREPARATION') {
        preparation.reset({ platformAccountId: work.platform_account_id ?? '', comment: '' });
      } else if (command.action === 'MARK_PLATFORM_REVIEW') {
        platformReview.reset({ comment: '' });
      } else if (command.action === 'REGISTER_RESULT') {
        result.reset({
          actualTitle: work.actual_title ?? '',
          finalUrl: work.final_url ?? '',
          publishedAt: toLocalDateTime(work.published_at),
          comment: '',
        });
        setUploadedFiles([]);
      } else {
        close.reset({ reason: 'OTHER', comment: '' });
      }
      await onCanonicalWork(work);
      setOpenAction(undefined);
    } catch (error) {
      const mapped = mapPublicationError(error);
      setServerError(mapped);
      if (mapped.status === 409) setContextStale(true);
    }
  }

  const actions: StickyAction[] = publicationCoreActions(context.work).map((item) => {
    const base = {
      key: item.action,
      label: item.label,
      enabled: !mutation.isPending && !contextStale,
      disabledReason: contextStale ? '工作已变化，请先显式重载' : '正在提交',
      onSelect: () => {
        if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
        lastActionRef.current = item.action;
        setServerError(undefined);
        setOpenAction(item.action);
      },
    };
    return item.intent === 'danger' ? {
      ...base,
      intent: 'danger',
      confirmation: {
        title: '关闭发布工作？',
        description: '关闭为终态操作；仍需在下一步填写原因并提交。',
        confirmLabel: '继续填写',
      },
    } : { ...base, intent: item.intent };
  });

  const errors: ErrorSummaryItem[] = serverError ? [
    { id: 'server', message: serverError.message },
    ...(serverError.requestId
      ? [{ id: 'request-id', message: `请求 ID：${serverError.requestId}` }]
      : []),
  ] : [];

  async function reloadContext() {
    try {
      await onReload();
      setContextStale(false);
      setServerError(undefined);
    } catch (error) {
      setServerError(mapPublicationError(error));
    }
  }

  return (
    <>
      <DirtyGuard when={dirty || uploadedFiles.length > 0} />
      <StickyActionBar
        actions={actions}
        status={contextStale
          ? <span className="text-destructive">工作已变化；表单与文件已保留，请显式重载。</span>
          : `服务端修订号 ${context.work.revision}`}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!mutation.isPending && !open) {
            setOpenAction(undefined);
            setServerError(undefined);
          }
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            document.querySelector<HTMLElement>(
              `[data-action-key="${lastActionRef.current}"]`,
            )?.focus();
          }
        }}
        open={Boolean(openAction)}
      >
        <DialogContent finalFocus={() => returnFocusRef.current} showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>{openAction ? actionTitle(openAction) : '发布操作'}</DialogTitle>
            <DialogDescription>提交时服务端会重新校验状态、权限和修订号。</DialogDescription>
          </DialogHeader>
          <ErrorSummary errors={errors} title="发布操作未完成" />
          {contextStale && (
            <Button onClick={() => void reloadContext()} type="button" variant="outline">
              显式重载最新工作
            </Button>
          )}
          {openAction === 'UPDATE_PREPARATION' && (
            <form className="space-y-4" onSubmit={preparation.handleSubmit((values) => run({ action: 'UPDATE_PREPARATION', values }))}>
              <Controller
                control={preparation.control}
                name="platformAccountId"
                render={({ field, fieldState }) => (
                  <label className="block space-y-1.5">
                    <span className="font-medium">发布账号</span>
                    <Select
                      disabled={mutation.isPending || contextStale}
                      items={context.eligible_accounts.map((account) => ({ value: account.id, label: `${account.label} · ${account.account_identifier}` }))}
                      onValueChange={(value) => field.onChange(value ?? '')}
                      value={field.value || null}
                    >
                      <SelectTrigger aria-invalid={fieldState.invalid} className="w-full max-w-full">
                        <SelectValue placeholder="请选择发布账号" />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {context.eligible_accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>{account.label} · {account.account_identifier}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.error && <span className="text-xs text-destructive">{fieldState.error.message}</span>}
                  </label>
                )}
              />
              <CommentField disabled={mutation.isPending || contextStale} form={preparation} name="comment" />
              <FormFooter pending={mutation.isPending} />
            </form>
          )}
          {openAction === 'MARK_PLATFORM_REVIEW' && (
            <form className="space-y-4" onSubmit={platformReview.handleSubmit((values) => run({ action: 'MARK_PLATFORM_REVIEW', values }))}>
              <CommentField disabled={mutation.isPending || contextStale} form={platformReview} name="comment" />
              <FormFooter pending={mutation.isPending} />
            </form>
          )}
          {openAction === 'REGISTER_RESULT' && (
            <form className="space-y-4" onSubmit={result.handleSubmit((values) => run({ action: 'REGISTER_RESULT', values, attachmentFileIds: uploadedFiles.map((file) => file.id) }))}>
              <TextField disabled={mutation.isPending || contextStale} form={result} label="实际发布标题" name="actualTitle" />
              <TextField disabled={mutation.isPending || contextStale} form={result} label="最终 URL" name="finalUrl" type="url" />
              <TextField disabled={mutation.isPending || contextStale} form={result} label="发布时间" name="publishedAt" type="datetime-local" />
              <CommentField disabled={mutation.isPending || contextStale} form={result} name="comment" />
              <div className="space-y-2">
                <p className="font-medium">证据截图</p>
                <PublicationEvidenceUpload
                  csrfToken={csrfToken}
                  disabled={mutation.isPending || contextStale}
                  onUploaded={(file) => setUploadedFiles((files) => [...files, file])}
                />
                {uploadedFiles.map((file) => <p className="text-sm text-text-secondary" key={file.id}>已校验：{file.original_filename}</p>)}
              </div>
              <FormFooter pending={mutation.isPending} />
            </form>
          )}
          {openAction === 'CLOSE' && (
            <form className="space-y-4" onSubmit={close.handleSubmit((values) => run({ action: 'CLOSE', values }))}>
              <label className="block space-y-1.5">
                <span className="font-medium">关闭原因</span>
                <select className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm" {...close.register('reason')}>
                  <option value="PLATFORM_REJECTED">平台拒绝</option>
                  <option value="BUSINESS_CANCELLED">业务取消</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <CommentField disabled={mutation.isPending || contextStale} form={close} name="comment" />
              <FormFooter pending={mutation.isPending} destructive />
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TextField<T extends FieldValues>({ disabled, form, label, name, type = 'text' }: {
  disabled: boolean;
  form: UseFormReturn<T>;
  label: string;
  name: FieldPath<T>;
  type?: string;
}) {
  const error = form.getFieldState(name).error?.message;
  return (
    <label className="block space-y-1.5">
      <span className="font-medium">{label}</span>
      <Input aria-invalid={Boolean(error)} disabled={disabled} type={type} {...form.register(name)} />
      {typeof error === 'string' && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

function CommentField<T extends FieldValues>({ disabled, form, name }: {
  disabled: boolean;
  form: UseFormReturn<T>;
  name: FieldPath<T>;
}) {
  const error = form.getFieldState(name).error?.message;
  return (
    <label className="block space-y-1.5">
      <span className="font-medium">备注</span>
      <textarea
        aria-invalid={Boolean(error)}
        className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
        disabled={disabled}
        {...form.register(name)}
      />
      {typeof error === 'string' && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

function FormFooter({ destructive = false, pending }: { destructive?: boolean; pending: boolean }) {
  return (
    <DialogFooter>
      <DialogClose disabled={pending} render={<Button type="button" variant="outline" />}>取消</DialogClose>
      <Button disabled={pending} type="submit" variant={destructive ? 'destructive' : 'default'}>
        {pending ? '正在提交…' : '确认提交'}
      </Button>
    </DialogFooter>
  );
}

function actionTitle(action: PublicationCoreAction) {
  return {
    UPDATE_PREPARATION: '更新准备信息',
    MARK_PLATFORM_REVIEW: '标记平台处理中',
    REGISTER_RESULT: '登记发布结果',
    CLOSE: '关闭发布工作',
  }[action];
}

export { PublicationWorkspaceActions };
export type { PublicationWorkspaceActionsProps };
