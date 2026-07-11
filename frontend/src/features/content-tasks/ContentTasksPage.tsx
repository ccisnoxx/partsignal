/** 内容任务页串联批准事实、平台规则、异步生成和内容版本入口。 */
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import type { ContentTask, ContentVersion, Schema } from '../../shared/api/types';
import { StatusTag } from '../../shared/components/StatusTag';

export function ContentTasksPage() {
  const { taskId } = useParams();
  return taskId ? <TaskDetail taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  const [open, setOpen] = useState(false);
  const tasks = useQuery({ queryKey: ['content-tasks'], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks')) });
  return <div className="page-stack"><header className="page-heading"><div><Typography.Text className="eyebrow">CONTENT PIPELINE</Typography.Text><Typography.Title>内容任务</Typography.Title><Typography.Paragraph>任务锁定事实版本和平台规则，后续更新不会静默漂移。</Typography.Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建任务</Button></header>
    <Card>{tasks.error && <Alert type="error" message={errorMessage(tasks.error)} />}<Table<ContentTask> rowKey="id" loading={tasks.isLoading} dataSource={tasks.data?.items} columns={[
      { title: '内容角度', dataIndex: 'content_angle', render: (value, row) => <Link to={`/tasks/${row.id}`}><strong>{value}</strong></Link> },
      { title: '目标受众', dataIndex: 'target_audience' }, { title: '格式', dataIndex: 'desired_format' },
      { title: '长度', render: (_, row) => `${row.desired_length_min}–${row.desired_length_max}` },
      { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> },
    ]} /></Card><TaskCreateModal open={open} onClose={() => setOpen(false)} /></div>;
}

function TaskCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [productId, setProductId] = useState<string>();
  const [form] = Form.useForm<Schema<'ContentTaskCreate'>>();
  const topics = useQuery({ queryKey: ['query-topics'], queryFn: async () => unwrap(await api.GET('/api/v1/query-topics')), enabled: open });
  const products = useQuery({ queryKey: ['products'], queryFn: async () => unwrap(await api.GET('/api/v1/products', { params: { query: { page: 1, page_size: 100 } } })), enabled: open });
  const platforms = useQuery({ queryKey: ['platform-profiles'], queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles')), enabled: open });
  const facts = useQuery({ queryKey: ['fact-versions', productId], queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId ?? '' } } })), enabled: open && !!productId });
  const create = useMutation({ mutationFn: async (body: Schema<'ContentTaskCreate'>) => unwrap(await api.POST('/api/v1/content-tasks', { params: { header: csrfHeader() }, body })), onSuccess: async () => { onClose(); await queryClient.invalidateQueries({ queryKey: ['content-tasks'] }); } });
  return <Modal title="创建内容任务" open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden>{create.error && <Alert className="form-alert" type="error" message={errorMessage(create.error)} />}<Form<Schema<'ContentTaskCreate'>> form={form} layout="vertical" onFinish={(body) => create.mutate(body)}><Space align="start" wrap>
    <Form.Item name="query_topic_id" label="目标问题" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={topics.data?.items.map((item) => ({ value: item.id, label: item.canonical_question }))} /></Form.Item>
    <Form.Item name="product_id" label="产品" rules={[{ required: true }]}><Select showSearch onChange={(value) => { setProductId(value); form.setFieldValue('fact_version_id', undefined); }} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} /></Form.Item>
    <Form.Item name="fact_version_id" label="已批准事实版本" rules={[{ required: true }]}><Select disabled={!productId} options={facts.data?.items.filter((item) => item.status === 'APPROVED').map((item) => ({ value: item.id, label: `V${item.version} · ${item.change_summary}` }))} /></Form.Item>
    <Form.Item name="platform_profile_version_id" label="平台规则版本" rules={[{ required: true }]}><Select options={platforms.data?.items.filter((item) => item.platform_type_id).map((item) => ({ value: item.active_version.id, label: `${item.name} V${item.active_version.version}` }))} /></Form.Item>
  </Space><Form.Item name="target_audience" label="目标受众" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="content_angle" label="内容角度" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="conversion_goal" label="转化目标" rules={[{ required: true }]}><Input /></Form.Item><Space align="start" wrap><Form.Item name="desired_format" label="内容形式" rules={[{ required: true }]}><Input placeholder="例如：参数对比文章" /></Form.Item><Form.Item name="desired_length_min" label="最短字数" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item><Form.Item name="desired_length_max" label="最长字数" dependencies={['desired_length_min']} rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Space><Form.Item name="canonical_url" label="官网权威页" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>创建任务</Button></Form></Modal>;
}

