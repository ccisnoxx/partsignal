import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { shouldBlockManualNavigation } from './manual.model';
import {
  basis,
  analysisStatusLabels,
  failureKind,
  invalidateReanalysis,
  invalidateReanalysisResults,
  reasonForm,
  reasonLabels,
  requestReanalysis,
  type Accepted,
  type Detail,
  type ReanalysisRequest,
  type Submitted,
  type Values,
} from './reanalysis.api';
import { ReanalysisReceipt } from './reanalysis-receipt';
import { runDetailOptions, runKeys, RunRequestError } from './runs.api';

export function RunReanalysis({
  detail,
  csrfToken,
  blocked,
  readError,
}: {
  detail: Detail;
  csrfToken: string | null;
  blocked: boolean;
  readError?: unknown;
}) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<{
    revision: number;
    basis: string;
  }>();
  const [unknown, setUnknown] = useState(false);
  const [held, setHeld] = useState(false);
  const [reading, setReading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState<Accepted>();
  const entry = useRef<HTMLButtonElement>(null);
  const [request, setRequest] = useState<ReanalysisRequest>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const current = () => mounted.current && owner.isCurrent();
  const form = useForm<Values, unknown, Submitted>({
    defaultValues: { reason: '' },
    resolver: zodResolver(reasonForm),
    mode: 'onChange',
  });
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: async (command: ReanalysisRequest) => {
      owner.assertCurrent();
      if (!csrfToken || !controller.current)
        throw new Error('重新分析缺少会话或取消边界');
      return requestReanalysis(command, csrfToken, controller.current.signal);
    },
  });
  const offered = detail.analysis.available_actions.includes('REANALYZE');
  const busy = mutation.isPending || reading || form.formState.isSubmitting;
  const stale = Boolean(baseline && baseline.basis !== basis(detail));
  const denied =
    (readError instanceof RunRequestError &&
      [401, 403, 404].includes(readError.status ?? 0)) ||
    Boolean(error && failureKind(error) === 'denied');
  const target = detail.analysis.revisions.find(
    (row) => row.analysis.id === accepted?.analysis_revision_id,
  )?.analysis;

  const terminalReceipt = useRef<string | undefined>(undefined);
  const receiptId = accepted?.analysis_revision_id;
  const receiptKey = accepted
    ? `${accepted.analysis_revision_id}:${accepted.request_id}`
    : undefined;
  const targetId = target?.id;
  const targetStatus = target?.status;
  useEffect(() => {
    if (
      !receiptKey ||
      receiptId !== targetId ||
      !targetStatus ||
      targetStatus === 'PENDING' ||
      readError ||
      !owner.isCurrent() ||
      terminalReceipt.current === receiptKey
    )
      return;
    terminalReceipt.current = receiptKey;
    // Worker可能早于第一次详情读取完成；首次看到目标终态即刷新，不要求先看到PENDING。
    void invalidateReanalysisResults(client, owner).catch(
      (failure: unknown) => {
        if (mounted.current && owner.isCurrent()) setError(failure);
      },
    );
  }, [client, owner, readError, receiptId, receiptKey, targetId, targetStatus]);

  async function submit(values: Submitted) {
    if (
      inFlight.current ||
      busy ||
      !current() ||
      denied ||
      !csrfToken ||
      !baseline ||
      !offered ||
      blocked ||
      held ||
      stale ||
      unknown
    )
      return;
    const command: ReanalysisRequest = {
      runId: detail.run.id,
      requestId: crypto.randomUUID(),
      body: { expected_revision: baseline.revision, reason: values.reason },
    };
    setRequest(command);
    inFlight.current = true;
    controller.current = new AbortController();
    setError(undefined);
    setMessage('');
    let committed = false;
    try {
      const receipt = await mutation.mutateAsync(command);
      if (!current()) return;
      committed = true;
      setAccepted(receipt);
      setOpen(false);
      setUnknown(false);
      setHeld(false);
      form.reset(form.getValues());
      setMessage(
        '已接受重新分析请求。相同输入可能复用既有版本；计算结果以目标版本与当前指针为准。',
      );
      await invalidateReanalysis(client, owner);
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (committed) return;
      const kind = failureKind(failure);
      setUnknown(kind === 'unknown');
      setHeld(kind === 'conflict');
      setChecked(false);
      if (failure instanceof RunRequestError && failure.status === 422) {
        const errors = failure.detail?.details.errors;
        if (Array.isArray(errors))
          for (const item of errors) {
            if (
              item &&
              typeof item === 'object' &&
              'loc' in item &&
              'msg' in item &&
              Array.isArray(item.loc) &&
              item.loc[0] === 'body' &&
              item.loc.at(-1) === 'reason' &&
              typeof item.msg === 'string'
            )
              form.setError('reason', { message: item.msg });
          }
      }
    } finally {
      inFlight.current = false;
      controller.current = null;
      if (current()) mutation.reset();
    }
  }
  async function refresh() {
    if (inFlight.current || busy || !current() || denied) return;
    setReading(true);
    setMessage('');
    try {
      await client.cancelQueries({ queryKey: runKeys.detail(detail.run.id) });
      if (!current()) return;
      const fresh = await client.fetchQuery({
        ...runDetailOptions(detail.run.id),
        staleTime: 0,
      });
      if (!current()) return;
      if (unknown) {
        setChecked(true);
        setMessage(
          '已重读现有分析历史。新增或复用版本都不能单凭本次读取证明原请求已接受，请人工核对；没有重新发送命令。',
        );
      } else {
        setBaseline({ revision: fresh.run.revision, basis: basis(fresh) });
        setHeld(false);
        form.clearErrors();
        setMessage('已读取最新运行与分析历史，原原因保留，请核对后重新确认。');
      }
      setError(undefined);
    } catch (failure) {
      if (current()) setError(failure);
    } finally {
      if (current()) setReading(false);
    }
  }
  if (!owner.isCurrent())
    return <p role="alert">认证主体已变化，请重新进入运行详情。</p>;
  if (denied)
    return <p role="alert">当前运行不可访问，请关闭详情并确认登录与权限。</p>;
  if (!offered && !open && !accepted) return null;
  const fieldError = form.formState.errors.reason?.message;
  return (
    <section
      aria-label="管理员重新分析"
      className="min-w-0 space-y-3 border-t border-border-subtle pt-4"
    >
      <h4 className="font-medium">管理员重新分析</h4>
      <DirtyGuard
        when={open && (form.formState.isDirty || busy || unknown)}
        description={
          unknown
            ? '重新分析结果未知，离开会丢失本次诊断信息，请先重读分析历史核对。'
            : undefined
        }
        shouldBlockNavigation={({ current, next }) =>
          shouldBlockManualNavigation(current, next)
        }
      />
      {!open && offered && (
        <Button
          ref={entry}
          type="button"
          variant="outline"
          disabled={blocked || busy || !csrfToken}
          onClick={() => {
            setBaseline({
              revision: detail.run.revision,
              basis: basis(detail),
            });
            setAccepted(undefined);
            form.reset({ reason: '' });
            setRequest(undefined);
            setError(undefined);
            setMessage('');
            setOpen(true);
          }}
        >
          显式重新分析
        </Button>
      )}
      <p className="text-sm text-text-secondary">
        读取当前规则、对象词典与批准事实；保留原回答和历史版本。接受请求不代表计算完成，也不会把失败采集改为成功。
      </p>
      {message && (
        <p role="status" className="break-words text-sm">
          {message}
        </p>
      )}
      {Boolean(error) && (
        <div role="alert" className="space-y-2 text-sm text-danger">
          {accepted && (
            <p>请求已接受，关联读取失败；保留目标分析ID，不会重发。</p>
          )}
          <p>{error instanceof Error ? error.message : '重新分析或读取失败'}</p>
        </div>
      )}
      {accepted && (
        <ReanalysisReceipt
          accepted={accepted}
          target={target}
          currentId={detail.analysis.selection.current_analysis_revision_id}
          disabled={busy || blocked}
          onRead={() => void refresh()}
        />
      )}
      {open && baseline && (
        <FormProvider {...form}>
          <form
            aria-label="管理员重新分析表单"
            className="space-y-3"
            onSubmit={(event) => void form.handleSubmit(submit)(event)}
          >
            <p className="text-sm">
              提交基线：Run revision {baseline.revision}
              。原因只用于记录本次显式操作，不提交自选事实清单。
            </p>
            {!offered && (
              <p role="status">
                服务端当前未提供重新分析动作，原原因保留，提交暂停。
              </p>
            )}
            {(held || stale) && !unknown && (
              <div role="status" className="space-y-2 text-sm">
                <p>运行或分析历史已变化，原原因保留，请显式读取后重新确认。</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  加载最新运行与分析历史
                </Button>
              </div>
            )}
            <fieldset
              className="min-w-0"
              disabled={busy || blocked || unknown || held || stale}
            >
              <FormField<Values, 'reason'>
                name="reason"
                id="run-reanalysis-reason"
                label="重新分析原因"
                required
                render={({ field, inputId, ...aria }) => (
                  <Select
                    value={field.value}
                    items={Object.entries(reasonLabels).map(
                      ([value, label]) => ({ value, label }),
                    )}
                    onValueChange={(value) => {
                      if (value !== null) field.onChange(value);
                    }}
                  >
                    <SelectTrigger
                      className="w-full min-w-0"
                      id={inputId}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-describedby={aria['aria-describedby']}
                      aria-invalid={aria['aria-invalid']}
                      aria-required
                    >
                      <SelectValue placeholder="请选择原因" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(reasonLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </fieldset>
            <ErrorSummary
              errors={
                fieldError
                  ? [
                      {
                        id: 'reason',
                        fieldId: 'run-reanalysis-reason',
                        message: fieldError,
                      },
                    ]
                  : []
              }
            />
            {unknown ? (
              <div className="space-y-2 text-sm">
                <p className="break-all">
                  接受结果未知。请求 ID：{request?.requestId} · 原因：
                  {request ? reasonLabels[request.body.reason] : '未记录'}
                  。不会重发原请求。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || blocked}
                  onClick={() => void refresh()}
                >
                  读取现有分析版本核对
                </Button>
                {checked && (
                  <>
                    <ul className="space-y-1 break-all">
                      {detail.analysis.revisions.map(({ analysis }) => (
                        <li key={analysis.id}>
                          {analysis.id} ·{' '}
                          {analysisStatusLabels[analysis.status]} · revision{' '}
                          {analysis.revision}
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setUnknown(false);
                        setOpen(false);
                        setError(undefined);
                        setMessage('');
                        setChecked(false);
                        setRequest(undefined);
                        form.reset({ reason: '' });
                        queueMicrotask(() => entry.current?.focus());
                      }}
                    >
                      关闭核对（不取消后台分析）
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    blocked ||
                    busy ||
                    held ||
                    stale ||
                    !offered ||
                    !csrfToken ||
                    !form.formState.isValid
                  }
                >
                  确认重新分析
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setHeld(false);
                    setRequest(undefined);
                    form.reset({ reason: '' });
                    queueMicrotask(() => entry.current?.focus());
                  }}
                >
                  取消发起
                </Button>
                {Boolean(error) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    重新读取运行
                  </Button>
                )}
              </div>
            )}
          </form>
        </FormProvider>
      )}
    </section>
  );
}
