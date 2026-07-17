/** 产品事实工作区：维护证据化事实、创建不可变快照并执行人工审核。 */
import { DeleteOutlined, DownOutlined, ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Descriptions, Divider, Dropdown, Form, Input, InputNumber, List, Modal, Select, Space, Table, Tabs, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import type { FactVersion, Schema } from '../../shared/api/types';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { PageHeader } from '../../shared/components/PageHeader';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableRegion } from '../../shared/components/TableRegion';
import { evidenceTypeLabel, evidenceTypeOptions } from '../../shared/components/enumLabels';
import { useActiveSection } from '../../shared/hooks/useActiveSection';
import { useAuth } from '../auth/AuthProvider';

const replacementOptions: Array<{ label: string; value: Schema<'ReplacementLevel'> }> = [
  { label: '功能相近', value: 'FUNCTIONALLY_SIMILAR' }, { label: '参数兼容', value: 'PARAMETER_COMPATIBLE' },
  { label: '引脚兼容', value: 'PIN_COMPATIBLE' }, { label: 'Pin-to-Pin', value: 'PIN_TO_PIN' },
  { label: '样板验证', value: 'PROTOTYPE_VALIDATED' }, { label: '温度验证', value: 'TEMPERATURE_VALIDATED' },
  { label: '量产验证', value: 'MASS_PRODUCTION_VALIDATED' },
];

const confidentialityOptions: Array<{ label: string; value: Schema<'Confidentiality'> }> = [
  { label: '公开', value: 'PUBLIC' }, { label: '内部', value: 'INTERNAL' }, { label: '受限', value: 'RESTRICTED' },
];
const parameterValueOptions: Array<{ label: string; value: Schema<'ParameterValueType'> }> = [
  { label: '数值', value: 'NUMERIC' }, { label: '范围', value: 'RANGE' }, { label: '文本', value: 'TEXT' },
];
const claimTypeOptions: Array<{ label: string; value: Schema<'ClaimType'> }> = [
  { label: '允许声明', value: 'APPROVED' }, { label: '禁止声明', value: 'PROHIBITED' },
  { label: '必须披露', value: 'REQUIRED_DISCLOSURE' },
];
const factSectionIds = ['reference-parts', 'evidences', 'parameters', 'relations', 'claims'];
const factSectionByField: Record<string, string> = {
  reference_parts: 'reference-parts',
  evidences: 'evidences',
  parameters: 'parameters',
  replacement_relations: 'relations',
  claims: 'claims',
};
type FormNamePath = string | number | Array<string | number>;

