/** 产品事实工作区：维护唯一 Markdown 正文、数据分级和不可变审核版本。 */
import { ArrowLeftOutlined, DownOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FactVersion, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { renderSanitizedMarkdown } from '../../shared/markdown';
import { useAuth } from '../auth/AuthProvider';

const classificationOptions: Array<{ label: string; value: Schema<'Confidentiality'> }> = [
  { label: 'PUBLIC · 可发送第三方模型', value: 'PUBLIC' },
  { label: 'INTERNAL · 禁止发送第三方模型', value: 'INTERNAL' },
  { label: 'RESTRICTED · 禁止发送第三方模型', value: 'RESTRICTED' },
];

function MarkdownPreview({ markdown, label }: { markdown: string; label: string }) {
  const safeHtml = useMemo(
    () => renderSanitizedMarkdown(markdown),
    [markdown],
  );
  return <article aria-label={label} className="markdown-preview" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

export function ProductFactsPage() {
  const auth = useAuth();
  const { message } = App.useApp();
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [snapshotTarget, setSnapshotTarget] = useState<FactVersion>();
  const [reviewTarget, setReviewTarget] = useState<FactVersion>();
  const [commandTarget, setCommandTarget] = useState<{ version: FactVersion; command: 'submit' | 'approve' | 'request-changes' | 'retire' } | null>(null);
  const [activeTab, setActiveTab] = useState('workspace');
  const [factsDirty, setFactsDirty] = useState(false);
  const [factsFormKey, setFactsFormKey] = useState(0);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const createVersionErrorRef = useRef<HTMLDivElement>(null);
  const commandErrorRef = useRef<HTMLDivElement>(null);
  const [modal, modalContext] = Modal.useModal();

  const product = useQuery({
    queryKey: queryKeys.products.detail(productId),
    queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}', { params: { path: { product_id: productId } } })),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const draft = useQuery({
    queryKey: queryKeys.products.draft(productId),
    queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/facts', { params: { path: { product_id: productId } } })),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const versions = useQuery({
    queryKey: queryKeys.products.factVersions(productId),
    queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId } } })),
    staleTime: QUERY_STALE_TIME.detail,
  });
  const reviewContext = useQuery({
    queryKey: queryKeys.products.factReview(reviewTarget?.id),
    queryFn: async () => unwrap(await api.GET('/api/v1/fact-versions/{fact_version_id}/review-context', { params: { path: { fact_version_id: reviewTarget!.id } } })),
    enabled: !!reviewTarget,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const save = useMutation({
    mutationFn: async (values: Schema<'ProductFactsDraftUpdate'>) => unwrap(await api.PUT('/api/v1/products/{product_id}/facts', {
      params: { path: { product_id: productId }, header: csrfHeader() },
      body: values,
    })),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.products.draft(productId), saved);
      message.success('事实工作区已保存');
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.draft(productId) });
    },
  });
  const createVersion = useMutation({
    mutationFn: async (body: Schema<'CreateVersionRequest'>) => unwrap(await api.POST('/api/v1/products/{product_id}/fact-versions', {
      params: { path: { product_id: productId }, header: csrfHeader() },
      body,
    })),
    onSuccess: async () => {
      setCreateVersionOpen(false);
      message.success('不可变事实版本已创建');
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) });
    },
  });
  const command = useMutation({
    mutationFn: async ({ target, body }: { target: NonNullable<typeof commandTarget>; body: Schema<'CommandRequest'> }) => {
      const path = target.command === 'submit' ? '/api/v1/fact-versions/{fact_version_id}/submit' as const
        : target.command === 'approve' ? '/api/v1/fact-versions/{fact_version_id}/approve' as const
        : target.command === 'request-changes' ? '/api/v1/fact-versions/{fact_version_id}/request-changes' as const
        : '/api/v1/fact-versions/{fact_version_id}/retire' as const;
      return unwrap(await api.POST(path, {
        params: { path: { fact_version_id: target.version.id }, header: csrfHeader() },
        body,
      }));
    },
    onSuccess: async () => {
      const targetId = commandTarget?.version.id;
      setCommandTarget(null);
      message.success('事实版本状态已更新');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.products.factReview(targetId) }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: async (version: FactVersion) => ensureSuccess(await api.DELETE('/api/v1/fact-versions/{fact_version_id}', {
      params: { path: { fact_version_id: version.id }, header: csrfHeader() },
    })),
    onSuccess: async () => {
      message.success('事实版本已删除');
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) });
    },
  });

  useEffect(() => {
    if (save.error) saveErrorRef.current?.focus();
    else if (createVersion.error) createVersionErrorRef.current?.focus();
    else if (command.error) commandErrorRef.current?.focus();
  }, [command.error, createVersion.error, save.error]);
  useEffect(() => {
    if (!factsDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [factsDirty]);

  const confirmDeleteVersion = (version: FactVersion) => modal.confirm({
    title: `物理删除事实版本 V${version.version}？`,
    content: '该版本及其审核记录会一并删除；存在内容任务或内容版本引用时服务端会拒绝。此操作不可恢复。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => remove.mutate(version),
  });
  const discardFactsChanges = () => {
    setFactsDirty(false);
    setFactsFormKey((current) => current + 1);
  };
  const confirmDiscardFacts = (onDiscard: () => void) => {
    if (!factsDirty) {
      onDiscard();
      return;
    }
    modal.confirm({
      title: '放弃未保存的事实修改？',
      content: '离开事实工作区后，本次尚未保存的 Markdown 和分级修改不会保留。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        discardFactsChanges();
        onDiscard();
      },
    });
  };
  const handleBack = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!factsDirty) return;
    event.preventDefault();
    confirmDiscardFacts(() => navigate('/products'));
  };

  if (product.isLoading || draft.isLoading) {
    return <div className="page-stack product-facts-page"><PageHeader title="产品事实工作区" breadcrumbs={[{ title: <Link to="/products">产品事实</Link> }, { title: '事实工作区' }]} /><QueryLoading /></div>;
  }
  if (product.error || draft.error || !product.data || !draft.data) {
    return <div className="page-stack product-facts-page"><Link className="back-link" to="/products"><ArrowLeftOutlined /> 返回产品列表</Link><PageHeader title="产品事实工作区" breadcrumbs={[{ title: <Link to="/products">产品事实</Link> }, { title: '事实工作区' }]} /><QueryFailure error={product.error ?? draft.error ?? new Error('产品事实工作区不存在')} onRetry={() => { void product.refetch(); void draft.refetch(); }} /></div>;
  }

  return (
    <div className="page-stack product-facts-page">
      {modalContext}
      <Link className="back-link" to="/products" onClick={handleBack}><ArrowLeftOutlined /> 返回产品列表</Link>
      <PageHeader
        eyebrow="产品事实工作区"
        title={<span className="data-code">{product.data.part_number}</span>}
        description={`${product.data.brand} · ${product.data.category} · 工作区修订 ${draft.data.revision}`}
        breadcrumbs={[{ title: <Link to="/products" onClick={handleBack}>产品事实</Link> }, { title: product.data.part_number }]}
        actions={<StatusTag status={product.data.status} />}
      />
      <div ref={saveErrorRef} tabIndex={-1}>{save.error && <Alert role="alert" type="error" showIcon title={errorMessage(save.error)} />}</div>
      {remove.error && <DeletionError error={remove.error} />}
      <Tabs activeKey={activeTab} onChange={(key) => confirmDiscardFacts(() => setActiveTab(key))} items={[
        {
          key: 'workspace',
          label: '事实工作区',
          children: <FactsForm
            key={factsFormKey}
            draft={draft.data}
            saving={save.isPending}
            onDirtyChange={setFactsDirty}
            onSave={(values) => save.mutateAsync(values)}
          />,
        },
        {
          key: 'versions',
          label: `事实版本（${versions.data?.items.length ?? 0}）`,
          children: <Card extra={<Button type="primary" onClick={() => setCreateVersionOpen(true)}>创建不可变版本</Button>}>
            {versions.isLoading ? <QueryLoading label="正在加载事实版本" />
              : versions.error || !versions.data ? <QueryFailure error={versions.error ?? new Error('事实版本列表不存在')} onRetry={() => void versions.refetch()} />
                : <TableRegion label="事实版本列表"><Table<FactVersion>
                  rowKey="id"
                  dataSource={versions.data.items}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: '版本', dataIndex: 'version', width: 90, render: (value) => `V${value}` },
                    { title: '状态', dataIndex: 'status', width: 130, render: (value) => <StatusTag status={value} /> },
                    { title: '数据分级', dataIndex: 'classification', width: 120, render: (value) => <StatusTag status={value} /> },
                    { title: '变更说明', dataIndex: 'change_summary' },
                    { title: '创建时间', dataIndex: 'created_at', width: 180, render: (value) => new Date(value).toLocaleString('zh-CN') },
                    { title: '操作', width: 220, fixed: 'right', render: (_, version) => <Space wrap>
                      <Button size="small" type="primary" onClick={() => setReviewTarget(version)}>审核与历史</Button>
                      <Dropdown trigger={['click']} menu={{
                        items: [
                          { key: 'snapshot', label: '查看冻结正文' },
                          ...(auth.isAdmin ? [{ key: 'delete', label: '删除', danger: true }] : []),
                        ],
                        onClick: ({ key }) => key === 'snapshot' ? setSnapshotTarget(version) : confirmDeleteVersion(version),
                      }}>
                        <Button size="small" aria-label={`更多操作：事实版本 V${version.version}`} loading={remove.isPending && remove.variables?.id === version.id}>更多 <DownOutlined /></Button>
                      </Dropdown>
                    </Space> },
                  ]}
                /></TableRegion>}
          </Card>,
        },
      ]} />
      <Modal title="创建不可变事实版本" open={createVersionOpen} footer={null} onCancel={() => setCreateVersionOpen(false)} destroyOnHidden>
        <div ref={createVersionErrorRef} tabIndex={-1}>{createVersion.error && <Alert role="alert" type="error" showIcon title={errorMessage(createVersion.error)} />}</div>
        <Form<Schema<'CreateVersionRequest'>>
          layout="vertical"
          disabled={createVersion.isPending}
          scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
          onFinish={(body) => createVersion.mutate(body)}
        >
          <Alert type="info" showIcon title="版本会冻结当前已保存的 Markdown 原文和数据分级，后续工作区修改不会改写它。" />
          <Form.Item name="change_summary" label="变更说明" rules={[{ required: true, whitespace: true, message: '请填写变更说明' }]}><Input.TextArea rows={3} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={createVersion.isPending}>创建版本</Button>
        </Form>
      </Modal>
      <Modal title={`事实版本 V${snapshotTarget?.version ?? ''}`} open={!!snapshotTarget} footer={null} onCancel={() => setSnapshotTarget(undefined)} width={900}><FactSnapshot version={snapshotTarget} /></Modal>
      <Modal title={`事实审核 V${reviewTarget?.version ?? ''}`} open={!!reviewTarget} footer={null} onCancel={() => setReviewTarget(undefined)} width={960}>
        {reviewContext.isLoading && <QueryLoading />}
        {reviewContext.error && <Alert type="error" message={errorMessage(reviewContext.error)} />}
        {reviewContext.data && <FactReviewPanel context={reviewContext.data} onAction={(action) => {
          const commandName = action === 'SUBMIT' ? 'submit' : action === 'APPROVE' ? 'approve' : action === 'REQUEST_CHANGES' ? 'request-changes' : 'retire';
          setCommandTarget({ version: reviewContext.data.fact_version, command: commandName });
        }} />}
      </Modal>
      <Modal title="确认状态操作" open={!!commandTarget} footer={null} onCancel={() => setCommandTarget(null)} width={commandTarget?.command === 'approve' ? 900 : undefined} destroyOnHidden>
        <div ref={commandErrorRef} tabIndex={-1}>{command.error && <Alert role="alert" type="error" showIcon title={errorMessage(command.error)} />}</div>
        {commandTarget?.command === 'approve' && <><Alert type="warning" showIcon title="请显式确认：批准依据是下方不可变 Markdown 与分级，而不是当前工作区。" /><FactSnapshot version={commandTarget.version} /></>}
        <Form<Schema<'CommandRequest'>>
          layout="vertical"
          disabled={command.isPending}
          initialValues={{ expected_revision: commandTarget?.version.revision, comment: '' }}
          scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
          onFinish={(body) => commandTarget && command.mutate({ target: commandTarget, body })}
        >
          <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
          <Form.Item name="comment" label="审核意见" rules={commandTarget?.command === 'request-changes' ? [{ required: true, whitespace: true, message: '退回必须填写意见' }] : []}><Input.TextArea rows={3} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={command.isPending}>{commandTarget?.command === 'approve' ? '确认批准' : '确认'}</Button>
        </Form>
      </Modal>
    </div>
  );
}

