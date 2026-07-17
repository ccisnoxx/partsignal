/** 内容任务页串联批准事实、平台规则、异步生成和内容版本入口。 */
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, productsQueryOptions, queryTopicsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { ContentTask, ContentVersion, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { useActiveSection } from '../../shared/hooks/useActiveSection';

const taskSectionIds = ['task-constraints', 'task-generation', 'task-versions'];

export function ContentTasksPage() {
  const { taskId } = useParams();
  return taskId ? <TaskDetail taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get('page');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const tasks = useQuery({ queryKey: queryKeys.contentTasks.all, queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks')), staleTime: QUERY_STALE_TIME.businessList });
  useEffect(() => {
    if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (tasks.data && page > Math.max(1, Math.ceil(tasks.data.items.length / 10)))) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      setSearchParams(next, { replace: true });
    }
  }, [page, rawPage, searchParams, setSearchParams, tasks.data]);
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage));
    setSearchParams(next);
  };
  return <div className="page-stack"><PageHeader eyebrow="内容链路" title="内容任务" description="任务锁定事实版本和平台规则，后续更新不会静默漂移。" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建任务</Button>} />
    <Card className="collection-panel">{tasks.error ? <QueryFailure error={tasks.error} onRetry={() => void tasks.refetch()} /> : <TableRegion label="内容任务列表"><Table<ContentTask> rowKey="id" loading={tasks.isLoading} dataSource={tasks.data?.items} pagination={{ current: page, pageSize: 10, showSizeChanger: false, onChange: setPage }} sticky={{ offsetHeader: 72 }} scroll={{ x: 760 }} columns={[
      { title: '内容角度', dataIndex: 'content_angle', render: (value, row) => <Link to={`/tasks/${row.id}`}><strong>{value}</strong></Link> },
      { title: '目标受众', dataIndex: 'target_audience', width: 220 }, { title: '格式', dataIndex: 'desired_format', width: 160 },
      { title: '长度', width: 110, render: (_, row) => `${row.desired_length_min}–${row.desired_length_max}` },
      { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusTag status={value} /> },
    ]} /></TableRegion>}</Card><TaskCreateModal open={open} onClose={() => setOpen(false)} /></div>;
}

function TaskCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [productId, setProductId] = useState<string>();
  const [form] = Form.useForm<Schema<'ContentTaskCreate'>>();
  const topics = useQuery({ ...queryTopicsQueryOptions(), enabled: open });
  const products = useQuery({ ...productsQueryOptions(), enabled: open });
  const platforms = useQuery({ ...platformProfilesQueryOptions(), enabled: open });
  const facts = useQuery({ queryKey: queryKeys.products.factVersions(productId), queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId ?? '' } } })), enabled: open && !!productId, staleTime: QUERY_STALE_TIME.detail });
  const create = useMutation({ mutationFn: async (body: Schema<'ContentTaskCreate'>) => unwrap(await api.POST('/api/v1/content-tasks', { params: { header: csrfHeader() }, body })), onSuccess: async () => { onClose(); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }); } });
  const dependencyError = topics.error ?? products.error ?? platforms.error ?? facts.error;
  const dependenciesLoading = topics.isLoading || products.isLoading || platforms.isLoading || (!!productId && facts.isLoading);
  return <Modal title="创建内容任务" open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden>{create.error && <Alert role="alert" className="form-alert" type="error" message={errorMessage(create.error)} />}{dependencyError && <QueryFailure error={dependencyError} onRetry={() => { void topics.refetch(); void products.refetch(); void platforms.refetch(); if (productId) void facts.refetch(); }} />}{dependenciesLoading && <QueryLoading label="正在加载任务前置数据" />}<Form<Schema<'ContentTaskCreate'>> form={form} layout="vertical" disabled={!!dependencyError || dependenciesLoading} scrollToFirstError onFinish={(body) => create.mutate(body)}><Space align="start" wrap className="form-grid">
    <Form.Item name="query_topic_id" label="目标问题" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question }))} /></Form.Item>
    <Form.Item name="product_id" label="产品" rules={[{ required: true }]}><Select showSearch onChange={(value) => { setProductId(value); form.setFieldValue('fact_version_id', undefined); }} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></Form.Item>
    <Form.Item name="fact_version_id" label="已批准事实版本" rules={[{ required: true }]}><Select disabled={!productId} options={facts.data?.items.filter((item) => item.status === 'APPROVED').map((item) => ({ value: item.id, label: `V${item.version} · ${item.change_summary}` }))} /></Form.Item>
    <Form.Item name="platform_profile_version_id" label="可用平台" rules={[{ required: true }]}><Select placeholder="仅显示已有有效规则和当前 Prompt 的平台" options={platforms.data?.items.flatMap((item) => item.platform_type_id && item.active_version && item.prompt_configured ? [{ value: item.active_version.id, label: `${item.name} V${item.active_version.version}` }] : [])} /></Form.Item>
  </Space><Form.Item name="target_audience" label="目标受众" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="content_angle" label="内容角度" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="conversion_goal" label="转化目标" rules={[{ required: true }]}><Input /></Form.Item><Space align="start" wrap><Form.Item name="desired_format" label="内容形式" rules={[{ required: true }]}><Input placeholder="例如：参数对比文章" /></Form.Item><Form.Item name="desired_length_min" label="最短字数" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name="desired_length_max" label="最长字数" dependencies={['desired_length_min']} rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Form.Item name="canonical_url" label="官网权威页" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建任务</Button></Form></Modal>;
}

