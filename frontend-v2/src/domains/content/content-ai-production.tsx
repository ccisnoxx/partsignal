import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { Badge } from '@/design-system/primitives/badge';
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import type { components } from '@/shared/api/generated/schema';
import {
  ContentRequestError,
  contentKeys,
  createGenerationJob,
  createHumanizationJob,
  generationJobDetailQueryOptions,
  generationJobsQueryOptions,
  generationOptionsQueryOptions,
  retryGenerationJob,
} from './content.api';
import type { ContentEditorContext } from './content-editor.model';

type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobStatus = components['schemas']['GenerationJobStatus'];
type ProductionMode = 'generate' | 'humanize';

type ContentAiProductionProps = {
  context: ContentEditorContext;
  csrfToken: string | null;
  taskId: string;
};

function ContentAiProduction({ context, csrfToken, taskId }: ContentAiProductionProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ProductionMode | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [submittedJob, setSubmittedJob] = useState<GenerationJob>();
  const [detailJobId, setDetailJobId] = useState<string>();
  const [retryOpen, setRetryOpen] = useState(false);
  const [error, setError] = useState<string>();
  const commandKeys = useRef(new Map<string, string>());
  const activeJobsSeen = useRef(new Set<string>());
  const terminalRefetched = useRef(new Set<string>());

  const trackedJobId = submittedJob?.id ?? context.latest_generation?.id ?? null;
  const options = useQuery({
    ...generationOptionsQueryOptions(taskId),
    enabled: mode !== null,
  });
  const jobs = useQuery(generationJobsQueryOptions(taskId, trackedJobId));
  const jobDetail = useQuery({
    ...generationJobDetailQueryOptions(detailJobId ?? 'disabled'),
    enabled: detailJobId !== undefined,
  });
  const summaryJob = jobs.data?.items.find((job) => job.id === trackedJobId);
  const trackedJob = summaryJob ?? submittedJob;
  const trackedStatus = trackedJob?.status ?? context.latest_generation?.status;
  const trackedErrorCode = trackedJob?.error_code ?? context.latest_generation?.error_code;
  const trackedErrorSummary = trackedJob?.error_summary ?? context.latest_generation?.error_summary;
  const canGenerate = context.task.available_actions.includes('CREATE_GENERATION_JOB');
  const canHumanize = Boolean(
    context.current_content?.available_actions.includes('CREATE_HUMANIZATION_JOB'),
  );
  const pending = trackedStatus === 'PENDING' || trackedStatus === 'RUNNING';

  const create = useMutation({
    mutationFn: async ({ modelId, signature }: { modelId: string; signature: string }) => {
      const prompt = options.data?.platform_prompt;
      if (!prompt) throw new Error('当前没有可确认的平台 Prompt');
      return createGenerationJob(
        taskId,
        {
          ai_model_id: modelId,
          platform_prompt_id: prompt.id,
          platform_prompt_revision: prompt.revision,
        },
        csrfToken,
        commandKey(commandKeys.current, signature),
      );
    },
  });
  const humanize = useMutation({
    mutationFn: async ({ modelId, signature }: { modelId: string; signature: string }) => {
      const source = context.current_content;
      if (!source) throw new Error('当前没有可自然化的内容版本');
      return createHumanizationJob(
        source.id,
        { ai_model_id: modelId },
        csrfToken,
        commandKey(commandKeys.current, signature),
      );
    },
  });
  const retry = useMutation({
    mutationFn: async ({ jobId, signature }: { jobId: string; signature: string }) => (
      retryGenerationJob(
        jobId,
        csrfToken,
        commandKey(commandKeys.current, signature),
      )
    ),
  });

  useEffect(() => {
    if (!trackedJobId || !trackedStatus) return;
    if (isActiveStatus(trackedStatus)) {
      activeJobsSeen.current.add(trackedJobId);
      return;
    }
    // 创建响应可能已是 terminal；本组件提交的 job 仍需刷新服务端主线。
    if (!activeJobsSeen.current.has(trackedJobId) && submittedJob?.id !== trackedJobId) return;
    if (terminalRefetched.current.has(trackedJobId)) return;
    terminalRefetched.current.add(trackedJobId);
    void Promise.all([
      queryClient.invalidateQueries({ exact: true, queryKey: contentKeys.editorContext(taskId) }),
      queryClient.invalidateQueries({ queryKey: contentKeys.details(), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: contentKeys.lists(), refetchType: 'none' }),
    ]);
  }, [queryClient, submittedJob?.id, taskId, trackedJobId, trackedStatus]);

  function openProduction(nextMode: ProductionMode) {
    setError(undefined);
    setSelectedModelId(undefined);
    setMode(nextMode);
  }

  function closeProduction() {
    if (create.isPending || humanize.isPending) return;
    setMode(null);
    setSelectedModelId(undefined);
    setError(undefined);
  }

  async function submitProduction() {
    if (!mode || !selectedModelId || !options.data) return;
    setError(undefined);
    const prompt = options.data.platform_prompt;
    const sourceId = context.current_content?.id ?? '';
    const signature = mode === 'generate'
      ? ['GENERATE', taskId, selectedModelId, prompt.id, prompt.revision].join(':')
      : ['HUMANIZE', sourceId, selectedModelId].join(':');
    try {
      const job = mode === 'generate'
        ? await create.mutateAsync({ modelId: selectedModelId, signature })
        : await humanize.mutateAsync({ modelId: selectedModelId, signature });
      setSubmittedJob(job);
      setMode(null);
      setSelectedModelId(undefined);
      await queryClient.invalidateQueries({ queryKey: contentKeys.generationJobs(taskId) });
    } catch (caught) {
      if (isErrorCode(caught, 'IDEMPOTENCY_CONFLICT')) commandKeys.current.delete(signature);
      if (isErrorCode(caught, 'PLATFORM_PROMPT_CHANGED')) {
        setSelectedModelId(undefined);
        await options.refetch();
      }
      setError(errorMessage(caught));
    }
  }

  async function submitRetry() {
    if (!summaryJob?.available_actions.includes('RETRY')) return;
    setError(undefined);
    const signature = `RETRY:${summaryJob.id}`;
    try {
      const job = await retry.mutateAsync({ jobId: summaryJob.id, signature });
      setSubmittedJob(job);
      setRetryOpen(false);
      await queryClient.invalidateQueries({ queryKey: contentKeys.generationJobs(taskId) });
    } catch (caught) {
      if (isErrorCode(caught, 'IDEMPOTENCY_CONFLICT')) commandKeys.current.delete(signature);
      setError(errorMessage(caught));
    }
  }

  return (
    <section
      aria-labelledby="content-ai-production-title"
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-panel p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-section-title" id="content-ai-production-title">AI Production</h2>
            {trackedStatus ? <JobStatusBadge status={trackedStatus} /> : null}
          </div>
          <p className="text-sm text-text-secondary">
            Prompt、模型和不可变输入由服务端冻结；页面只跟踪当前作业。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canGenerate ? (
            <Button disabled={pending} onClick={() => openProduction('generate')} type="button">
              AI 生成首稿
            </Button>
          ) : null}
          {canHumanize ? (
            <Button disabled={pending} onClick={() => openProduction('humanize')} type="button" variant="outline">
              创建自然化版本
            </Button>
          ) : null}
        </div>
      </div>

      {trackedJobId && trackedStatus ? (
        <div
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm"
          role={trackedStatus === 'FAILED' ? 'alert' : 'status'}
        >
          <p className="font-medium">{jobStatusCopy(trackedStatus)}</p>
          <p className="break-all font-mono text-xs text-text-muted">Job {trackedJobId}</p>
          {trackedStatus === 'FAILED' ? (
            <p className="text-danger">
              {trackedErrorCode ? `${trackedErrorCode}：` : ''}{trackedErrorSummary ?? '生成作业失败'}
            </p>
          ) : null}
          {jobs.error ? <p className="text-danger">{errorMessage(jobs.error)}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDetailJobId(trackedJobId)} size="sm" type="button" variant="outline">
              查看完整作业快照
            </Button>
            {summaryJob?.available_actions.includes('RETRY') ? (
              <Button onClick={() => { setError(undefined); setRetryOpen(true); }} size="sm" type="button">
                按原快照重试
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted">当前没有需要跟踪的 AI 作业。</p>
      )}

      {error && mode === null && !retryOpen ? (
        <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {mode ? (
        <ProductionDialog
          error={error}
          loading={options.isPending}
          mode={mode}
          onClose={closeProduction}
          onRetryOptions={() => void options.refetch()}
          onSelectModel={setSelectedModelId}
          onSubmit={() => void submitProduction()}
          options={options.data}
          optionsError={options.error}
          selectedModelId={selectedModelId}
          submitting={create.isPending || humanize.isPending}
        />
      ) : null}

      {retryOpen && summaryJob ? (
        <Dialog onOpenChange={(open) => { if (!open && !retry.isPending) setRetryOpen(false); }} open>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>按原快照重试？</DialogTitle>
              <DialogDescription>
                服务端将精确重放 Job {summaryJob.id} 的冻结 snapshot，不读取当前 Prompt 或事实替换历史输入。
              </DialogDescription>
            </DialogHeader>
            {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
            <DialogFooter>
              <DialogClose render={<Button disabled={retry.isPending} variant="outline" />}>取消</DialogClose>
              <Button disabled={retry.isPending} onClick={() => void submitRetry()} type="button">
                {retry.isPending ? '创建重试作业中…' : '确认按原快照重试'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {detailJobId ? (
        <Dialog onOpenChange={(open) => { if (!open) setDetailJobId(undefined); }} open>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>完整生成作业快照</DialogTitle>
              <DialogDescription>该 snapshot 只读展示；retry 不由浏览器重新拼装。</DialogDescription>
            </DialogHeader>
            {jobDetail.isPending ? <Skeleton className="h-72" /> : null}
            {jobDetail.error ? <p className="text-sm text-danger" role="alert">{errorMessage(jobDetail.error)}</p> : null}
            {jobDetail.data ? (
              <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-raised p-3 text-xs">
                {JSON.stringify(jobDetail.data, null, 2)}
              </pre>
            ) : null}
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function ProductionDialog({
  error,
  loading,
  mode,
  onClose,
  onRetryOptions,
  onSelectModel,
  onSubmit,
  options,
  optionsError,
  selectedModelId,
  submitting,
}: {
  error?: string;
  loading: boolean;
  mode: ProductionMode;
  onClose: () => void;
  onRetryOptions: () => void;
  onSelectModel: (modelId: string | undefined) => void;
  onSubmit: () => void;
  options?: components['schemas']['GenerationOptions'];
  optionsError: Error | null;
  selectedModelId?: string;
  submitting: boolean;
}) {
  const models = options?.models.map((model) => ({
    label: `${model.display_name} · ${model.channel_name}`,
    value: model.id,
  })) ?? [];
  const humanizationUnavailable = mode === 'humanize' && !options?.humanization_prompt_configured;
  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === 'generate' ? '确认 Prompt 与模型' : '创建自然化作业'}</DialogTitle>
          <DialogDescription>
            {mode === 'generate'
              ? '确认服务端当前 Prompt，并明确选择一个已启用且测试通过的模型。'
              : '自然化会创建新 GenerationJob 和新 ContentVersion，源版本保持不变。'}
          </DialogDescription>
        </DialogHeader>

        {loading ? <Skeleton className="h-72" /> : null}
        {optionsError ? (
          <div className="flex flex-col gap-2 text-sm" role="alert">
            <p className="text-danger">{errorMessage(optionsError)}</p>
            <Button onClick={onRetryOptions} size="sm" type="button" variant="outline">重试加载选项</Button>
          </div>
        ) : null}
        {options ? (
          <div className="flex flex-col gap-4">
            {mode === 'generate' ? (
              <section className="flex flex-col gap-2" aria-labelledby="generation-prompt-title">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="type-section-title" id="generation-prompt-title">{options.platform_prompt.name}</h3>
                  <Badge variant="info">Revision {options.platform_prompt.revision}</Badge>
                </div>
                <p className="text-sm text-text-muted">平台：{options.platform_profile_name}</p>
                <MarkdownPreview
                  className="max-h-72 min-h-32 overflow-auto rounded-lg border border-border-subtle p-3"
                  value={options.platform_prompt.template_markdown}
                />
              </section>
            ) : (
              <p className="text-sm text-text-secondary">
                Humanization Prompt：{options.humanization_prompt_configured ? '已配置' : '未配置'}
              </p>
            )}

            <label className="flex flex-col gap-1.5 text-sm" htmlFor="ai-production-model">
              <span className="type-label">模型</span>
              <Select
                items={models}
                onValueChange={(value) => onSelectModel(value ?? undefined)}
                value={selectedModelId ?? null}
              >
                <SelectTrigger className="w-full max-w-full" id="ai-production-model">
                  <SelectValue placeholder="请选择模型" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {models.map((model) => (
                      <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            {models.length === 0 ? <p className="text-sm text-danger">当前没有可用模型。</p> : null}
            {humanizationUnavailable ? (
              <p className="text-sm text-danger" role="alert">Humanization Prompt 尚未配置，不能创建作业。</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

        <DialogFooter>
          <DialogClose render={<Button disabled={submitting} variant="outline" />}>取消</DialogClose>
          <Button
            disabled={!options || !selectedModelId || models.length === 0 || humanizationUnavailable || submitting}
            onClick={onSubmit}
            type="button"
          >
            {submitting
              ? '创建作业中…'
              : mode === 'generate'
                ? '确认 Prompt 与模型并开始生成'
                : '确认创建自然化版本'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function commandKey(keys: Map<string, string>, signature: string) {
  const existing = keys.get(signature);
  if (existing) return existing;
  const key = crypto.randomUUID();
  keys.set(signature, key);
  return key;
}

function isActiveStatus(status: GenerationJobStatus) {
  return status === 'PENDING' || status === 'RUNNING';
}

function JobStatusBadge({ status }: { status: GenerationJobStatus }) {
  const variant = status === 'SUCCEEDED'
    ? 'success'
    : status === 'FAILED'
      ? 'destructive'
      : 'info';
  return <Badge variant={variant}>{status}</Badge>;
}

function jobStatusCopy(status: GenerationJobStatus) {
  return {
    PENDING: '生成作业已排队，等待 Worker 执行。',
    RUNNING: '生成作业正在执行。',
    SUCCEEDED: '生成作业成功；当前内容以服务端 Editor Context 为准。',
    FAILED: '生成作业失败。',
  }[status];
}

function isErrorCode(error: unknown, code: string) {
  return error instanceof ContentRequestError && error.detail?.code === code;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'AI Production 请求失败';
}

export { ContentAiProduction };
