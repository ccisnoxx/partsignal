import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { OpportunityNotice } from './opportunity-controls';
import { OpportunityRequestError } from './opportunities.api';
import { ScheduleFields } from './opportunity-schedule-fields';
import { ScheduleRuntime } from './opportunity-schedule-runtime';
import {
  actionLabels,
  refreshOpportunityReadModels,
  scheduleForm,
  scheduleKey,
  scheduleOptions,
  scheduleValues,
  sendSchedule,
  type Action,
  type ScheduleCommand,
  type Values,
} from './opportunity-schedule.api';

export function OpportunitySchedule({
  csrfToken,
}: {
  csrfToken: string | null;
}) {
  const client = useQueryClient();
  const [owner] = useState(() => capturePrincipalContinuation(client));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState<number>();
  const [intent, setIntent] = useState<ScheduleCommand>();
  const [unknown, setUnknown] = useState(false);
  const [held, setHeld] = useState(false);
  const [checked, setChecked] = useState<number>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [acceptedRevision, setAcceptedRevision] = useState<number>();
  const [diagnostic, setDiagnostic] = useState<string>();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const observedReceipt = useRef<string | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const current = () => mounted.current && owner.isCurrent();
  const form = useForm<Values>({
    defaultValues: scheduleValues(null),
    resolver: zodResolver(scheduleForm),
    mode: 'onChange',
  });
  const mutation = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async (command: ScheduleCommand) => {
      owner.assertCurrent();
      if (!csrfToken || !controller.current)
        throw new Error('周期配置缺少会话或取消边界');
      return sendSchedule(command, csrfToken, controller.current.signal);
    },
  });
  const query = useQuery(scheduleOptions(open && !mutation.isPending));
  const data = query.data;
  const receiptId = data?.latest_window?.receipt?.evaluation_run_id;
  useEffect(() => {
    if (
      !open ||
      query.error ||
      !owner.isCurrent() ||
      !receiptId ||
      observedReceipt.current === receiptId
    )
      return;
    observedReceipt.current = receiptId;
    void refreshOpportunityReadModels(client, owner).catch(
      (failure: unknown) => {
        if (mounted.current && owner.isCurrent()) setError(failure);
      },
    );
  }, [client, owner, open, query.error, receiptId]);
  const denied = [query.error, error].some(
    (value) =>
      value instanceof OpportunityRequestError &&
      [401, 403].includes(value.status ?? 0),
  );
  const busy = mutation.isPending || reading || form.formState.isSubmitting;
  const stale = Boolean(
    data &&
    ((editing && revision !== data.revision) ||
      (intent && intent.revision !== data.revision)),
  );
  const blocked =
    busy ||
    Boolean(query.error) ||
    query.isFetching ||
    unknown ||
    held ||
    stale;

  async function execute(command: ScheduleCommand) {
    if (
      inFlight.current ||
      blocked ||
      !current() ||
      !csrfToken ||
      !data ||
      !data.available_actions.includes(command.action) ||
      command.revision !== data.revision
    )
      return;
    inFlight.current = true;
    controller.current = new AbortController();
    setError(undefined);
    setMessage('');
    setAcceptedRevision(undefined);
    setDiagnostic(command.requestId);
    let accepted = false;
    try {
      await client.cancelQueries({ queryKey: scheduleKey });
      if (!current()) return;
      const result = await mutation.mutateAsync(command);
      if (!current()) return;
      accepted = true;
      setAcceptedRevision(result.revision);
      setEditing(false);
      setIntent(undefined);
      form.reset(scheduleValues(result.configuration));
      setMessage(
        '已接受周期配置操作，当前状态以上方记录为准；后台只评估已保存观测，不创建行动或复测。',
      );
      await client.cancelQueries({ queryKey: scheduleKey });
      if (!current()) return;
      client.setQueryData(scheduleKey, result);
      setHeld(false);
      setUnknown(false);
    } catch (failure) {
      if (!current()) return;
      setError(failure);
      if (accepted) {
        setHeld(true);
        return;
      }
      const known =
        failure instanceof OpportunityRequestError &&
        failure.detail &&
        failure.status &&
        failure.status >= 400 &&
        failure.status < 500;
      setUnknown(!known);
      setHeld(Boolean(known && failure.status === 409));
      setChecked(undefined);
    } finally {
      inFlight.current = false;
      controller.current = null;
      if (current()) mutation.reset();
    }
  }
  async function refresh() {
    if (inFlight.current || busy || denied || !current()) return;
    inFlight.current = true;
    setReading(true);
    try {
      await client.cancelQueries({ queryKey: scheduleKey });
      if (!current()) return;
      const fresh = await client.fetchQuery({
        ...scheduleOptions(true),
        staleTime: 0,
      });
      if (!current()) return;
      if (unknown) {
        setChecked(fresh.revision);
        setMessage(
          '已重读当前配置；这不证明原请求结果，没有重发。请核对后结束核对。',
        );
      } else {
        setRevision(fresh.revision);
        setIntent((value) =>
          value ? { ...value, revision: fresh.revision } : undefined,
        );
        setHeld(false);
        setMessage(
          '已显式读取最新配置，原输入保留；保存会以新版本为基线，请重新确认。',
        );
      }
      setError(undefined);
      await refreshOpportunityReadModels(client, owner);
    } catch (failure) {
      if (current()) setError(failure);
    } finally {
      inFlight.current = false;
      if (current()) setReading(false);
    }
  }
  const errors = Object.entries(form.formState.errors).flatMap(
    ([name, value]) =>
      value?.message
        ? [
            {
              id: name,
              fieldId: `schedule-${name}`,
              message: String(value.message),
            },
          ]
        : [],
  );
  function startEdit() {
    if (!data || blocked || !current()) return;
    form.reset(scheduleValues(data.configuration));
    setRevision(data.revision);
    setEditing(true);
    setIntent(undefined);
    setError(undefined);
    setMessage('');
  }
  if (!owner.isCurrent())
    return <p role="alert">认证主体已变化，请重新进入机会工作台。</p>;
  if (denied)
    return <p role="alert">当前账号不能访问自动评估配置，请确认管理员权限。</p>;
  return (
    <section aria-label="机会自动周期评估" className="min-w-0 space-y-3">
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        自动周期评估
      </Button>
      <DirtyGuard
        when={open && (form.formState.isDirty || busy || unknown)}
        shouldBlockNavigation={({ current, next }) =>
          current.pathname !== next.pathname
        }
      />
      {open && (
        <div className="min-w-0 space-y-4 rounded-lg border border-border-default p-4">
          <h2 className="type-section-title">机会自动周期评估</h2>
          <p className="text-sm">
            本系统维护一份管理员配置。周期使用UTC间隔；到期窗口为结束时刻之前的回看天数，含开始、不含结束。停机只补评估最近一个到期窗口，较早窗口记为错过，不集中追赶。
          </p>
          {query.isFetching && <p role="status">正在读取自动评估配置…</p>}
          {query.error && (
            <OpportunityNotice error>
              {query.error instanceof Error
                ? query.error.message
                : '周期配置读取失败'}
              ；操作暂停，请显式刷新。
            </OpportunityNotice>
          )}
          {data && <ScheduleRuntime detail={data} />}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {acceptedRevision !== undefined && (
            <p className="text-sm">
              最近已确认操作的配置修订号：{acceptedRevision}。
            </p>
          )}
          {Boolean(error) && (
            <OpportunityNotice error>
              {error instanceof Error ? error.message : '周期配置失败'}
              {acceptedRevision !== undefined && (
                <p>操作已经接受，后续读取失败；不会重发。</p>
              )}
            </OpportunityNotice>
          )}
          {!unknown && (held || stale) && (
            <OpportunityNotice>
              <p>版本或读取上下文已变化，输入保留；必须显式刷新后重新确认。</p>
            </OpportunityNotice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              刷新运行记录与配置
            </Button>
            {data?.available_actions.map((action: Action) => (
              <Button
                key={action}
                type="button"
                variant="outline"
                disabled={blocked || editing || !csrfToken}
                onClick={() => {
                  if (action === 'CONFIGURE') startEdit();
                  else {
                    setIntent({
                      action,
                      revision: data.revision,
                      requestId: crypto.randomUUID(),
                    });
                    setRevision(data.revision);
                  }
                }}
              >
                {actionLabels[action]}
              </Button>
            ))}
          </div>
          {editing && data && (
            <FormProvider {...form}>
              <form
                aria-label="周期评估配置表单"
                className="min-w-0 space-y-4"
                onSubmit={(event) =>
                  void form.handleSubmit((values) =>
                    execute({
                      action: 'CONFIGURE',
                      revision: revision!,
                      requestId: crypto.randomUUID(),
                      configuration: values,
                    }),
                  )(event)
                }
              >
                <p className="text-sm">
                  编辑基线 revision {revision}
                  。保存会重新绑定当前管理员的执行授权；首次保存仍为未启用。
                </p>
                <ScheduleFields disabled={blocked} />
                <ErrorSummary errors={errors} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={blocked || !form.formState.isValid || !csrfToken}
                  >
                    保存周期配置
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || unknown}
                    onClick={() => {
                      setEditing(false);
                      form.reset(scheduleValues(data.configuration));
                    }}
                  >
                    放弃未保存配置
                  </Button>
                </div>
              </form>
            </FormProvider>
          )}
          {intent && data && !editing && (
            <section aria-label="周期状态操作确认" className="space-y-2">
              <p>
                确认{actionLabels[intent.action]}？使用已保存配置 revision{' '}
                {intent.revision}；启用、恢复从未来周期开始并重新授权。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    blocked ||
                    !data.available_actions.includes(intent.action) ||
                    !csrfToken
                  }
                  onClick={() => void execute(intent)}
                >
                  确认周期状态操作
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || unknown}
                  onClick={() => setIntent(undefined)}
                >
                  取消周期状态操作
                </Button>
              </div>
            </section>
          )}
          {unknown && (
            <OpportunityNotice>
              <p className="break-all">
                提交结果未知，请重读当前配置核对；原请求不会重发。诊断请求 ID：
                {diagnostic}
              </p>
              {checked !== undefined && data?.revision === checked && (
                <Button
                  type="button"
                  disabled={busy}
                  variant="outline"
                  onClick={() => {
                    setUnknown(false);
                    setHeld(false);
                    setRevision(checked);
                    setIntent(undefined);
                    setChecked(undefined);
                    setError(undefined);
                    setMessage(
                      '已结束核对。原输入保留，后续操作是新的显式请求。',
                    );
                  }}
                >
                  结束核对并保留输入
                </Button>
              )}
            </OpportunityNotice>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={busy || unknown}
            onClick={() => {
              setOpen(false);
              setEditing(false);
              setIntent(undefined);
              form.reset(scheduleValues(data?.configuration));
              setHeld(false);
              queueMicrotask(() => trigger.current?.focus());
            }}
          >
            {form.formState.isDirty
              ? '放弃草稿并关闭周期评估面板'
              : '关闭周期评估面板'}
          </Button>
        </div>
      )}
    </section>
  );
}