function TaskDetail({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const activeSection = useActiveSection(taskSectionIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [modelId, setModelId] = useState<string>();
  const task = useQuery({ queryKey: queryKeys.contentTasks.detail(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.detail });
  const versions = useQuery({ queryKey: queryKeys.contentTasks.versions(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.detail });
  const jobs = useQuery({ queryKey: queryKeys.contentTasks.jobs(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.workbench, refetchInterval: (query) => query.state.data?.items.some((job) => ['PENDING', 'RUNNING'].includes(job.status)) ? 2000 : false });
  const options = useQuery({ queryKey: queryKeys.contentTasks.options(taskId), queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-options', { params: { path: { content_task_id: taskId } } })), staleTime: QUERY_STALE_TIME.configuration, retry: false });
  const savePrompt = useMutation({ mutationFn: async ({ userPrompt, classification }: { userPrompt: string; classification: Schema<'Confidentiality'> }) => { if (!task.data) throw new Error('任务未加载'); return unwrap(await api.PATCH('/api/v1/content-tasks/{content_task_id}/user-prompt', { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body: { expected_revision: task.data.revision, user_prompt_markdown: userPrompt, generation_data_classification: classification } })); }, onSuccess: async () => { message.success('生成输入已保存'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }); } });
  const createJob = useMutation({ mutationFn: async () => { if (!modelId) throw new Error('请选择模型'); return unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } }, body: { ai_model_id: modelId } })); }, onSuccess: async () => { message.success('生成作业已创建'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }); } });
  const retryJob = useMutation({ mutationFn: async (jobId: string) => unwrap(await api.POST('/api/v1/generation-jobs/{generation_job_id}/retry', { params: { path: { generation_job_id: jobId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } } })), onSuccess: async () => { message.success('已提交原快照重试'); await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }); } });
  const taskCommand = useMutation({ mutationFn: async (body: Schema<'CommandRequest'>) => unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/cancel', { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body })), onSuccess: async () => { setCancelOpen(false); message.success('内容任务已取消'); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }), queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all })]); } });
  const latestJob = jobs.data?.items[0];
  const jobDetail = useQuery({ queryKey: queryKeys.generationJob(latestJob?.id), queryFn: async () => unwrap(await api.GET('/api/v1/generation-jobs/{generation_job_id}', { params: { path: { generation_job_id: latestJob?.id ?? '' } } })), enabled: !!latestJob, staleTime: QUERY_STALE_TIME.detail });
  useEffect(() => {
    if (latestJob?.status === 'SUCCEEDED') void queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) });
  }, [latestJob?.status, taskId]);
  if (task.isLoading) return <QueryLoading label="正在加载内容任务" />;
  if (task.error || !task.data) return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><PageHeader title="内容任务" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} /><QueryFailure error={task.error ?? new Error('内容任务不存在')} onRetry={() => void task.refetch()} /></div>;
  return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><PageHeader eyebrow={`任务 / ${taskId.slice(0, 8)}`} title={task.data.content_angle} description={`${task.data.target_audience} · ${task.data.desired_format}`} breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} actions={<><StatusTag status={task.data.status} />{task.data.available_actions.includes('CANCEL') && <Button danger onClick={() => setCancelOpen(true)}>取消任务</Button>}</>} />
    {(savePrompt.error || createJob.error || retryJob.error || taskCommand.error) && <Alert type="error" message={errorMessage(savePrompt.error ?? createJob.error ?? retryJob.error ?? taskCommand.error)} />}
    <nav className="form-section-nav" aria-label="内容任务章节"><a href="#task-constraints" aria-current={activeSection === 'task-constraints' ? 'location' : undefined}>任务约束</a><a href="#task-generation" aria-current={activeSection === 'task-generation' ? 'location' : undefined}>生成输入</a><a href="#task-versions" aria-current={activeSection === 'task-versions' ? 'location' : undefined}>内容版本</a></nav>
    <section className="task-stage-grid"><Card id="task-constraints" title="01 / 任务约束" className="workspace-panel workspace-section"><Descriptions column={{ xs: 1, md: 2 }} items={[{ label: '事实版本', children: <span className="data-code">{task.data.fact_version_id}</span> }, { label: '锁定平台', children: options.data?.platform_profile_name ?? task.data.platform_profile_version_id }, { label: '平台规则版本', children: <span className="data-code">{task.data.platform_profile_version_id}</span> }, { label: '平台类型', children: task.data.platform_type_snapshot ? String(task.data.platform_type_snapshot.name) : '未归类' }, { label: '转化目标', children: task.data.conversion_goal }, { label: '官网 URL', children: <a href={task.data.canonical_url} target="_blank" rel="noreferrer">{task.data.canonical_url}</a> }]} /></Card>
    <Card id="task-generation" title="02 / 生成输入" className="workspace-panel workspace-section">{options.isLoading ? <QueryLoading label="正在加载生成选项" /> : options.error || !options.data ? <QueryFailure error={options.error ?? new Error('生成选项不存在')} onRetry={() => void options.refetch()} /> : <><Alert type="warning" showIcon message="批准事实优先；只有完整生成输入和全部事实证据均为 PUBLIC 时，才能发送到第三方模型。" /> <PromptEditor key={task.data.revision} initial={task.data.user_prompt_markdown} initialClassification={task.data.generation_data_classification} disabled={task.data.status !== 'OPEN'} loading={savePrompt.isPending} onSave={(userPrompt, classification) => savePrompt.mutate({ userPrompt, classification })} /><Space wrap className="generation-controls"><Select aria-label="生成模型" className="model-select" placeholder="选择已启用且测试通过的模型" value={modelId} onChange={setModelId} options={options.data.models.map((item) => ({ value: item.id, label: `${item.channel_name} / ${item.display_name} (${item.model_id})` }))} /><Button type="primary" icon={<ThunderboltOutlined />} loading={createJob.isPending} disabled={!modelId || task.data.status !== 'OPEN' || task.data.generation_data_classification !== 'PUBLIC'} onClick={() => createJob.mutate()}>生成草稿</Button></Space><Typography.Title level={5}>当前平台 Prompt（只读）</Typography.Title><Input.TextArea aria-label="当前平台 Prompt" rows={8} readOnly value={options.data.system_prompt_markdown} className="markdown-source" /></>}</Card></section>
    <Card title="生成作业" className="workspace-panel">{jobs.isLoading ? <QueryLoading label="正在加载生成作业" /> : jobs.error || !jobs.data ? <QueryFailure error={jobs.error ?? new Error('生成作业列表不存在')} onRetry={() => void jobs.refetch()} /> : latestJob ? <><Alert showIcon type={latestJob.status === 'FAILED' ? 'error' : latestJob.status === 'SUCCEEDED' ? 'success' : 'info'} message={<Space>最新生成作业 <StatusTag status={latestJob.status} /> 第 {latestJob.attempt_count} 次尝试</Space>} description={<Space wrap>{latestJob.error_summary ?? (latestJob.content_version_id ? <Link to={`/content/${latestJob.content_version_id}`}>打开生成的草稿</Link> : '生成服务正在基于已批准事实生成内容。')}{latestJob.status === 'FAILED' && <Button size="small" loading={retryJob.isPending} onClick={() => retryJob.mutate(latestJob.id)}>重试原快照</Button>}<span>请求 ID：{jobDetail.data?.provider_request_id ?? '不可用'}</span><span>耗时：{jobDetail.data?.response_duration_ms ?? '不可用'} ms</span><span>Token 数：{jobDetail.data?.total_tokens ?? '不可用'}</span></Space>} />{jobDetail.isLoading && <QueryLoading label="正在加载作业追溯" />}{jobDetail.error && <QueryFailure error={jobDetail.error} onRetry={() => void jobDetail.refetch()} />}</> : <Typography.Text type="secondary">尚无生成作业。</Typography.Text>}</Card>
    {jobDetail.data && <Card title="最新作业追溯快照"><Descriptions column={1} items={[{ label: '渠道 / 模型', children: `${String(jobDetail.data.input_snapshot.channel.name)} / ${String(jobDetail.data.input_snapshot.model.model_id)}` }, { label: '请求参数', children: <pre>{JSON.stringify(jobDetail.data.input_snapshot.model.request_parameters, null, 2)}</pre> }, { label: '系统消息（System Message）', children: <Input.TextArea aria-label="系统消息（System Message）" rows={8} readOnly value={jobDetail.data.input_snapshot.system_message} /> }, { label: '用户消息（User Message）', children: <Input.TextArea aria-label="用户消息（User Message）" rows={10} readOnly value={jobDetail.data.input_snapshot.user_message} /> }]} /></Card>}
    <Card id="task-versions" title="03 / 内容版本" className="workspace-section">{versions.isLoading ? <QueryLoading label="正在加载内容版本" /> : versions.error || !versions.data ? <QueryFailure error={versions.error ?? new Error('内容版本列表不存在')} onRetry={() => void versions.refetch()} /> : <TableRegion label="内容版本列表"><Table<ContentVersion> rowKey="id" dataSource={versions.data.items} scroll={{ x: 720 }} columns={[{ title: '版本', dataIndex: 'version', render: (v, row) => <Link className="data-code" to={`/content/${row.id}`}>V{v}</Link> }, { title: '标题', dataIndex: 'title' }, { title: '来源', dataIndex: 'source_type', render: (value) => <StatusTag status={value} /> }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> }, { title: '质量问题', dataIndex: 'quality_issues', render: (issues: Schema<'QualityIssue'>[]) => issues.length }]} /></TableRegion>}</Card>
    <Modal title="取消任务" open={cancelOpen} onCancel={() => setCancelOpen(false)} footer={null} destroyOnHidden><Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: task.data?.revision, comment: '' }} onFinish={(body) => taskCommand.mutate(body)}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="说明"><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit">确认取消</Button></Form></Modal>
  </div>;
}

