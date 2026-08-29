import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
  contentVersionQueryOptions,
  createGenerationJob,
  generationJobsQueryOptions,
} from '../content/content.api';
import {
  platformPromptPreviewOptionsQueryOptions,
  promptKeys,
} from './prompt.api';
import type { PlatformPromptDetail } from './prompt-workspace.model';

type ContentVersion = components['schemas']['ContentVersion'];
type GenerationJob = components['schemas']['GenerationJob'];
type GenerationJobList = components['schemas']['GenerationJobList'];
type PreviewContext = components['schemas']['PlatformPromptPreviewContext'];
type PromptSnapshot = components['schemas']['PlatformPromptSnapshot'];

type Selection = {
  contextId?: string;
  identity: string;
  modelId?: string;
};

type SubmittedPreview = {
  context: PreviewContext;
  job: GenerationJob;
  prompt: PromptSnapshot;
};

type CommandKey = { key: string; signature: string };

function PromptPreview({
  csrfToken,
  dirty,
  prompt,
}: {
  csrfToken: string | null;
  dirty: boolean;
  prompt?: PlatformPromptDetail;
}) {
  const queryClient = useQueryClient();
  const options = useQuery(platformPromptPreviewOptionsQueryOptions(
    prompt?.id ?? 'unselected',
    prompt !== undefined,
  ));
  const [selection, setSelection] = useState<Selection>({ identity: 'unselected' });
  const [confirmationIdentity, setConfirmationIdentity] = useState<string>();
  const [submitted, setSubmitted] = useState<SubmittedPreview>();
  const [error, setError] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  const commandKey = useRef<CommandKey | undefined>(undefined);
  const pending = useRef(false);
  const terminalRefetched = useRef(new Set<string>());

  const optionPrompt = options.data?.platform_prompt;
  const selectionIdentity = prompt
    ? `${prompt.id}:${optionPrompt?.revision ?? 'loading'}`
    : 'unselected';
  const selectedContextId = selection.identity === selectionIdentity
    ? selection.contextId
    : undefined;
  const selectedModelId = selection.identity === selectionIdentity
    ? selection.modelId
    : undefined;
  const selectedContext = options.data?.contexts.find(
    (context) => context.content_task_id === selectedContextId,
  );
  const selectedModel = options.data?.models.find((model) => model.id === selectedModelId);
  const gateReason = previewGateReason(prompt, dirty, optionPrompt);
  const canConfirm = !gateReason && selectedContext !== undefined && selectedModel !== undefined;

  const trackedJobId = submitted?.job.id ?? null;
  const trackedTaskId = submitted?.context.content_task_id ?? 'untracked';
  const jobs = useQuery(generationJobsQueryOptions(trackedTaskId, trackedJobId));
  const trackedJob = jobs.data?.items.find((job) => job.id === trackedJobId) ?? submitted?.job;
  const contentVersionId = trackedJob?.status === 'SUCCEEDED'
    ? trackedJob.content_version_id
    : null;
  const version = useQuery({
    ...contentVersionQueryOptions(contentVersionId ?? 'unavailable'),
    enabled: contentVersionId !== null,
  });

  const create = useMutation({
    mutationFn: ({
      context,
      modelId,
      prompt: commandPrompt,
      signature,
    }: {
      context: PreviewContext;
      modelId: string;
      prompt: PromptSnapshot;
      signature: string;
    }) => createGenerationJob(
      context.content_task_id,
      {
        ai_model_id: modelId,
        platform_prompt_id: commandPrompt.id,
        platform_prompt_revision: commandPrompt.revision,
      },
      csrfToken,
      stableCommandKey(commandKey, signature),
    ),
  });

  useEffect(() => {
    if (
      !trackedJob
      || (trackedJob.status !== 'SUCCEEDED' && trackedJob.status !== 'FAILED')
      || terminalRefetched.current.has(trackedJob.id)
    ) return;
    terminalRefetched.current.add(trackedJob.id);
    void invalidatePreviewConsumers(queryClient, trackedTaskId, false);
  }, [queryClient, trackedJob, trackedTaskId]);

  function changeContext(contextId: string | undefined) {
    commandKey.current = undefined;
    setSelection((current) => ({
      contextId,
      identity: selectionIdentity,
      modelId: current.identity === selectionIdentity ? current.modelId : undefined,
    }));
  }

  function changeModel(modelId: string | undefined) {
    commandKey.current = undefined;
    setSelection((current) => ({
      contextId: current.identity === selectionIdentity ? current.contextId : undefined,
      identity: selectionIdentity,
      modelId,
    }));
  }

  async function submit() {
    if (pending.current || !canConfirm || !selectedContext || !selectedModel || !optionPrompt) {
      return;
    }
    pending.current = true;
    setError(undefined);
    const signature = [
      'GENERATE',
      selectedContext.content_task_id,
      selectedModel.id,
      optionPrompt.id,
      optionPrompt.revision,
    ].join(':');
    try {
      const job = await create.mutateAsync({
        context: selectedContext,
        modelId: selectedModel.id,
        prompt: optionPrompt,
        signature,
      });
      const next = { context: selectedContext, job, prompt: optionPrompt };
      setSubmitted(next);
      setConfirmationIdentity(undefined);
      commandKey.current = undefined;
      queryClient.setQueryData<GenerationJobList>(
        contentKeys.generationJobs(selectedContext.content_task_id),
        (current) => ({
          items: [job, ...(current?.items.filter((item) => item.id !== job.id) ?? [])],
        }),
      );
      await invalidatePreviewConsumers(queryClient, selectedContext.content_task_id, true);
    } catch (caught) {
      if (isErrorCode(caught, 'IDEMPOTENCY_CONFLICT')) commandKey.current = undefined;
      if (isErrorCode(caught, 'PLATFORM_PROMPT_CHANGED')) {
        commandKey.current = undefined;
        setSelection({ identity: selectionIdentity });
        await options.refetch();
      }
      setError(errorMessage(caught));
    } finally {
      pending.current = false;
    }
  }

  const contextItems = options.data?.contexts.map((context) => ({
    label: contextLabel(context),
    value: context.content_task_id,
  })) ?? [];
  const modelItems = options.data?.models.map((model) => ({
    label: `${model.display_name} · ${model.channel_name}`,
    value: model.id,
  })) ?? [];

  return (
    <section aria-labelledby="prompt-preview-title" className="space-y-4 border-b border-border-subtle p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="type-section-title" id="prompt-preview-title">Prompt Preview</h2>
          <Badge variant="warning">真实首稿</Badge>
        </div>
        <p className="text-sm text-text-secondary">
          仅使用已保存 Prompt；结果来自冻结快照，不代表当前未保存 Markdown。
        </p>
      </div>

      {!prompt ? (
        <p className="text-sm text-text-muted">选择并保存 Prompt 后可运行真实 Preview。</p>
      ) : options.isPending && !options.data ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : options.error && !options.data ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-danger">{errorMessage(options.error)}</p>
          <Button onClick={() => void options.refetch()} size="sm" type="button" variant="outline">
            重试加载 Preview 选项
          </Button>
        </div>
      ) : options.data ? (
        <div className="space-y-4">
          {options.error ? (
            <p className="text-sm text-danger" role="alert">
              刷新 Preview 选项失败，已保留当前选项：{errorMessage(options.error)}
            </p>
          ) : null}
          {gateReason ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-text-primary">
              {gateReason}
            </p>
          ) : null}
          <label className="space-y-1.5 text-sm" htmlFor="prompt-preview-context">
            <span className="type-label block">Test Context</span>
            <Select
              disabled={Boolean(gateReason) || contextItems.length === 0}
              items={contextItems}
              onValueChange={(value) => changeContext(value ?? undefined)}
              value={selectedContextId ?? null}
            >
              <SelectTrigger className="w-full max-w-full" id="prompt-preview-context">
                <SelectValue placeholder="请选择内容任务" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {contextItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          {contextItems.length === 0 ? (
            <p className="text-sm text-text-muted">
              当前没有合格上下文。Prompt 必须绑定到拥有可生成首稿任务的平台。
            </p>
          ) : null}
          <label className="space-y-1.5 text-sm" htmlFor="prompt-preview-model">
            <span className="type-label block">模型</span>
            <Select
              disabled={Boolean(gateReason) || modelItems.length === 0}
              items={modelItems}
              onValueChange={(value) => changeModel(value ?? undefined)}
              value={selectedModelId ?? null}
            >
              <SelectTrigger className="w-full max-w-full" id="prompt-preview-model">
                <SelectValue placeholder="请选择模型" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {modelItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          {modelItems.length === 0 ? (
            <p className="text-sm text-text-muted">当前没有已启用且测试通过的模型。</p>
          ) : null}
          <Button
            disabled={!canConfirm || create.isPending}
            onClick={() => {
              setError(undefined);
              setConfirmationIdentity(selectionIdentity);
            }}
            type="button"
          >
            运行真实 Preview
          </Button>
        </div>
      ) : null}

      {error && confirmationIdentity !== selectionIdentity ? (
        <p className="text-sm text-danger" role="alert">{error}</p>
      ) : null}

      {submitted ? (
        <PreviewJob
          error={jobs.error}
          job={trackedJob ?? submitted.job}
          onFullscreen={() => setFullscreen(true)}
          onRetryVersion={() => void version.refetch()}
          submitted={submitted}
          version={version.data}
          versionError={version.error}
        />
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open && !create.isPending) setConfirmationIdentity(undefined);
        }}
        open={confirmationIdentity === selectionIdentity}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={!create.isPending}>
          <DialogHeader>
            <DialogTitle>确认创建真实首稿？</DialogTitle>
            <DialogDescription>
              这不是沙箱。系统将创建普通、可审计的 GenerationJob 和 AI ContentVersion，
              并占用所选任务的首稿位置。
            </DialogDescription>
          </DialogHeader>
          {selectedContext ? (
            <div className="rounded-lg border border-border-subtle p-3 text-sm">
              <p className="font-medium text-text-primary">{contextLabel(selectedContext)}</p>
              <p className="mt-1 text-text-muted">
                Prompt Revision {optionPrompt?.revision} · {selectedModel?.display_name}
              </p>
            </div>
          ) : null}
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          <DialogFooter>
            <DialogClose disabled={create.isPending} render={<Button variant="outline" />}>
              取消
            </DialogClose>
            <Button disabled={!canConfirm || create.isPending} onClick={() => void submit()} type="button">
              {create.isPending ? '创建作业中…' : '确认创建真实首稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fullscreen && version.data ? (
        <Dialog onOpenChange={(open) => !open && setFullscreen(false)} open>
          <DialogContent className="h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-6xl">
            <DialogHeader>
              <DialogTitle>{version.data.title}</DialogTitle>
              <DialogDescription>
                不可变 ContentVersion {version.data.id} · {submitted?.prompt.name} Revision {submitted?.prompt.revision}
              </DialogDescription>
            </DialogHeader>
            <MarkdownPreview value={version.data.body_markdown} />
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function PreviewJob({
  error,
  job,
  onFullscreen,
  onRetryVersion,
  submitted,
  version,
  versionError,
}: {
  error: Error | null;
  job: GenerationJob;
  onFullscreen: () => void;
  onRetryVersion: () => void;
  submitted: SubmittedPreview;
  version?: ContentVersion;
  versionError: Error | null;
}) {
  return (
    <section aria-labelledby="prompt-preview-result-title" className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-text-primary" id="prompt-preview-result-title">Preview 结果</h3>
        <Badge variant={job.status === 'SUCCEEDED' ? 'success' : job.status === 'FAILED' ? 'destructive' : 'info'}>
          {job.status}
        </Badge>
      </div>
      <div className="space-y-1 break-all font-mono text-xs text-text-muted">
        <p>Job {job.id}</p>
        <p>Prompt {submitted.prompt.id} · Revision {submitted.prompt.revision}</p>
      </div>
      <a className="text-sm text-primary underline-offset-4 hover:underline" href={`/content/tasks/${submitted.context.content_task_id}`}>
        查看任务 {submitted.context.identifier}
      </a>
      {error ? <p className="text-sm text-danger" role="alert">{errorMessage(error)}</p> : null}
      {job.status === 'PENDING' ? <p className="text-sm text-text-secondary">作业已排队，等待 Worker 执行。</p> : null}
      {job.status === 'RUNNING' ? <p className="text-sm text-text-secondary">作业正在执行。</p> : null}
      {job.status === 'FAILED' ? (
        <p className="text-sm text-danger" role="alert">
          {job.error_code ? `${job.error_code}：` : ''}{job.error_summary ?? '生成作业失败'}
        </p>
      ) : null}
      {job.status === 'SUCCEEDED' && !job.content_version_id ? (
        <p className="text-sm text-danger" role="alert">作业成功但缺少 ContentVersion 身份。</p>
      ) : null}
      {versionError ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-danger">{errorMessage(versionError)}</p>
          <Button onClick={onRetryVersion} size="sm" type="button" variant="outline">重试读取结果</Button>
        </div>
      ) : null}
      {version ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-medium text-text-primary">{version.title}</h4>
              <Badge variant="outline">{version.status}</Badge>
            </div>
            <p className="text-sm text-text-secondary">{version.summary}</p>
            <p className="break-all font-mono text-xs text-text-muted">Version {version.id}</p>
          </div>
          <MarkdownPreview className="max-h-72 overflow-auto rounded-lg border border-border-subtle p-3" value={version.body_markdown} />
          <div className="flex flex-wrap gap-2">
            {version.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
          <Button onClick={onFullscreen} size="sm" type="button" variant="outline">全屏查看结果</Button>
        </div>
      ) : null}
    </section>
  );
}

function previewGateReason(
  prompt: PlatformPromptDetail | undefined,
  dirty: boolean,
  optionPrompt: PromptSnapshot | undefined,
) {
  if (!prompt) return '请先选择并保存 Prompt。';
  if (dirty) return '当前 Prompt 有未保存修改；保存或还原后才能运行 Preview。';
  if (!optionPrompt) return undefined;
  if (optionPrompt.id !== prompt.id || optionPrompt.revision !== prompt.revision) {
    return 'Prompt Detail 与 Preview Options revision 不一致，请刷新后重试。';
  }
  return undefined;
}

function contextLabel(context: PreviewContext) {
  return `${context.identifier} · ${context.brand} ${context.part_number} · ${context.platform_profile_name} · Fact v${context.fact_version}`;
}

function stableCommandKey(reference: { current: CommandKey | undefined }, signature: string) {
  if (reference.current?.signature === signature) return reference.current.key;
  const next = { key: crypto.randomUUID(), signature };
  reference.current = next;
  return next.key;
}

async function invalidatePreviewConsumers(
  queryClient: QueryClient,
  taskId: string,
  includeJobs: boolean,
) {
  await Promise.all([
    ...(includeJobs ? [queryClient.invalidateQueries({ exact: true, queryKey: contentKeys.generationJobs(taskId) })] : []),
    queryClient.invalidateQueries({ queryKey: promptKeys.previewOptionsRoot() }),
    queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: contentKeys.details() }),
    queryClient.invalidateQueries({ queryKey: contentKeys.editorContexts() }),
  ]);
}

function isErrorCode(error: unknown, code: string) {
  return error instanceof ContentRequestError && error.detail?.code === code;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Prompt Preview 请求失败';
}

export { PromptPreview };
