/** 通过现有可追溯作业生成 Prompt 预览，不读取包含完整输入快照的作业详情。 */
import { EyeOutlined, FullscreenOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Alert, App, Button, Empty, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { ContentTaskListItem, ContentVersion, GenerationJob } from '../../shared/api/types';
import { QueryFailure } from '../../shared/components/AsyncState';
import { StatusTag } from '../../shared/components/StatusTag';

type PreviewMode = 'platform' | 'humanization';

type PromptOutputPreviewProps = {
  mode: PreviewMode;
  platformProfileId?: string;
  dirty: boolean;
  promptConfigured: boolean;
};

type PreviewSelection = {
  scope: string;
  taskId?: string;
  sourceVersionId?: string;
  modelId?: string;
};

function taskLabel(task: ContentTaskListItem): string {
  return `${task.product.brand} ${task.product.part_number} · ${task.content_angle}`;
}

function PreviewArticle({ content }: { content: ContentVersion }) {
  const safeHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(content.body_markdown) as string),
    [content.body_markdown],
  );
  return <article className="prompt-preview-article">
    <header>
      <Space size={6} wrap><Tag color="blue">AI 草稿</Tag><StatusTag status={content.status} /></Space>
      <Typography.Title level={4}>{content.title}</Typography.Title>
      <Typography.Paragraph type="secondary">{content.summary}</Typography.Paragraph>
      <Space size={[4, 4]} wrap>{content.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
    </header>
    <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: safeHtml }} />
  </article>;
}

