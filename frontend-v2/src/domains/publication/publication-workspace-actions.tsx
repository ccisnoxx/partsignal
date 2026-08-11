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
  switchPublicationContentVersion,
  updatePublicationPreparation,
  verifyPublicationWork,
  type PublicationStartErrorMapping,
} from './publication.api';
import { PublicationEvidenceUpload } from './publication-evidence-upload';
import {
  closeFormSchema,
  platformReviewFormSchema,
  preparationFormSchema,
  publicationVerificationPayload,
  publicationWorkspaceActions,
  resultFormSchema,
  switchContentVersionFormSchema,
  verificationFormSchema,
  type PublicationWorkspaceAction,
  type PublicationWorkspaceContext,
} from './publication-workspace.model';

type PublicationWork = components['schemas']['PublicationWork'];
type FileRecord = components['schemas']['FileRecord'];
type PreparationValues = z.infer<typeof preparationFormSchema>;
type PlatformReviewValues = z.infer<typeof platformReviewFormSchema>;
type ResultValues = z.infer<typeof resultFormSchema>;
type CloseValues = z.infer<typeof closeFormSchema>;
type VerificationValues = z.infer<typeof verificationFormSchema>;
type SwitchContentVersionValues = z.infer<typeof switchContentVersionFormSchema>;

type PublicationWorkspaceActionsProps = {
  context: PublicationWorkspaceContext;
  csrfToken: string | null;
  onCanonicalWork: (work: PublicationWork) => Promise<void>;
  onReload: () => Promise<PublicationWorkspaceContext>;
};