function FactSnapshot({ version }: { version?: FactVersion }) {
  if (!version) return null;
  return <Card size="small" title={`V${version.version} · ${version.change_summary}`} className="section-card">
    <Descriptions size="small" column={1} items={[
      { label: '状态', children: <StatusTag status={version.status} /> },
      { label: '数据分级', children: <StatusTag status={version.classification} /> },
      { label: '修订号', children: version.revision },
    ]} />
    <Tabs items={[
      { key: 'preview', label: '安全预览', children: <MarkdownPreview markdown={version.body_markdown} label={`事实版本 V${version.version} Markdown 预览`} /> },
      { key: 'source', label: 'Markdown 原文', children: <Input.TextArea aria-label={`事实版本 V${version.version} Markdown 原文`} rows={20} readOnly value={version.body_markdown} className="markdown-source" /> },
    ]} />
  </Card>;
}

function FactReviewPanel({ context, onAction }: { context: Schema<'FactReviewContext'>; onAction: (action: Schema<'FactReviewAction'>) => void }) {
  return <Space orientation="vertical" size="large" style={{ width: '100%' }}>
    <Descriptions column={1} items={[
      { label: '状态', children: <StatusTag status={context.fact_version.status} /> },
      { label: '数据分级', children: <StatusTag status={context.fact_version.classification} /> },
      { label: '变更说明', children: context.fact_version.change_summary },
      { label: '事实版本 ID', children: <span className="data-code">{context.fact_version.id}</span> },
    ]} />
    <Card size="small" title="冻结事实 Markdown"><MarkdownPreview markdown={context.fact_version.body_markdown} label="冻结事实 Markdown 预览" /></Card>
    <Card size="small" title="追加式审核历史"><Timeline items={context.review_history.map((item) => ({
      content: <><Space><StatusTag status={item.action} /><strong>{item.actor.display_name}</strong><Typography.Text type="secondary">V{item.target_version}</Typography.Text></Space><Typography.Paragraph>{item.comment || '未填写意见'}</Typography.Paragraph><Typography.Text type="secondary">{new Date(item.created_at).toLocaleString('zh-CN')}</Typography.Text></>,
    }))} /></Card>
    <Space wrap>{context.available_actions.map((action) => <Button key={action} type={action === 'APPROVE' ? 'primary' : 'default'} danger={action === 'REQUEST_CHANGES'} onClick={() => onAction(action)}>{action === 'SUBMIT' ? '提交审核' : action === 'APPROVE' ? '批准' : action === 'REQUEST_CHANGES' ? '退回修改' : '停用'}</Button>)}</Space>
  </Space>;
}