function TaskDetail({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const [command, setCommand] = useState<'complete' | 'cancel' | null>(null);
  const [modelId, setModelId] = useState<string>();
  const task = useQuery({ queryKey: ['content-task', taskId], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}', { params: { path: { content_task_id: taskId } } })) });
  const versions = useQuery({ queryKey: ['content-versions', taskId], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', { params: { path: { content_task_id: taskId } } })) });
  const jobs = useQuery({ queryKey: ['generation-jobs', taskId], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId } } })), refetchInterval: (query) => query.state.data?.items.some((job) => ['PENDING', 'RUNNING'].includes(job.status)) ? 2000 : false });
  const options = useQuery({ queryKey: ['generation-options', taskId], queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-options', { params: { path: { content_task_id: taskId } } })), retry: false });
  const savePrompt = useMutation({ mutationFn: async (userPrompt: string) => { if (!task.data) throw new Error('任务未加载'); return unwrap(await api.PATCH('/api/v1/content-tasks/{content_task_id}/user-prompt', { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body: { expected_revision: task.data.revision, user_prompt_markdown: userPrompt } })); }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['content-task', taskId] }) });
  const createJob = useMutation({ mutationFn: async () => { if (!modelId) throw new Error('请选择模型'); return unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } }, body: { ai_model_id: modelId } })); }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['generation-jobs', taskId] }) });
  const retryJob = useMutation({ mutationFn: async (jobId: string) => unwrap(await api.POST('/api/v1/generation-jobs/{generation_job_id}/retry', { params: { path: { generation_job_id: jobId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } } })), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['generation-jobs', taskId] }) });
  const taskCommand = useMutation({ mutationFn: async (body: Schema<'CommandRequest'>) => { if (!command) throw new Error('未选择任务操作'); const path = command === 'complete' ? '/api/v1/content-tasks/{content_task_id}/complete' as const : '/api/v1/content-tasks/{content_task_id}/cancel' as const; return unwrap(await api.POST(path, { params: { path: { content_task_id: taskId }, header: csrfHeader() }, body })); }, onSuccess: async () => { setCommand(null); await queryClient.invalidateQueries({ queryKey: ['content-task', taskId] }); } });
  const latestJob = jobs.data?.items[0];
  const jobDetail = useQuery({ queryKey: ['generation-job', latestJob?.id], queryFn: async () => unwrap(await api.GET('/api/v1/generation-jobs/{generation_job_id}', { params: { path: { generation_job_id: latestJob?.id ?? '' } } })), enabled: !!latestJob });
  useEffect(() => {
    if (latestJob?.status === 'SUCCEEDED') void queryClient.invalidateQueries({ queryKey: ['content-versions', taskId] });
  }, [latestJob?.status, taskId]);
  return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><header className="page-heading"><div><Typography.Text className="eyebrow">TASK / {taskId.slice(0, 8)}</Typography.Text><Typography.Title>{task.data?.content_angle ?? '内容任务'}</Typography.Title><Typography.Paragraph>{task.data?.target_audience} · {task.data?.desired_format}</Typography.Paragraph></div><Space><StatusTag status={task.data?.status ?? ''} />{task.data?.status === 'OPEN' && <><Button onClick={() => setCommand('complete')}>完成任务</Button><Button danger onClick={() => setCommand('cancel')}>取消任务</Button></>}</Space></header>
    {(task.error || versions.error || jobs.error || options.error || savePrompt.error || createJob.error || retryJob.error || taskCommand.error) && <Alert type="error" message={errorMessage(task.error ?? versions.error ?? jobs.error ?? options.error ?? savePrompt.error ?? createJob.error ?? retryJob.error ?? taskCommand.error)} />}
    <Card title="任务约束"><Descriptions column={{ xs: 1, md: 2 }} items={task.data ? [{ label: '事实版本', children: task.data.fact_version_id }, { label: '锁定平台', children: options.data?.platform_profile_name ?? task.data.platform_profile_version_id }, { label: '平台规则版本', children: task.data.platform_profile_version_id }, { label: '平台类型', children: task.data.platform_type_snapshot ? String(task.data.platform_type_snapshot.name) : '未归类' }, { label: '转化目标', children: task.data.conversion_goal }, { label: '官网 URL', children: <a href={task.data.canonical_url} target="_blank" rel="noreferrer">{task.data.canonical_url}</a> }] : []} /></Card>
    <Card title="生成输入"><Alert type="warning" showIcon message="批准事实优先；自由技术描述仍需工程师人工核对，系统不自动判断全部语义冲突。" />{task.data && <PromptEditor key={task.data.revision} initial={task.data.user_prompt_markdown} disabled={task.data.status !== 'OPEN'} loading={savePrompt.isPending} onSave={(value) => savePrompt.mutate(value)} />}<Space><Select style={{ width: 360 }} placeholder="选择已启用且测试通过的模型" value={modelId} onChange={setModelId} options={options.data?.models.map((item) => ({ value: item.id, label: `${item.channel_name} / ${item.display_name} (${item.model_id})` }))} /><Button type="primary" icon={<ThunderboltOutlined />} loading={createJob.isPending} disabled={!modelId || task.data?.status !== 'OPEN'} onClick={() => createJob.mutate()}>生成草稿</Button></Space><Typography.Title level={5}>当前平台 Prompt（只读）</Typography.Title><Input.TextArea rows={8} readOnly value={options.data?.system_prompt_markdown ?? ''} /></Card>
    {latestJob && <Alert showIcon type={latestJob.status === 'FAILED' ? 'error' : latestJob.status === 'SUCCEEDED' ? 'success' : 'info'} message={<Space>最新生成作业 <StatusTag status={latestJob.status} /> 第 {latestJob.attempt_count} 次尝试</Space>} description={<Space wrap>{latestJob.error_summary ?? (latestJob.content_version_id ? <Link to={`/content/${latestJob.content_version_id}`}>打开生成的草稿</Link> : 'Worker 正在基于已批准事实生成内容。')}{latestJob.status === 'FAILED' && <Button size="small" loading={retryJob.isPending} onClick={() => retryJob.mutate(latestJob.id)}>重试原快照</Button>}<span>请求 ID：{jobDetail.data?.provider_request_id ?? '不可用'}</span><span>耗时：{jobDetail.data?.response_duration_ms ?? '不可用'} ms</span><span>Tokens：{jobDetail.data?.total_tokens ?? '不可用'}</span></Space>} />}
    {jobDetail.data && <Card title="最新作业追溯快照"><Descriptions column={1} items={[{ label: '渠道 / 模型', children: `${String(jobDetail.data.input_snapshot.channel.name)} / ${String(jobDetail.data.input_snapshot.model.model_id)}` }, { label: '请求参数', children: <pre>{JSON.stringify(jobDetail.data.input_snapshot.model.request_parameters, null, 2)}</pre> }, { label: 'System Message', children: <Input.TextArea rows={8} readOnly value={jobDetail.data.input_snapshot.system_message} /> }, { label: 'User Message', children: <Input.TextArea rows={10} readOnly value={jobDetail.data.input_snapshot.user_message} /> }]} /></Card>}
    <Card title="内容版本"><Table<ContentVersion> rowKey="id" loading={versions.isLoading} dataSource={versions.data?.items} columns={[{ title: '版本', dataIndex: 'version', render: (v, row) => <Link to={`/content/${row.id}`}>V{v}</Link> }, { title: '标题', dataIndex: 'title' }, { title: '来源', dataIndex: 'source_type' }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> }, { title: '质量问题', dataIndex: 'quality_issues', render: (issues: Schema<'QualityIssue'>[]) => issues.length }]} /></Card>
    <Modal title={command === 'complete' ? '完成任务' : '取消任务'} open={!!command} onCancel={() => setCommand(null)} footer={null} destroyOnHidden><Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: task.data?.revision, comment: '' }} onFinish={(body) => taskCommand.mutate(body)}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="说明"><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit">确认</Button></Form></Modal>
  </div>;
}

function PromptEditor({ initial, disabled, loading, onSave }: { initial: string; disabled: boolean; loading: boolean; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <><Form.Item label="工程师 user_prompt Markdown"><Input.TextArea rows={12} className="markdown-source" value={value} onChange={(event) => setValue(event.target.value)} /></Form.Item><Button onClick={() => onSave(value)} loading={loading} disabled={disabled}>保存 Prompt</Button></>;
}