export function ProductFactsPage() {
  const canEdit = true;
  const auth = useAuth();
  const { message } = App.useApp();
  const { productId = '' } = useParams();
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotTarget, setSnapshotTarget] = useState<FactVersion>();
  const [reviewTarget, setReviewTarget] = useState<FactVersion>();
  const [commandTarget, setCommandTarget] = useState<{ version: FactVersion; command: 'submit' | 'approve' | 'request-changes' | 'retire' } | null>(null);
  const [modal, modalContext] = Modal.useModal();
  const product = useQuery({ queryKey: queryKeys.products.detail(productId), queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}', { params: { path: { product_id: productId } } })), staleTime: QUERY_STALE_TIME.detail });
  const draft = useQuery({ queryKey: queryKeys.products.draft(productId), queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/facts', { params: { path: { product_id: productId } } })), staleTime: QUERY_STALE_TIME.detail });
  const versions = useQuery({ queryKey: queryKeys.products.factVersions(productId), queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId } } })), staleTime: QUERY_STALE_TIME.detail });
  const reviewContext = useQuery({ queryKey: queryKeys.products.factReview(reviewTarget?.id), queryFn: async () => unwrap(await api.GET('/api/v1/fact-versions/{fact_version_id}/review-context', { params: { path: { fact_version_id: reviewTarget?.id ?? '' } } })), enabled: !!reviewTarget, staleTime: QUERY_STALE_TIME.detail });
  const save = useMutation({
    mutationFn: async (values: Schema<'ProductFactsDraftUpdate'>) => unwrap(await api.PUT('/api/v1/products/{product_id}/facts', { params: { path: { product_id: productId }, header: csrfHeader() }, body: values })),
    onSuccess: async () => { message.success('事实工作区已保存'); await queryClient.invalidateQueries({ queryKey: queryKeys.products.draft(productId) }); },
  });
  const createVersion = useMutation({
    mutationFn: async (body: Schema<'CreateVersionRequest'>) => unwrap(await api.POST('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId }, header: csrfHeader() }, body })),
    onSuccess: async () => { setSnapshotOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) }); },
  });
  const command = useMutation({
    mutationFn: async ({ target, body }: { target: NonNullable<typeof commandTarget>; body: Schema<'CommandRequest'> }) => {
      const path = target.command === 'submit' ? '/api/v1/fact-versions/{fact_version_id}/submit' as const
        : target.command === 'approve' ? '/api/v1/fact-versions/{fact_version_id}/approve' as const
        : target.command === 'request-changes' ? '/api/v1/fact-versions/{fact_version_id}/request-changes' as const
        : '/api/v1/fact-versions/{fact_version_id}/retire' as const;
      return unwrap(await api.POST(path, { params: { path: { fact_version_id: target.version.id }, header: csrfHeader() }, body }));
    },
    onSuccess: async () => { const targetId = commandTarget?.version.id; setCommandTarget(null); message.success('事实版本状态已更新'); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) }), queryClient.invalidateQueries({ queryKey: queryKeys.products.factReview(targetId) })]); },
  });
  const remove = useMutation({
    mutationFn: async (version: FactVersion) => ensureSuccess(await api.DELETE('/api/v1/fact-versions/{fact_version_id}', { params: { path: { fact_version_id: version.id }, header: csrfHeader() } })),
    onSuccess: async () => { message.success('事实版本已删除'); await queryClient.invalidateQueries({ queryKey: queryKeys.products.factVersions(productId) }); },
  });

  const confirmDeleteVersion = (version: FactVersion) => modal.confirm({
    title: `物理删除事实版本 V${version.version}？`,
    content: '该版本及其审核记录会一并删除；存在内容任务或内容版本引用时服务端会拒绝。此操作不可恢复。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => remove.mutate(version),
  });

  if (product.isLoading || draft.isLoading) return <QueryLoading />;
  if (product.error || draft.error || !product.data || !draft.data) return <div className="page-stack"><Link className="back-link" to="/products"><ArrowLeftOutlined /> 返回产品列表</Link><PageHeader title="产品事实工作区" breadcrumbs={[{ title: <Link to="/products">产品事实</Link> }, { title: '事实工作区' }]} /><QueryFailure error={product.error ?? draft.error ?? new Error('产品事实工作区不存在')} onRetry={() => { void product.refetch(); void draft.refetch(); }} /></div>;
  return (
    <div className="page-stack">
      {modalContext}
      <Link className="back-link" to="/products"><ArrowLeftOutlined /> 返回产品列表</Link>
      <PageHeader eyebrow="产品事实工作区" title={<span className="data-code">{product.data.part_number}</span>} description={`${product.data.brand} · ${product.data.category} · 工作区修订 ${draft.data.revision}`} breadcrumbs={[{ title: <Link to="/products">产品事实</Link> }, { title: product.data.part_number }]} actions={<StatusTag status={product.data.status} />} />
      {(save.error || createVersion.error || command.error) && <Alert type="error" showIcon message={errorMessage(save.error ?? createVersion.error ?? command.error)} />}
      {remove.error && <DeletionError error={remove.error} />}
      <Tabs items={[
        { key: 'workspace', label: '事实工作区', children: draft.data && <FactsForm draft={draft.data} saving={save.isPending} disabled={!canEdit} onSave={(values) => save.mutateAsync(values)} /> },
        { key: 'versions', label: `事实版本（${versions.data?.items.length ?? 0}）`, children: <Card extra={canEdit && <Button type="primary" onClick={() => setSnapshotOpen(true)}>创建不可变快照</Button>}>{versions.isLoading ? <QueryLoading label="正在加载事实版本" /> : versions.error || !versions.data ? <QueryFailure error={versions.error ?? new Error('事实版本列表不存在')} onRetry={() => void versions.refetch()} /> : <TableRegion label="事实版本列表"><Table<FactVersion> rowKey="id" dataSource={versions.data.items} scroll={{ x: 760 }} columns={[
          { title: '版本', dataIndex: 'version', render: (v) => `V${v}` }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          { title: '变更说明', dataIndex: 'change_summary' }, { title: '创建时间', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('zh-CN') },
          { title: '审核操作', render: (_, version) => <Space wrap>
            <Button size="small" type="primary" onClick={() => setReviewTarget(version)}>审核证据与历史</Button>
            <Dropdown trigger={['click']} menu={{ items: [
              { key: 'snapshot', label: '查看快照' },
              ...(auth.isAdmin ? [{ key: 'delete', label: '删除', danger: true }] : []),
            ], onClick: ({ key }) => key === 'snapshot' ? setSnapshotTarget(version) : confirmDeleteVersion(version) }}>
              <Button size="small" aria-label={`更多操作：事实版本 V${version.version}`} loading={remove.isPending && remove.variables?.id === version.id}>更多 <DownOutlined /></Button>
            </Dropdown>
          </Space> },
        ]} /></TableRegion>}</Card> },
      ]} />
      <Modal title="创建事实快照" open={snapshotOpen} footer={null} onCancel={() => setSnapshotOpen(false)} destroyOnHidden><Form<Schema<'CreateVersionRequest'>> layout="vertical" onFinish={(body) => createVersion.mutate(body)}><Form.Item name="change_summary" label="变更说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={createVersion.isPending}>创建快照</Button></Form></Modal>
      <Modal title={`事实快照 V${snapshotTarget?.version ?? ''}`} open={!!snapshotTarget} footer={null} onCancel={() => setSnapshotTarget(undefined)} width={900}><FactSnapshot version={snapshotTarget} /></Modal>
      <Modal title={`事实审核证据 V${reviewTarget?.version ?? ''}`} open={!!reviewTarget} footer={null} onCancel={() => setReviewTarget(undefined)} width={960}>{reviewContext.isLoading && <QueryLoading />}{reviewContext.error && <Alert type="error" message={errorMessage(reviewContext.error)} />}{reviewContext.data && <FactReviewPanel context={reviewContext.data} onAction={(action) => { const commandName = action === 'SUBMIT' ? 'submit' : action === 'APPROVE' ? 'approve' : action === 'REQUEST_CHANGES' ? 'request-changes' : 'retire'; setCommandTarget({ version: reviewContext.data.fact_version, command: commandName }); }} />}</Modal>
      <Modal title="确认状态操作" open={!!commandTarget} footer={null} onCancel={() => setCommandTarget(null)} width={commandTarget?.command === 'approve' ? 900 : undefined} destroyOnHidden><Typography.Paragraph type="secondary">服务端会校验证据、状态和修订号。</Typography.Paragraph>{commandTarget?.command === 'approve' && <><Alert type="warning" showIcon message="请显式确认：批准依据是下方不可变快照，而不是当前事实工作区。" /><FactSnapshot version={commandTarget.version} /></>}<Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: commandTarget?.version.revision, comment: '' }} onFinish={(body) => commandTarget && command.mutate({ target: commandTarget, body })}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="审核意见" rules={commandTarget?.command === 'request-changes' ? [{ required: true, whitespace: true, message: '退回必须填写意见' }] : []}><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={command.isPending}>{commandTarget?.command === 'approve' ? '确认批准' : '确认'}</Button></Form></Modal>
    </div>
  );
}