export function PromptOutputPreview({ mode, platformProfileId, dirty, promptConfigured }: PromptOutputPreviewProps) {
  const { message } = App.useApp();
  const scope = `${mode}:${platformProfileId ?? ''}`;
  const [storedSelection, setStoredSelection] = useState<PreviewSelection>({ scope: '' });
  const selection = storedSelection.scope === scope ? storedSelection : { scope };
  const { taskId, sourceVersionId, modelId } = selection;
  const [jobContext, setJobContext] = useState<{ id: string; taskId: string; initial: GenerationJob }>();
  const [fullscreen, setFullscreen] = useState(false);
  const taskQuery = mode === 'platform' && platformProfileId ? { platform_profile_id: platformProfileId } : {};
  const tasks = useQuery({
    queryKey: queryKeys.contentTasks.list(taskQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks', { params: { query: taskQuery } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const eligibleTasks = useMemo(() => (tasks.data?.items ?? []).filter((task) => (
    task.status === 'OPEN'
    && task.generation_data_classification === 'PUBLIC'
    && task.user_prompt_markdown.trim().length > 0
  )), [tasks.data?.items]);
  const versions = useQuery({
    queryKey: queryKeys.contentTasks.versions(taskId ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', {
      params: { path: { content_task_id: taskId! } },
    })),
    enabled: mode === 'humanization' && !!taskId,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const eligibleVersions = useMemo(() => (versions.data?.items ?? []).filter((version) => (
    version.source_type === 'AI' && ['DRAFT', 'CHANGES_REQUESTED'].includes(version.status)
  )), [versions.data?.items]);
  const options = useQuery({
    queryKey: queryKeys.contentTasks.options(taskId ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-options', {
      params: { path: { content_task_id: taskId! } },
    })),
    enabled: !!taskId,
    staleTime: QUERY_STALE_TIME.configuration,
    retry: false,
  });
  const jobs = useQuery({
    queryKey: queryKeys.contentTasks.jobs(jobContext?.taskId ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-jobs', {
      params: { path: { content_task_id: jobContext!.taskId } },
    })),
    enabled: !!jobContext,
    staleTime: QUERY_STALE_TIME.workbench,
    refetchInterval: (query) => {
      const current = query.state.data?.items.find((job) => job.id === jobContext?.id) ?? jobContext?.initial;
      return current && ['PENDING', 'RUNNING'].includes(current.status) ? 2000 : false;
    },
  });
  const currentJob = jobs.data?.items.find((job) => job.id === jobContext?.id) ?? jobContext?.initial;
  const content = useQuery({
    queryKey: queryKeys.contentVersions.detail(currentJob?.content_version_id ?? ''),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-versions/{content_version_id}', {
      params: { path: { content_version_id: currentJob!.content_version_id! } },
    })),
    enabled: currentJob?.status === 'SUCCEEDED' && !!currentJob.content_version_id,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const createJob = useMutation({
    mutationFn: async () => {
      if (!taskId || !modelId) throw new Error('请选择内容任务和模型');
      if (mode === 'humanization') {
        if (!sourceVersionId) throw new Error('请选择自然化源草稿');
        return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/humanization-jobs', {
          params: {
            path: { content_version_id: sourceVersionId },
            header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() },
          },
          body: { ai_model_id: modelId },
        }));
      }
      return unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', {
        params: {
          path: { content_task_id: taskId },
          header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() },
        },
        body: { ai_model_id: modelId },
      }));
    },
    onSuccess: async (job) => {
      setJobContext({ id: job.id, taskId: job.content_task_id, initial: job });
      message.success('真实预览作业已创建');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(job.content_task_id) });
    },
  });

  const canGenerate = promptConfigured
    && !dirty
    && !!taskId
    && !!modelId
    && (mode === 'platform' || !!sourceVersionId)
    && !createJob.isPending;
  const queryError = tasks.error ?? versions.error ?? options.error ?? jobs.error ?? content.error;

  return <section className="prompt-output-preview" aria-label="输出预览">
    <header>
      <div><Typography.Text strong>输出预览</Typography.Text><Typography.Text type="secondary">（真实草稿）</Typography.Text></div>
      <Button size="small" type="text" icon={<FullscreenOutlined />} disabled={!content.data} onClick={() => setFullscreen(true)}>全屏预览</Button>
    </header>
    <div className="prompt-preview-controls">
      <Alert
        type="info"
        showIcon
        title="预览会创建可审计的真实 AI 作业和 DRAFT，不会进行无痕临时调用。"
      />
      {dirty && <Alert type="warning" showIcon title="请先保存当前 Prompt，再创建使用新配置的预览。" />}
      {!promptConfigured && <Alert type="warning" showIcon title="当前 Prompt 尚未配置，无法创建预览作业。" />}
      {queryError && <QueryFailure error={queryError} onRetry={() => {
        void tasks.refetch();
        if (taskId) { void options.refetch(); void versions.refetch(); }
        if (jobContext) void jobs.refetch();
        if (currentJob?.content_version_id) void content.refetch();
      }} />}
      <Select
        aria-label="预览内容任务"
        showSearch
        optionFilterProp="label"
        placeholder={tasks.isLoading ? '正在加载内容任务' : '选择公开的进行中任务'}
        loading={tasks.isLoading}
        value={taskId}
        onChange={(value) => setStoredSelection({ scope, taskId: value })}
        options={eligibleTasks.map((task) => ({ value: task.id, label: taskLabel(task) }))}
      />
      {!tasks.isLoading && eligibleTasks.length === 0 && <Typography.Text type="secondary">暂无 OPEN、PUBLIC 且生成输入完整的任务。</Typography.Text>}
      {mode === 'humanization' && <>
        <Select
          aria-label="自然化源草稿"
          showSearch
          optionFilterProp="label"
          placeholder={versions.isLoading ? '正在加载源草稿' : '选择 AI 草稿'}
          loading={versions.isLoading}
          disabled={!taskId}
          value={sourceVersionId}
          onChange={(value) => setStoredSelection({ ...selection, sourceVersionId: value })}
          options={eligibleVersions.map((version) => ({ value: version.id, label: `V${version.version} · ${version.title}` }))}
        />
        {!!taskId && !versions.isLoading && eligibleVersions.length === 0 && <Typography.Text type="secondary">该任务没有可自然化的 AI 草稿。</Typography.Text>}
      </>}
      <Select
        aria-label="预览模型"
        showSearch
        optionFilterProp="label"
        placeholder={options.isLoading ? '正在加载模型' : '选择已启用且测试通过的模型'}
        loading={options.isLoading}
        disabled={!taskId}
        value={modelId}
        onChange={(value) => setStoredSelection({ ...selection, modelId: value })}
        options={options.data?.models.map((model) => ({
          value: model.id,
          label: `${model.channel_name} / ${model.display_name} (${model.model_id})`,
        }))}
      />
      {!!taskId && !options.isLoading && options.data?.models.length === 0 && <Typography.Text type="secondary">当前任务没有可用模型。</Typography.Text>}
      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        loading={createJob.isPending}
        disabled={!canGenerate}
        onClick={() => createJob.mutate()}
      >{mode === 'humanization' ? '生成自然化预览' : '生成平台预览'}</Button>
      {createJob.error && <Alert role="alert" type="error" showIcon title={errorMessage(createJob.error)} />}
    </div>
    <div className="prompt-preview-result" aria-live="polite">
      {currentJob && <div className="prompt-preview-job">
        <Space size={6} wrap><StatusTag status={currentJob.status} /><Typography.Text type="secondary">作业 {currentJob.id.slice(0, 8)}</Typography.Text></Space>
        {currentJob.status === 'FAILED' && <Alert type="error" showIcon title={currentJob.error_code ?? '生成失败'} description={currentJob.error_summary ?? '服务端未返回可公开的失败摘要'} />}
      </div>}
      {currentJob && ['PENDING', 'RUNNING'].includes(currentJob.status) && <div className="prompt-preview-loading"><Spin /><Typography.Text type="secondary">作业执行中，正在读取任务级状态…</Typography.Text></div>}
      {currentJob?.status === 'SUCCEEDED' && content.isLoading && <div className="prompt-preview-loading"><Spin /><Typography.Text type="secondary">正在读取不可变草稿…</Typography.Text></div>}
      {content.data ? <PreviewArticle content={content.data} /> : !currentJob && <Empty image={<EyeOutlined />} description="选择真实任务和模型后生成预览" />}
    </div>
    <footer>
      {jobContext ? <Typography.Text type="secondary">当前结果属于既有作业快照；Prompt 后续修改不会改写它。</Typography.Text> : <Link to="/tasks">前往内容任务</Link>}
    </footer>
    <Modal
      title={content.data ? `输出预览 · ${content.data.title}` : '输出预览'}
      open={fullscreen}
      footer={null}
      width="calc(100vw - 32px)"
      className="prompt-preview-modal"
      onCancel={() => setFullscreen(false)}
      destroyOnHidden
    >{content.data && <PreviewArticle content={content.data} />}</Modal>
  </section>;
}
