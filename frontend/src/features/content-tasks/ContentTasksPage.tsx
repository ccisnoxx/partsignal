/** 内容任务页串联批准事实、平台规则、异步生成和内容版本入口。 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { ContentTaskListItem, ContentTaskListQuery, ContentVersion, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useActiveSection } from '../../shared/hooks/useActiveSection';

const taskSectionIds = ['task-constraints', 'task-generation', 'task-versions'];
const taskPageSize = 10;
type TaskStatus = Schema<'ContentTaskStatus'>;
type TaskStatusFilter = 'ALL' | TaskStatus;
const taskStatusOptions: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'OPEN', label: '进行中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
];
const taskDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function isTaskStatus(value: string): value is TaskStatus {
  return taskStatusOptions.some((option) => option.value === value);
}

export function ContentTasksPage() {
  const { taskId } = useParams();
  return taskId ? <TaskDetail taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get('page');
  const rawStatus = searchParams.get('status');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const keyword = searchParams.get('q') ?? '';
  const status: TaskStatusFilter = rawStatus && isTaskStatus(rawStatus) ? rawStatus : 'ALL';
  const desiredFormat = searchParams.get('format') ?? '';
  const platformProfileId = searchParams.get('platform_profile_id') ?? undefined;
  const platformProfileVersionId = searchParams.get('platform_profile_version_id') ?? undefined;
  const taskListQuery: ContentTaskListQuery = {
    ...(platformProfileId ? { platform_profile_id: platformProfileId } : {}),
    ...(platformProfileVersionId ? { platform_profile_version_id: platformProfileVersionId } : {}),
  };
  const tasks = useQuery({
    queryKey: queryKeys.contentTasks.list(taskListQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks', { params: { query: taskListQuery } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const items = tasks.data?.items ?? [];
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  const filteredTasks = items.filter((task) => {
    const matchesKeyword = !normalizedKeyword || [task.product.brand, task.product.part_number, task.platform.name, task.content_angle, task.target_audience, task.desired_format, task.conversion_goal]
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedKeyword));
    return matchesKeyword && (status === 'ALL' || task.status === status) && (!desiredFormat || task.desired_format === desiredFormat);
  });
  const formatOptions = [...new Set(items.map((task) => task.desired_format))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((value) => ({ value, label: value }));
  const statusCounts = Object.fromEntries(taskStatusOptions.map((option) => [option.value, items.filter((task) => task.status === option.value).length])) as Record<TaskStatus, number>;
  const maxPage = Math.max(1, Math.ceil(filteredTasks.length / taskPageSize));
  useEffect(() => {
    if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (rawStatus !== null && !isTaskStatus(rawStatus)) || (tasks.data && page > maxPage)) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      if (rawStatus !== null && !isTaskStatus(rawStatus)) next.delete('status');
      setSearchParams(next, { replace: true });
    }
  }, [maxPage, page, rawPage, rawStatus, searchParams, setSearchParams, tasks.data]);
  const setFilter = (key: 'q' | 'status' | 'format' | 'platform_profile_id' | 'platform_profile_version_id', value?: string, replace = false) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setSearchParams(next, { replace });
  };
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'status', 'format', 'page'].forEach((key) => next.delete(key));
    setSearchParams(next);
  };

  return <div className="page-stack tasks-workbench">
    <PageHeader
      eyebrow="内容工作流"
      title="内容任务台"
      description="集中查看内容任务约束、处理状态与创建时间，任务事实版本和平台规则始终按服务端记录锁定。"
      actions={<Button aria-label="新建内容任务" aria-haspopup="dialog" aria-expanded={open} className="tasks-primary-action" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建内容任务</Button>}
    />

    <Card className="tasks-glass-panel tasks-filter-panel" variant="borderless">
      {platformProfileId && <Tag className="tasks-platform-filter" closable onClose={() => setFilter('platform_profile_id')}>当前平台：{items[0]?.platform.name ?? platformProfileId}</Tag>}
      {platformProfileVersionId && <Tag className="tasks-platform-filter" closable onClose={() => setFilter('platform_profile_version_id')}>当前规则版本：{platformProfileVersionId.slice(0, 8)}</Tag>}
      <div className="tasks-filter-grid" role="search" aria-label="内容任务筛选">
        <Input
          allowClear
          aria-label="搜索内容任务"
          type="search"
          prefix={<SearchOutlined />}
          placeholder="搜索产品、平台、内容角度或任务要求"
          value={keyword}
          onChange={(event) => setFilter('q', event.target.value, true)}
        />
        <Select
          allowClear
          aria-label="筛选内容形式"
          placeholder="全部内容形式"
          value={desiredFormat || undefined}
          options={formatOptions}
          onChange={(value) => setFilter('format', value)}
        />
        <Button aria-label="重置筛选" icon={<ReloadOutlined />} disabled={!keyword && status === 'ALL' && !desiredFormat} onClick={resetFilters}>重置筛选</Button>
      </div>
      <Tabs
        className="tasks-status-tabs"
        activeKey={status}
        onChange={(value) => setFilter('status', value === 'ALL' ? undefined : value)}
        items={[
          { key: 'ALL', label: <span>全部 <b>{items.length}</b></span> },
          ...taskStatusOptions.map((option) => ({ key: option.value, label: <span>{option.label} <b>{statusCounts[option.value]}</b></span> })),
        ]}
      />
    </Card>

    <section className="tasks-metric-grid" aria-label="内容任务摘要">
      <div className="tasks-metric-cell"><span className="tasks-metric-icon tasks-metric-all" aria-hidden="true"><UnorderedListOutlined /></span><MetricTile label="全部任务" value={tasks.data ? items.length : '—'} meta="当前列表全部记录" /></div>
      <div className="tasks-metric-cell"><span className="tasks-metric-icon tasks-metric-open" aria-hidden="true"><ClockCircleOutlined /></span><MetricTile label="进行中任务" value={tasks.data ? statusCounts.OPEN : '—'} meta="状态 OPEN" tone="data" /></div>
      <div className="tasks-metric-cell"><span className="tasks-metric-icon tasks-metric-completed" aria-hidden="true"><CheckCircleOutlined /></span><MetricTile label="已完成任务" value={tasks.data ? statusCounts.COMPLETED : '—'} meta="状态 COMPLETED" tone="success" /></div>
      <div className="tasks-metric-cell"><span className="tasks-metric-icon tasks-metric-cancelled" aria-hidden="true"><CloseCircleOutlined /></span><MetricTile label="已取消任务" value={tasks.data ? statusCounts.CANCELLED : '—'} meta="状态 CANCELLED" /></div>
    </section>

    <Card
      className="tasks-glass-panel tasks-table-panel"
      title="任务列表"
      extra={<Typography.Text className="tasks-table-summary">显示 {filteredTasks.length} / {items.length} 条</Typography.Text>}
    >
      {tasks.error ? <QueryFailure error={tasks.error} onRetry={() => void tasks.refetch()} /> : <div aria-busy={tasks.isLoading}>
        <TableRegion label="内容任务列表">
          <Table<ContentTaskListItem>
            rowKey="id"
            loading={{ spinning: tasks.isLoading, description: '正在加载内容任务列表' }}
            dataSource={filteredTasks}
            pagination={{
              current: page,
              pageSize: taskPageSize,
              showSizeChanger: false,
              showTotal: (total, range) => `${range[0]}–${range[1]} / 共 ${total} 条`,
              onChange: setPage,
            }}
            locale={{ emptyText: <NoData description={items.length ? '没有符合当前筛选条件的任务' : '暂无内容任务'} /> }}
            rowClassName={(row) => row.latest_generation_status === 'FAILED' ? 'task-row-generation-failed' : ''}
            scroll={{ x: 940 }}
            columns={[
              {
                title: '产品名称',
                render: (_, row) => <div className="task-title-cell"><strong title={`${row.product.brand} ${row.product.part_number}`}>{row.product.brand} <span className="data-code">{row.product.part_number}</span></strong><span title={row.content_angle}>{row.content_angle}</span></div>,
              },
              { title: '目标平台', width: 190, render: (_, row) => <div className="task-platform-cell"><PlatformAvatar name={row.platform.name} logo={row.platform.logo} />{row.platform.website_url ? <a href={row.platform.website_url} target="_blank" rel="noreferrer" title={row.platform.name}>{row.platform.name}</a> : <span title={row.platform.name}>{row.platform.name}</span>}</div> },
              { title: '任务状态', dataIndex: 'status', width: 118, render: (value: TaskStatus) => <StatusTag status={value} /> },
              { title: 'AI 生成状态', dataIndex: 'latest_generation_status', width: 132, render: (value: Schema<'GenerationJobStatus'> | null) => value ? <StatusTag status={value} /> : <Tag className="status-tag status-tag-neutral">尚未生成</Tag> },
              { title: '创建时间', dataIndex: 'created_at', width: 170, render: (value: string) => <time dateTime={value}>{taskDateFormatter.format(new Date(value))}</time> },
              { title: '快捷操作', key: 'actions', width: 112, fixed: 'right', render: (_, row) => <Link className="task-row-action" aria-label={`查看任务：${row.product.brand} ${row.product.part_number}`} to={`/tasks/${row.id}`}>查看详情 <RightOutlined /></Link> },
            ]}
          />
        </TableRegion>
      </div>}
    </Card>
    <TaskCreateModal open={open} onClose={() => setOpen(false)} />
  </div>;
}

function TaskCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [productId, setProductId] = useState<string>();
  const [form] = Form.useForm<Schema<'ContentTaskCreate'>>();
  const products = useQuery({ ...productsQueryOptions(), enabled: open });
  const platforms = useQuery({ ...platformProfilesQueryOptions(), enabled: open });
  const facts = useQuery({ queryKey: queryKeys.products.factVersions(productId), queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId ?? '' } } })), enabled: open && !!productId, staleTime: QUERY_STALE_TIME.detail });
  const create = useMutation({ mutationFn: async (body: Schema<'ContentTaskCreate'>) => unwrap(await api.POST('/api/v1/content-tasks', { params: { header: csrfHeader() }, body })), onSuccess: async () => { onClose(); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }); } });
  const dependencyError = products.error ?? platforms.error ?? facts.error;
  const dependenciesLoading = products.isLoading || platforms.isLoading || (!!productId && facts.isLoading);
  return <Modal title="创建内容任务" open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden>{create.error && <Alert role="alert" className="form-alert" type="error" message={errorMessage(create.error)} />}{dependencyError && <QueryFailure error={dependencyError} onRetry={() => { void products.refetch(); void platforms.refetch(); if (productId) void facts.refetch(); }} />}{dependenciesLoading && <QueryLoading label="正在加载任务前置数据" />}<Form<Schema<'ContentTaskCreate'>> form={form} layout="vertical" disabled={!!dependencyError || dependenciesLoading} scrollToFirstError onFinish={(body) => create.mutate(body)}><Space align="start" wrap className="form-grid">
    <Form.Item name="product_id" label="产品" rules={[{ required: true }]}><Select showSearch onChange={(value) => { setProductId(value); form.setFieldValue('fact_version_id', undefined); }} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></Form.Item>
    <Form.Item name="fact_version_id" label="已批准事实版本" rules={[{ required: true }]}><Select disabled={!productId} options={facts.data?.items.filter((item) => item.status === 'APPROVED').map((item) => ({ value: item.id, label: `V${item.version} · ${item.change_summary}` }))} /></Form.Item>
    <Form.Item name="platform_profile_version_id" label="可用平台" rules={[{ required: true }]}><Select placeholder="仅显示已启用且配置完整的平台" options={platforms.data?.items.flatMap((item) => item.is_active && item.platform_type_id && item.active_version && item.prompt_configured ? [{ value: item.active_version.id, label: `${item.name} V${item.active_version.version}` }] : [])} /></Form.Item>
  </Space><Form.Item name="target_audience" label="目标受众" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="content_angle" label="内容角度" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="conversion_goal" label="转化目标" rules={[{ required: true }]}><Input /></Form.Item><Space align="start" wrap><Form.Item name="desired_format" label="内容形式" rules={[{ required: true }]}><Input placeholder="例如：参数对比文章" /></Form.Item><Form.Item name="desired_length_min" label="最短字数" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name="desired_length_max" label="最长字数" dependencies={['desired_length_min']} rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Form.Item name="canonical_url" label="官网权威页" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建任务</Button></Form></Modal>;
}

function TaskDetail({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const activeSection = useActiveSection(taskSectionIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [modelId, setModelId] = useState<string>();
  const [humanizeSource, setHumanizeSource] = useState<ContentVersion>();
  const [humanizeModelId, setHumanizeModelId] = useState<string>();
  const task = useQuery({ queryKey: queryKeys.contentTasks.detail(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.detail });
  const versions = useQuery({ queryKey: queryKeys.contentTasks.versions(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.detail });
  const jobs = useQuery({ queryKey: queryKeys.contentTasks.jobs(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.workbench, refetchInterval: (query) => query.state.data?.items.some((job) => ['PENDING', 'RUNNING'].includes(job.status)) ? 2000 : false });
  const options = useQuery({ queryKey: queryKeys.contentTasks.options(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-options', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.configuration, retry: false });
  const savePrompt = useMutation({ mutationFn: async ({ userPrompt, classification }: { userPrompt: string; classification: Schema<'Confidentiality'> }) => { if (!task.data) throw new Error('任务未加载'); return unwrap(await api.PATCH('/api/v1/content-tasks/{content_task_id}/user-prompt', { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body: { expected_revision: task.data.revision, user_prompt_markdown: userPrompt, generation_data_classification: classification } })); }, onSuccess: async () => { message.success('生成输入已保存'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }); } });
  const createJob = useMutation({ mutationFn: async () => { if (!modelId) throw new Error('请选择模型'); return unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } }, body: { ai_model_id: modelId } })); }, onSuccess: async () => { message.success('生成作业已创建'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }); } });
  const createHumanizationJob = useMutation({ mutationFn: async () => { if (!humanizeSource || !humanizeModelId) throw new Error('请选择自然化来源和模型'); return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/humanization-jobs', { params: { path: { content_version_id: humanizeSource.id }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } }, body: { ai_model_id: humanizeModelId } })); }, onSuccess: async () => { setHumanizeSource(undefined); setHumanizeModelId(undefined); message.success('自然化作业已创建'); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }), queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) })]); } });
  const retryJob = useMutation({ mutationFn: async (jobId: string) => unwrap(await api.POST('/api/v1/generation-jobs/{generation_job_id}/retry', { params: { path: { generation_job_id: jobId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } } })), onSuccess: async () => { message.success('已提交原快照重试'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }); } });
  const taskCommand = useMutation({ mutationFn: async (body: Schema<'CommandRequest'>) => unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/cancel', { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body })), onSuccess: async () => { setCancelOpen(false); message.success('内容任务已取消'); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }), queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all })]); } });
  const latestJob = jobs.data?.items[0];
  const jobDetail = useQuery({ queryKey: queryKeys.generationJob(latestJob?.id), queryFn: async () => unwrap(await api.GET('/api/v1/generation-jobs/{generation_job_id}', { params: { path: { generation_job_id: latestJob?.id ?? '' } } })), enabled: !!latestJob, staleTime: QUERY_STALE_TIME.detail });
  const succeededJobs = jobs.data?.items.filter((job) => job.status === 'SUCCEEDED').map((job) => job.id).join(',');
  const activeHumanizationSources = new Set(jobs.data?.items.filter((job) => job.job_type === 'HUMANIZE' && ['PENDING', 'RUNNING'].includes(job.status)).map((job) => job.source_content_version_id));
  useEffect(() => {
    if (succeededJobs) void queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) });
  }, [succeededJobs, taskId]);
  if (task.isLoading) return <QueryLoading label="正在加载内容任务" />;
  if (task.error || !task.data) return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><PageHeader title="内容任务" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} /><QueryFailure error={task.error ?? new Error('内容任务不存在')} onRetry={() => void task.refetch()} /></div>;
  return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><PageHeader eyebrow={`任务 / ${taskId.slice(0, 8)}`} title={task.data.content_angle} description={`${task.data.target_audience} · ${task.data.desired_format}`} breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} actions={<><StatusTag status={task.data.status} />{task.data.available_actions.includes('CANCEL') && <Button danger onClick={() => setCancelOpen(true)}>取消任务</Button>}</>} />
    {(savePrompt.error || createJob.error || createHumanizationJob.error || retryJob.error || taskCommand.error) && <Alert type="error" message={errorMessage(savePrompt.error ?? createJob.error ?? createHumanizationJob.error ?? retryJob.error ?? taskCommand.error)} />}
    <nav className="form-section-nav" aria-label="内容任务章节"><a href="#task-constraints" aria-current={activeSection === 'task-constraints' ? 'location' : undefined}>任务约束</a><a href="#task-generation" aria-current={activeSection === 'task-generation' ? 'location' : undefined}>生成输入</a><a href="#task-versions" aria-current={activeSection === 'task-versions' ? 'location' : undefined}>内容版本</a></nav>
    <section className="task-stage-grid"><Card id="task-constraints" title="01 / 任务约束" className="workspace-panel workspace-section"><Descriptions column={{ xs: 1, md: 2 }} items={[{ label: '事实版本', children: <span className="data-code">{task.data.fact_version_id}</span> }, { label: '锁定平台', children: options.data?.platform_profile_name ?? task.data.platform_profile_version_id }, { label: '平台规则版本', children: <span className="data-code">{task.data.platform_profile_version_id}</span> }, { label: '平台类型', children: task.data.platform_type_snapshot ? String(task.data.platform_type_snapshot.name) : '未归类' }, { label: '转化目标', children: task.data.conversion_goal }, { label: '官网 URL', children: <a href={task.data.canonical_url} target="_blank" rel="noreferrer">{task.data.canonical_url}</a> }]} /></Card>
    <Card id="task-generation" title="02 / 生成输入" className="workspace-panel workspace-section">{options.isLoading ? <QueryLoading label="正在加载生成选项" /> : options.error || !options.data ? <QueryFailure error={options.error ?? new Error('生成选项不存在')} onRetry={() => void options.refetch()} /> : <><Alert type="warning" showIcon message="批准事实优先；只有完整生成输入和全部事实证据均为 PUBLIC 时，才能发送到第三方模型。" />{!options.data.humanization_prompt_configured && <Alert type="info" showIcon message="管理员尚未配置全局自然化 Prompt；现有草稿生成不受影响，自然化入口暂不可用。" />} <PromptEditor key={task.data.revision} initial={task.data.user_prompt_markdown} initialClassification={task.data.generation_data_classification} disabled={task.data.status !== 'OPEN'} loading={savePrompt.isPending} onSave={(userPrompt, classification) => savePrompt.mutate({ userPrompt, classification })} /><Space wrap className="generation-controls"><Select aria-label="生成模型" className="model-select" showSearch optionFilterProp="label" placeholder="选择已启用且测试通过的模型" value={modelId} onChange={setModelId} options={options.data.models.map((item) => ({ value: item.id, label: `${item.channel_name} / ${item.display_name} (${item.model_id})` }))} /><Button type="primary" icon={<ThunderboltOutlined />} loading={createJob.isPending} disabled={!modelId || task.data.status !== 'OPEN' || task.data.generation_data_classification !== 'PUBLIC'} onClick={() => createJob.mutate()}>生成草稿</Button></Space><Typography.Title level={5}>当前平台 Prompt（只读）</Typography.Title><Input.TextArea aria-label="当前平台 Prompt" rows={8} readOnly value={options.data.system_prompt_markdown} className="markdown-source" /></>}</Card></section>
    <Card title="AI 作业" className="workspace-panel">{jobs.isLoading ? <QueryLoading label="正在加载 AI 作业" /> : jobs.error || !jobs.data ? <QueryFailure error={jobs.error ?? new Error('AI 作业列表不存在')} onRetry={() => void jobs.refetch()} /> : jobs.data.items.length ? <TableRegion label="AI 作业列表"><Table rowKey="id" dataSource={jobs.data.items} scroll={{ x: 980 }} pagination={false} columns={[{ title: '类型', dataIndex: 'job_type', width: 110, render: (value) => value === 'HUMANIZE' ? '自然化' : '原始生成' }, { title: '源版本', dataIndex: 'source_content_version_id', width: 150, render: (value) => value ? <Link to={`/content/${value}`}>{value.slice(0, 8)}</Link> : '—' }, { title: '状态', dataIndex: 'status', width: 110, render: (value) => <StatusTag status={value} /> }, { title: '结果', dataIndex: 'content_version_id', width: 150, render: (value) => value ? <Link to={`/content/${value}`}>打开草稿</Link> : '—' }, { title: '失败原因', dataIndex: 'error_summary' }, { title: '耗时 / Token', width: 180, render: (_, row) => `${row.response_duration_ms ?? '—'} ms / ${row.total_tokens ?? '—'}` }, { title: '操作', width: 130, fixed: 'right', render: (_, row) => row.status === 'FAILED' ? <Button size="small" loading={retryJob.isPending} onClick={() => retryJob.mutate(row.id)}>重试原快照</Button> : null }]} /></TableRegion> : <Typography.Text type="secondary">尚无 AI 作业。</Typography.Text>}{jobDetail.isLoading && <QueryLoading label="正在加载最新作业追溯" />}{jobDetail.error && <QueryFailure error={jobDetail.error} onRetry={() => void jobDetail.refetch()} />}</Card>
    {jobDetail.data && <Card title="最新作业追溯快照"><Descriptions column={1} items={[{ label: '渠道 / 模型', children: `${String(jobDetail.data.input_snapshot.channel.name)} / ${String(jobDetail.data.input_snapshot.model.model_id)}` }, { label: '请求参数', children: <pre>{JSON.stringify(jobDetail.data.input_snapshot.model.request_parameters, null, 2)}</pre> }, { label: '系统消息（System Message）', children: <Input.TextArea aria-label="系统消息（System Message）" rows={8} readOnly value={jobDetail.data.input_snapshot.system_message} /> }, { label: '用户消息（User Message）', children: <Input.TextArea aria-label="用户消息（User Message）" rows={10} readOnly value={jobDetail.data.input_snapshot.user_message} /> }]} /></Card>}
    <Card id="task-versions" title="03 / 内容版本" className="workspace-section">{versions.isLoading ? <QueryLoading label="正在加载内容版本" /> : versions.error || !versions.data ? <QueryFailure error={versions.error ?? new Error('内容版本列表不存在')} onRetry={() => void versions.refetch()} /> : <TableRegion label="内容版本列表"><Table<ContentVersion> rowKey="id" dataSource={versions.data.items} scroll={{ x: 880 }} columns={[{ title: '版本', dataIndex: 'version', render: (v, row) => <Link className="data-code" to={`/content/${row.id}`}>V{v}</Link> }, { title: '标题', dataIndex: 'title' }, { title: '来源', dataIndex: 'source_type', width: 100, render: (value) => <StatusTag status={value} /> }, { title: '状态', dataIndex: 'status', width: 140, render: (v) => <StatusTag status={v} /> }, { title: '质量问题', dataIndex: 'quality_issues', width: 100, render: (issues: Schema<'QualityIssue'>[]) => issues.length }, { title: '操作', width: 120, fixed: 'right', render: (_, row) => { const eligible = row.source_type === 'AI' && ['DRAFT', 'CHANGES_REQUESTED'].includes(row.status) && task.data.status === 'OPEN' && options.data?.humanization_prompt_configured && task.data.generation_data_classification === 'PUBLIC' && !activeHumanizationSources.has(row.id); return <Button size="small" disabled={!eligible} onClick={() => setHumanizeSource(row)}>自然化</Button>; } }]} /></TableRegion>}</Card>
    <Modal title="取消任务" open={cancelOpen} onCancel={() => setCancelOpen(false)} footer={null} destroyOnHidden><Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: task.data?.revision, comment: '' }} onFinish={(body) => taskCommand.mutate(body)}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="说明"><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit">确认取消</Button></Form></Modal>
    <Modal title={`自然化 V${humanizeSource?.version ?? ''}`} open={!!humanizeSource} onCancel={() => { setHumanizeSource(undefined); setHumanizeModelId(undefined); }} onOk={() => createHumanizationJob.mutate()} okText="创建自然化作业" confirmLoading={createHumanizationJob.isPending} okButtonProps={{ disabled: !humanizeModelId }} destroyOnHidden><Alert type="info" showIcon message="这会额外调用一次所选模型，并创建新的待审核草稿；源版本不会被修改。" /><Form.Item label="自然化模型" required><Select aria-label="自然化模型" showSearch optionFilterProp="label" placeholder="选择已启用且测试通过的模型" value={humanizeModelId} onChange={setHumanizeModelId} options={options.data?.models.map((item) => ({ value: item.id, label: `${item.channel_name} / ${item.display_name} (${item.model_id})` }))} /></Form.Item></Modal>
  </div>;
}

function PromptEditor({ initial, initialClassification, disabled, loading, onSave }: { initial: string; initialClassification: Schema<'Confidentiality'> | null; disabled: boolean; loading: boolean; onSave: (value: string, classification: Schema<'Confidentiality'>) => void }) {
  const [value, setValue] = useState(initial);
  const [classification, setClassification] = useState<Schema<'Confidentiality'> | undefined>(initialClassification ?? undefined);
  return <><Form.Item label="完整生成输入数据分级" required><Select aria-label="完整生成输入数据分级" value={classification} placeholder="请选择本次 Prompt、任务要求和批准事实的最高分级" onChange={setClassification} options={[{ value: 'PUBLIC', label: 'PUBLIC · 可发送第三方模型' }, { value: 'INTERNAL', label: 'INTERNAL · 禁止发送第三方模型' }, { value: 'RESTRICTED', label: 'RESTRICTED · 禁止发送第三方模型' }]} /></Form.Item><Form.Item label="工程师 user_prompt Markdown"><Input.TextArea aria-label="工程师 user_prompt Markdown" rows={12} className="markdown-source" value={value} onChange={(event) => setValue(event.target.value)} /></Form.Item><Button onClick={() => classification && onSave(value, classification)} loading={loading} disabled={disabled || !classification}>保存 Prompt 与分级</Button></>;
}