function FactSnapshot({ version }: { version?: FactVersion }) {
  if (!version) return null;
  return <Card size="small" title={`V${version.version} · ${version.change_summary}`} className="section-card"><Typography.Paragraph type="secondary">以下 JSON 是服务端保存的完整只读快照，包含参数、替代关系、证据和声明关联。</Typography.Paragraph><pre className="snapshot-json">{JSON.stringify(version.snapshot, null, 2)}</pre></Card>;
}

function FactReviewPanel({ context, onAction }: { context: Schema<'FactReviewContext'>; onAction: (action: Schema<'FactReviewAction'>) => void }) {
  const statuses = new Map(context.evidence_statuses.map((item) => [item.client_key, item.file_status]));
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <Descriptions column={1} items={[{ label: '状态', children: <StatusTag status={context.fact_version.status} /> }, { label: '变更说明', children: context.fact_version.change_summary }, { label: '事实版本 ID', children: context.fact_version.id }]} />
    <Card size="small" title="冻结证据"><List dataSource={context.fact_version.snapshot.evidences} locale={{ emptyText: '该事实快照没有证据' }} renderItem={(item) => <List.Item><Space direction="vertical"><Space><strong>{item.title}</strong><StatusTag status={item.confidentiality} /><StatusTag status={statuses.get(item.client_key) ?? 'URL_ONLY'} /></Space><Typography.Text type="secondary">{evidenceTypeLabel(item.type)} · {item.version} · {item.source_url ?? '无公开 URL'}</Typography.Text></Space></List.Item>} /></Card>
    <Card size="small" title="追加式审核历史"><Timeline items={context.review_history.map((item) => ({ children: <><Space><StatusTag status={item.action} /><strong>{item.actor.display_name}</strong><Typography.Text type="secondary">V{item.target_version}</Typography.Text></Space><Typography.Paragraph>{item.comment || '未填写意见'}</Typography.Paragraph><Typography.Text type="secondary">{new Date(item.created_at).toLocaleString('zh-CN')}</Typography.Text></> }))} /></Card>
    <Space wrap>{context.available_actions.map((action) => <Button key={action} type={action === 'APPROVE' ? 'primary' : 'default'} danger={action === 'REQUEST_CHANGES'} onClick={() => onAction(action)}>{action === 'SUBMIT' ? '提交审核' : action === 'APPROVE' ? '批准' : action === 'REQUEST_CHANGES' ? '退回修改' : '停用'}</Button>)}</Space>
  </Space>;
}