function PromptEditor({ initial, initialClassification, disabled, loading, onSave }: { initial: string; initialClassification: Schema<'Confidentiality'> | null; disabled: boolean; loading: boolean; onSave: (value: string, classification: Schema<'Confidentiality'>) => void }) {
  const [value, setValue] = useState(initial);
  const [classification, setClassification] = useState<Schema<'Confidentiality'> | undefined>(initialClassification ?? undefined);
  return <><Form.Item label="完整生成输入数据分级" required><Select aria-label="完整生成输入数据分级" value={classification} placeholder="请选择本次 Prompt、任务要求和批准事实的最高分级" onChange={setClassification} options={[{ value: 'PUBLIC', label: 'PUBLIC · 可发送第三方模型' }, { value: 'INTERNAL', label: 'INTERNAL · 禁止发送第三方模型' }, { value: 'RESTRICTED', label: 'RESTRICTED · 禁止发送第三方模型' }]} /></Form.Item><Form.Item label="工程师 user_prompt Markdown"><Input.TextArea aria-label="工程师 user_prompt Markdown" rows={12} className="markdown-source" value={value} onChange={(event) => setValue(event.target.value)} /></Form.Item><Button onClick={() => classification && onSave(value, classification)} loading={loading} disabled={disabled || !classification}>保存 Prompt 与分级</Button></>;
}