function FactsForm({
  draft,
  saving,
  onDirtyChange,
  onSave,
}: {
  draft: Schema<'ProductFactsDraft'>;
  saving: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (value: Schema<'ProductFactsDraftUpdate'>) => Promise<Schema<'ProductFactsDraft'>>;
}) {
  const [form] = Form.useForm<Schema<'ProductFactsDraftUpdate'>>();
  const [saveState, setSaveState] = useState<'pristine' | 'dirty' | 'saving' | 'saved' | 'failed'>('pristine');
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const bodyMarkdown = Form.useWatch('body_markdown', form) ?? draft.body_markdown;
  const handleSave = async (values: Schema<'ProductFactsDraftUpdate'>) => {
    setSaveState('saving');
    try {
      const saved = await onSave(values);
      form.setFieldsValue({
        expected_revision: saved.revision,
        body_markdown: saved.body_markdown,
        classification: saved.classification,
      });
      setSaveState('saved');
      onDirtyChange(false);
    } catch {
      setSaveState('failed');
    }
  };
  const statusText = saving || saveState === 'saving' ? '保存中'
    : saveState === 'dirty' ? '有未保存修改'
      : saveState === 'saved' ? '已保存'
        : saveState === 'failed' ? '保存失败'
          : '未修改';

  return <Form<Schema<'ProductFactsDraftUpdate'>>
    form={form}
    className="facts-form"
    layout="vertical"
    initialValues={{ expected_revision: draft.revision, body_markdown: draft.body_markdown, classification: draft.classification }}
    scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
    onValuesChange={() => {
      setSaveState('dirty');
      onDirtyChange(true);
    }}
    onFinish={handleSave}
    onFinishFailed={() => setSaveState('failed')}
  >
    <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
    <Alert type="info" showIcon title="Markdown 是产品事实唯一可编辑正文源；保存使用当前修订号防止并发覆盖。" />
    <div className="revision-metadata-grid">
      <Form.Item name="classification" label="数据分级" rules={[{ required: true, message: '请选择数据分级' }]}>
        <Select options={classificationOptions} />
      </Form.Item>
    </div>
    <Tabs
      activeKey={view}
      onChange={(key) => setView(key as 'edit' | 'preview')}
      items={[
        { key: 'edit', label: '编辑 Markdown' },
        { key: 'preview', label: '安全预览' },
      ]}
    />
    <div hidden={view !== 'edit'}>
      <Form.Item name="body_markdown" label="事实 Markdown" rules={[{ required: true, whitespace: true, message: '请输入非空事实 Markdown' }]}>
        <Input.TextArea rows={28} className="markdown-source revision-markdown-source" />
      </Form.Item>
    </div>
    <section hidden={view !== 'preview'} aria-label="事实 Markdown 安全预览">
      <MarkdownPreview markdown={bodyMarkdown} label="事实 Markdown 安全预览正文" />
    </section>
    <div className="form-save-bar">
      <div className="form-save-feedback">
        <Typography.Text aria-live="polite" strong>{statusText}</Typography.Text>
        <Typography.Text type="secondary">保存只更新工作区，不会修改任何已创建或已批准的事实版本。</Typography.Text>
      </div>
      <Button type="primary" htmlType="submit" size="large" loading={saving} disabled={saveState !== 'dirty' && saveState !== 'failed'}>保存事实工作区</Button>
    </div>
  </Form>;
}