function FactsForm({ draft, saving, disabled, onSave }: { draft: Schema<'ProductFactsDraft'>; saving: boolean; disabled: boolean; onSave: (value: Schema<'ProductFactsDraftUpdate'>) => Promise<Schema<'ProductFactsDraft'>> }) {
  const [form] = Form.useForm<Schema<'ProductFactsDraftUpdate'>>();
  const activeSection = useActiveSection(factSectionIds);
  const [dirtySections, setDirtySections] = useState<Set<string>>(new Set());
  const [errorSections, setErrorSections] = useState<Set<string>>(new Set());
  const [errorCount, setErrorCount] = useState(0);
  const [firstError, setFirstError] = useState<FormNamePath>();
  const [saveState, setSaveState] = useState<'pristine' | 'dirty' | 'saving' | 'saved' | 'failed'>('pristine');

  const sectionForField = (name: FormNamePath) => {
    const first = Array.isArray(name) ? name[0] : name;
    return factSectionByField[String(first)];
  };
  const refreshErrors = () => {
    const invalidFields = form.getFieldsError().filter((field) => field.errors.length > 0);
    setErrorCount(invalidFields.length);
    setErrorSections(new Set(invalidFields.map((field) => sectionForField(field.name)).filter((section): section is string => !!section)));
    setFirstError(invalidFields[0]?.name);
  };
  const markDirty = (changedValues: Partial<Schema<'ProductFactsDraftUpdate'>>) => {
    const changedSections = Object.keys(changedValues).map((name) => factSectionByField[name]).filter((section): section is string => !!section);
    if (changedSections.length > 0) {
      setDirtySections((current) => new Set([...current, ...changedSections]));
      setSaveState('dirty');
    }
  };
  const handleSave = async (values: Schema<'ProductFactsDraftUpdate'>) => {
    setSaveState('saving');
    try {
      const saved = await onSave(values);
      form.setFieldsValue({ ...saved, expected_revision: saved.revision });
      setDirtySections(new Set());
      setErrorSections(new Set());
      setErrorCount(0);
      setFirstError(undefined);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  };
  const handleInvalid = ({ errorFields }: { errorFields: Array<{ name: FormNamePath }> }) => {
    setErrorCount(errorFields.length);
    setErrorSections(new Set(errorFields.map((field) => sectionForField(field.name)).filter((section): section is string => !!section)));
    setFirstError(errorFields[0]?.name);
    setSaveState('failed');
  };
  const sectionLink = (id: string, label: string) => {
    const hasError = errorSections.has(id);
    const isDirty = dirtySections.has(id);
    return <a href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} className={hasError ? 'is-error' : isDirty ? 'is-dirty' : undefined}>{label}{hasError ? <span className="section-nav-status">有错误</span> : isDirty ? <span className="section-nav-status">有修改</span> : null}</a>;
  };
  const statusText = saving || saveState === 'saving' ? '保存中' : saveState === 'dirty' ? '有未保存修改' : saveState === 'saved' ? '已保存' : saveState === 'failed' ? '保存失败' : '未修改';

  return <Form<Schema<'ProductFactsDraftUpdate'>> form={form} className="facts-form" layout="vertical" disabled={disabled} initialValues={{ ...draft, expected_revision: draft.revision }} scrollToFirstError onValuesChange={markDirty} onFieldsChange={refreshErrors} onFinish={handleSave} onFinishFailed={handleInvalid}>
    <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
    <nav className="form-section-nav" aria-label="事实表单章节">{sectionLink('reference-parts', '参考型号')}{sectionLink('evidences', '证据')}{sectionLink('parameters', '参数')}{sectionLink('relations', '替代关系')}{sectionLink('claims', '内容声明')}</nav>
    <Card id="reference-parts" title="参考型号" className="section-card"><Form.List name="reference_parts">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><div className="dynamic-object-header"><Typography.Text strong>参考型号 {name + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除参考型号 ${name + 1}`} onClick={() => remove(name)}>删除</Button></div><Space align="start" wrap className="dynamic-row"><Form.Item {...field} name={[name, 'client_key']} label="本地标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'part_number']} label="参考型号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'manufacturer']} label="制造商" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'category']} label="类别" rules={[{ required: true }]}><Input /></Form.Item></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add()}>添加参考型号</Button></>}</Form.List></Card>
    <Card id="evidences" title="证据" className="section-card"><Form.List name="evidences">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><div className="dynamic-object-header"><Typography.Text strong>证据 {name + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除证据 ${name + 1}`} onClick={() => remove(name)}>删除</Button></div><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="证据标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'type']} label="类型" rules={[{ required: true }]}><Select options={evidenceTypeOptions} /></Form.Item><Form.Item {...field} name={[name, 'title']} label="标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'version']} label="版本" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'confidentiality']} label="密级" rules={[{ required: true }]}><Select options={confidentialityOptions} /></Form.Item><Form.Item {...field} name={[name, 'source_url']} label="来源 URL"><Input type="url" /></Form.Item><EvidenceFileField name={name} disabled={disabled} /></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ confidentiality: 'INTERNAL' })}>添加证据</Button></>}</Form.List></Card>
    <Card id="parameters" title="产品与参考型号参数" className="section-card"><Typography.Paragraph type="secondary"><code>owner_key</code> 使用 <code>product</code> 或上方参考型号标识。系统不会推断或补全任何参数。</Typography.Paragraph><Form.List name="parameters">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><div className="dynamic-object-header"><Typography.Text strong>参数 {name + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除参数 ${name + 1}`} onClick={() => remove(name)}>删除</Button></div><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="参数标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'owner_key']} label="归属" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'key']} label="参数键" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'name']} label="参数名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'value_type']} label="值类型"><Select options={parameterValueOptions} /></Form.Item><Form.Item {...field} name={[name, 'min_value']} label="最小值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'typical_value']} label="典型值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'max_value']} label="最大值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'text_value']} label="文本值"><Input /></Form.Item><Form.Item {...field} name={[name, 'unit']} label="单位"><Input /></Form.Item><Form.Item {...field} name={[name, 'test_conditions']} label="测试条件"><Input /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识"><Select mode="tags" /></Form.Item><Form.Item {...field} name={[name, 'is_critical']} valuePropName="checked"><Checkbox>关键参数</Checkbox></Form.Item></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ owner_key: 'product', value_type: 'TEXT', is_critical: false, evidence_keys: [] })}>添加参数</Button></>}</Form.List></Card>
    <Card id="relations" title="替代关系" className="section-card"><Form.List name="replacement_relations">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><div className="dynamic-object-header"><Typography.Text strong>替代关系 {name + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除替代关系 ${name + 1}`} onClick={() => remove(name)}>删除</Button></div><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="关系标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'reference_part_key']} label="参考型号标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'replacement_level']} label="替代等级" rules={[{ required: true }]}><Select options={replacementOptions} /></Form.Item><Form.Item {...field} name={[name, 'conditions']} label="成立条件" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'exclusions']} label="排除场景" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识" rules={[{ required: true }]}><Select mode="tags" /></Form.Item></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ evidence_keys: [] })}>添加替代关系</Button></>}</Form.List></Card>
    <Card id="claims" title="内容声明" className="section-card"><Form.List name="claims">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><div className="dynamic-object-header"><Typography.Text strong>内容声明 {name + 1}</Typography.Text><Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除内容声明 ${name + 1}`} onClick={() => remove(name)}>删除</Button></div><Space align="start" wrap className="dynamic-row"><Form.Item {...field} name={[name, 'client_key']} label="声明标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'type']} label="类型"><Select options={claimTypeOptions} /></Form.Item><Form.Item {...field} name={[name, 'text']} label="正文" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识"><Select mode="tags" /></Form.Item></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ evidence_keys: [] })}>添加声明</Button></>}</Form.List></Card>
    <Divider />{!disabled && <div className="form-save-bar">{errorCount > 0 && <Alert className="form-error-summary" type="error" showIcon title={`有 ${errorCount} 个字段需要修正`} action={<Button type="link" onClick={() => firstError && form.scrollToField(firstError, { focus: true })}>定位首个错误</Button>} />}<div className="form-save-feedback"><Typography.Text aria-live="polite" strong>{statusText}</Typography.Text><Typography.Text type="secondary">保存会校验当前工作区修订号，不会修改已批准快照。</Typography.Text></div><Button type="primary" htmlType="submit" size="large" loading={saving}>保存事实工作区</Button></div>}
  </Form>;
}

function EvidenceFileField({ name, disabled }: { name: number; disabled: boolean }) {
  const form = Form.useFormInstance<Schema<'ProductFactsDraftUpdate'>>();
  const fileId = Form.useWatch(['evidences', name, 'file_id'], form);
  return <Form.Item label="证据文件"><Form.Item name={['evidences', name, 'file_id']} hidden><Input /></Form.Item><Space direction="vertical"><DirectUpload category="EVIDENCE" disabled={disabled} onUploaded={(file) => form.setFieldValue(['evidences', name, 'file_id'], file.id)} />{fileId && <Typography.Text code>{fileId}</Typography.Text>}</Space></Form.Item>;
}
