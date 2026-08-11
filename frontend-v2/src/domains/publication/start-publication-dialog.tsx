import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import {
  createPublicationWork,
  mapPublicationStartError,
  type PublicationStartErrorMapping,
} from './publication.api';
import type { PublicationReadyItem, PublicationWork } from './publication-work.model';

type StartPublicationDialogProps = {
  csrfToken: string | null;
  item: PublicationReadyItem;
  onConflict: (taskId: string) => Promise<void>;
  onCreated: (work: PublicationWork) => Promise<void>;
};

function StartPublicationDialog({
  csrfToken,
  item,
  onConflict,
  onCreated,
}: StartPublicationDialogProps) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<PublicationStartErrorMapping>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const idempotency = useRef<{ signature: string; key: string } | undefined>(undefined);
  const submitting = useRef(false);
  const create = useMutation({
    mutationFn: ({ key }: { key: string }) => createPublicationWork(
      { content_version_id: item.content_version.id, platform_account_id: accountId },
      csrfToken,
      key,
    ),
  });

  if (!item.available_actions.includes('START')) return null;

  const accountItems = item.matching_accounts.map((account) => ({
    value: account.id,
    label: `${account.label} · ${account.account_identifier}`,
  }));
  const accountFieldId = `publication-account-${item.content_version.id}`;
  const accountErrorId = `${accountFieldId}-error`;
  const errors: ErrorSummaryItem[] = [];
  if (fieldError) {
    errors.push({ id: 'account', fieldId: accountFieldId, message: fieldError });
  }
  if (accountItems.length === 0) {
    errors.push({
      id: 'account-contract',
      message: '服务端允许开始发布，但没有返回可选账号。请刷新后重试。',
    });
  }
  if (serverError) {
    errors.push({ id: 'server', message: serverError.message });
    if (serverError.requestId) {
      errors.push({ id: 'request-id', message: `请求 ID：${serverError.requestId}` });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || create.isPending) return;
    setFieldError(undefined);
    setServerError(undefined);
    create.reset();
    if (!accountId) {
      setFieldError('请选择用于发布的平台账号。');
      return;
    }

    const signature = JSON.stringify({
      content_version_id: item.content_version.id,
      platform_account_id: accountId,
    });
    const key = idempotency.current?.signature === signature
      ? idempotency.current.key
      : crypto.randomUUID();
    idempotency.current = { signature, key };
    submitting.current = true;
    try {
      const work = await create.mutateAsync({ key });
      idempotency.current = undefined;
      await onCreated(work);
      setOpen(false);
    } catch (error) {
      const mapped = mapPublicationStartError(error);
      setServerError(mapped);
      if (mapped.code === 'IDEMPOTENCY_CONFLICT') idempotency.current = undefined;
      if (mapped.status === 409) await onConflict(item.task_id);
    } finally {
      submitting.current = false;
    }
  }

  function resetDialog() {
    setAccountId('');
    setFieldError(undefined);
    setServerError(undefined);
    idempotency.current = undefined;
    create.reset();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} ref={triggerRef} type="button">开始发布</Button>
      <Dialog
        onOpenChange={(next) => !create.isPending && setOpen(next)}
        onOpenChangeComplete={(next) => !next && resetDialog()}
        open={open}
      >
        <DialogContent finalFocus={() => triggerRef.current} showCloseButton={!create.isPending}>
          <DialogHeader>
            <DialogTitle>开始发布“{item.content_version.title}”</DialogTitle>
            <DialogDescription>
              明确选择一个匹配账号。服务端将在创建时重新核验批准内容、当前版本、账号和重复工作。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <ErrorSummary errors={errors} title="开始发布未完成" />
            <label className="block space-y-1.5" htmlFor={accountFieldId}>
              <span className="font-medium">发布账号</span>
              <Select
                disabled={create.isPending}
                items={accountItems}
                onValueChange={(value) => {
                  setAccountId(value ?? '');
                  setFieldError(undefined);
                }}
                value={accountId || null}
              >
                <SelectTrigger
                  aria-describedby={fieldError ? accountErrorId : undefined}
                  aria-invalid={Boolean(fieldError)}
                  className="w-full max-w-full"
                  id={accountFieldId}
                >
                  <SelectValue placeholder="请选择发布账号" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {accountItems.map((account) => (
                    <SelectItem key={account.value} value={account.value}>{account.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError && <span className="sr-only" id={accountErrorId}>{fieldError}</span>}
            </label>
            <DialogFooter>
              <DialogClose disabled={create.isPending} render={<Button variant="outline" />}>
                取消
              </DialogClose>
              <Button disabled={create.isPending || accountItems.length === 0} type="submit">
                {create.isPending ? '正在创建…' : '确认开始'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { StartPublicationDialog };