type Command =
  | { action: 'UPDATE_PREPARATION'; values: PreparationValues }
  | { action: 'MARK_PLATFORM_REVIEW'; values: PlatformReviewValues }
  | { action: 'REGISTER_RESULT'; values: ResultValues; attachmentFileIds: string[] }
  | { action: 'VERIFY'; values: VerificationValues }
  | { action: 'SWITCH_CONTENT_VERSION'; values: SwitchContentVersionValues; contentVersionId: string }
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
  const [openAction, setOpenAction] = useState<PublicationWorkspaceAction>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const [contextStale, setContextStale] = useState(false);
  const [focusContentVersionOnClose, setFocusContentVersionOnClose] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastActionRef = useRef<PublicationWorkspaceAction | undefined>(undefined);
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
  const verification = useForm<VerificationValues>({
    defaultValues: { comment: '' },
    resolver: zodResolver(verificationFormSchema),
  });
  const switchContentVersion = useForm<SwitchContentVersionValues>({
    defaultValues: { comment: '' },
    resolver: zodResolver(switchContentVersionFormSchema),
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
        case 'VERIFY':
          return verifyPublicationWork(
            context.work.id,
            publicationVerificationPayload(command.values, revision),
            csrfToken,
          );
        case 'SWITCH_CONTENT_VERSION':
          return switchPublicationContentVersion(context.work.id, {
            content_version_id: command.contentVersionId,
            expected_revision: revision,
            comment: command.values.comment,
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
    || verification.formState.isDirty
    || switchContentVersion.formState.isDirty
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
      } else if (command.action === 'VERIFY') {
        verification.reset({ comment: '' });
      } else if (command.action === 'SWITCH_CONTENT_VERSION') {
        switchContentVersion.reset({ comment: '' });
      } else {
        close.reset({ reason: 'OTHER', comment: '' });
      }
      await onCanonicalWork(work);
      if (command.action === 'SWITCH_CONTENT_VERSION') {
        setFocusContentVersionOnClose(true);
      }
      setOpenAction(undefined);
    } catch (error) {
      const mapped = mapPublicationError(error);
      setServerError(mapped);
      if (mapped.status === 409) setContextStale(true);
    }
  }

  const actions: StickyAction[] = publicationWorkspaceActions(context).map((item) => {
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

  const errors: ErrorSummaryItem[] = [
    ...(openAction === 'VERIFY' && verification.formState.errors.match
      ? [{ id: 'verification-match-error', fieldId: 'verification-match', message: verification.formState.errors.match.message ?? '请选择核验结论' }]
      : []),
    ...(openAction === 'VERIFY' && verification.formState.errors.comment
      ? [{ id: 'verification-comment-error', fieldId: 'verification-comment', message: verification.formState.errors.comment.message ?? '请检查核验说明' }]
      : []),
    ...(openAction === 'SWITCH_CONTENT_VERSION' && switchContentVersion.formState.errors.comment
      ? [{ id: 'switch-comment-error', fieldId: 'switch-comment', message: switchContentVersion.formState.errors.comment.message ?? '请检查换版说明' }]
      : []),
    ...(serverError ? [
    { id: 'server', message: serverError.message },
    ...(serverError.requestId
      ? [{ id: 'request-id', message: `请求 ID：${serverError.requestId}` }]
      : []),
    ] : []),
  ];

  async function reloadContext() {
    try {
      const latest = await onReload();
      setContextStale(false);
      setServerError(undefined);
      if (
        openAction
        && (
          !latest.work.available_actions.includes(openAction)
          || (openAction === 'SWITCH_CONTENT_VERSION' && !latest.switch_candidate)
        )
      ) {
        setOpenAction(undefined);
      }
    } catch (error) {
      setServerError(mapPublicationError(error));
    }
  }

  if (actions.length === 0) return null;

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
            if (focusContentVersionOnClose) {
              document.getElementById('content-version')?.focus();
              setFocusContentVersionOnClose(false);
            } else {
              document.querySelector<HTMLElement>(
                `[data-action-key="${lastActionRef.current}"]`,
              )?.focus();
            }
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
          {openAction === 'VERIFY' && (
            <form className="space-y-4" onSubmit={verification.handleSubmit((values) => run({ action: 'VERIFY', values }))}>
              <dl className="grid gap-2 rounded-lg border border-border-subtle bg-surface-muted p-3 text-sm sm:grid-cols-2">
                <ContextSummary label="实际标题" value={context.work.actual_title ?? '未登记'} />
                <ContextSummary label="最终 URL" value={context.work.final_url ?? '未登记'} />
                <ContextSummary label="发布时间" value={context.work.published_at ?? '未登记'} />
                <ContextSummary label="批准内容" value={`v${context.content.version} · ${context.content.content_hash}`} mono />
              </dl>
              <fieldset className="space-y-2">
                <legend className="font-medium">发布页正文是否与当前批准内容一致？</legend>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm">
                  <input disabled={mutation.isPending || contextStale} id="verification-match" type="radio" value="MATCH" {...verification.register('match')} />
                  一致，通过本次核验
                </label>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm">
                  <input disabled={mutation.isPending || contextStale} type="radio" value="MISMATCH" {...verification.register('match')} />
                  不一致，记录失败并进入内容修正
                </label>
                {verification.formState.errors.match && <span className="text-xs text-destructive">{verification.formState.errors.match.message}</span>}
              </fieldset>
              <CommentField disabled={mutation.isPending || contextStale} form={verification} id="verification-comment" label="核验说明" name="comment" />
              <FormFooter pending={mutation.isPending} />
            </form>
          )}
          {openAction === 'SWITCH_CONTENT_VERSION' && context.switch_candidate && (
            <form className="space-y-4" onSubmit={switchContentVersion.handleSubmit((values) => run({ action: 'SWITCH_CONTENT_VERSION', values, contentVersionId: context.switch_candidate!.id }))}>
              <dl className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                <ContextSummary label="候选版本" value={`v${context.switch_candidate.version}`} />
                <ContextSummary label="标题" value={context.switch_candidate.title} />
                <ContextSummary label="摘要" value={context.switch_candidate.summary} />
                <ContextSummary label="内容哈希" value={context.switch_candidate.content_hash} mono />
              </dl>
              <CommentField disabled={mutation.isPending || contextStale} form={switchContentVersion} id="switch-comment" label="换版说明" name="comment" />
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

function CommentField<T extends FieldValues>({ disabled, form, id, label = '备注', name }: {
  disabled: boolean;
  form: UseFormReturn<T>;
  id?: string;
  label?: string;
  name: FieldPath<T>;
}) {
  const error = form.getFieldState(name).error?.message;
  return (
    <label className="block space-y-1.5">
      <span className="font-medium">{label}</span>
      <textarea
        aria-invalid={Boolean(error)}
        className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
        disabled={disabled}
        id={id}
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

function ContextSummary({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs' : 'break-words'}>{value}</dd>
    </div>
  );
}

function actionTitle(action: PublicationWorkspaceAction) {
  return {
    UPDATE_PREPARATION: '更新准备信息',
    MARK_PLATFORM_REVIEW: '标记平台处理中',
    REGISTER_RESULT: '登记发布结果',
    VERIFY: '核验发布结果',
    SWITCH_CONTENT_VERSION: '切换内容版本',
    CLOSE: '关闭发布工作',
  }[action];
}

export { PublicationWorkspaceActions };
export type { PublicationWorkspaceActionsProps };
