/** 产品事实工作区：维护证据化事实、创建不可变快照并执行人工审核。 */
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Divider, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, unwrap } from '../../shared/api/client';
import type { FactVersion, Schema } from '../../shared/api/types';
import { QueryLoading } from '../../shared/components/AsyncState';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { StatusTag } from '../../shared/components/StatusTag';
import { useAuth } from '../auth/AuthProvider';

const replacementOptions: Array<{ label: string; value: Schema<'ReplacementLevel'> }> = [
  { label: '功能相近', value: 'FUNCTIONALLY_SIMILAR' }, { label: '参数兼容', value: 'PARAMETER_COMPATIBLE' },
  { label: '引脚兼容', value: 'PIN_COMPATIBLE' }, { label: 'Pin-to-Pin', value: 'PIN_TO_PIN' },
  { label: '样板验证', value: 'PROTOTYPE_VALIDATED' }, { label: '温度验证', value: 'TEMPERATURE_VALIDATED' },
  { label: '量产验证', value: 'MASS_PRODUCTION_VALIDATED' },
];

export function ProductFactsPage() {
  const auth = useAuth();
  const canEdit = auth.hasRole('PRODUCT_EDITOR');
  const canReview = auth.hasRole('PRODUCT_REVIEWER');
  const { productId = '' } = useParams();
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotTarget, setSnapshotTarget] = useState<FactVersion>();
  const [commandTarget, setCommandTarget] = useState<{ version: FactVersion; command: 'submit' | 'approve' | 'request-changes' | 'retire' } | null>(null);
  const product = useQuery({ queryKey: ['product', productId], queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}', { params: { path: { product_id: productId } } })) });
  const draft = useQuery({ queryKey: ['facts-draft', productId], queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/facts', { params: { path: { product_id: productId } } })) });
  const versions = useQuery({ queryKey: ['fact-versions', productId], queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId } } })) });
  const save = useMutation({
    mutationFn: async (values: Schema<'ProductFactsDraftUpdate'>) => unwrap(await api.PUT('/api/v1/products/{product_id}/facts', { params: { path: { product_id: productId }, header: csrfHeader() }, body: values })),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['facts-draft', productId] }),
  });
  const createVersion = useMutation({
    mutationFn: async (body: Schema<'CreateVersionRequest'>) => unwrap(await api.POST('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId }, header: csrfHeader() }, body })),
    onSuccess: async () => { setSnapshotOpen(false); await queryClient.invalidateQueries({ queryKey: ['fact-versions', productId] }); },
  });
  const command = useMutation({
    mutationFn: async ({ target, body }: { target: NonNullable<typeof commandTarget>; body: Schema<'CommandRequest'> }) => {
      const path = target.command === 'submit' ? '/api/v1/fact-versions/{fact_version_id}/submit' as const
        : target.command === 'approve' ? '/api/v1/fact-versions/{fact_version_id}/approve' as const
        : target.command === 'request-changes' ? '/api/v1/fact-versions/{fact_version_id}/request-changes' as const
        : '/api/v1/fact-versions/{fact_version_id}/retire' as const;
      return unwrap(await api.POST(path, { params: { path: { fact_version_id: target.version.id }, header: csrfHeader() }, body }));
    },
    onSuccess: async () => { setCommandTarget(null); await queryClient.invalidateQueries({ queryKey: ['fact-versions', productId] }); },
  });

  if (product.isLoading || draft.isLoading || versions.isLoading) return <QueryLoading />;
  return (
    <div className="page-stack">
      <Link to="/products"><ArrowLeftOutlined /> 返回产品列表</Link>
      <header className="page-heading"><div><Typography.Text className="eyebrow">PRODUCT FACT WORKSPACE</Typography.Text><Typography.Title>{product.data?.part_number}</Typography.Title><Typography.Paragraph>{product.data?.brand} · {product.data?.category} · 工作区修订 {draft.data?.revision}</Typography.Paragraph></div><StatusTag status={product.data?.status ?? ''} /></header>
      {(save.error || createVersion.error || command.error) && <Alert type="error" showIcon message={errorMessage(save.error ?? createVersion.error ?? command.error)} />}
      <Tabs items={[
        { key: 'workspace', label: '事实工作区', children: draft.data && <FactsForm draft={draft.data} saving={save.isPending} disabled={!canEdit} onSave={(values) => save.mutate(values)} /> },
        { key: 'versions', label: `事实版本（${versions.data?.items.length ?? 0}）`, children: <Card extra={canEdit && <Button type="primary" onClick={() => setSnapshotOpen(true)}>创建不可变快照</Button>}><Table<FactVersion> rowKey="id" dataSource={versions.data?.items} columns={[
          { title: '版本', dataIndex: 'version', render: (v) => `V${v}` }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          { title: '变更说明', dataIndex: 'change_summary' }, { title: '创建时间', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('zh-CN') },
          { title: '审核操作', render: (_, version) => <Space wrap>
            <Button size="small" onClick={() => setSnapshotTarget(version)}>查看快照</Button>
            {canEdit && version.status === 'DRAFT' && <Button size="small" onClick={() => setCommandTarget({ version, command: 'submit' })}>提交</Button>}
            {canReview && version.status === 'PENDING_REVIEW' && <><Button size="small" type="primary" onClick={() => setCommandTarget({ version, command: 'approve' })}>批准</Button><Button size="small" danger onClick={() => setCommandTarget({ version, command: 'request-changes' })}>退回</Button></>}
            {canReview && version.status === 'APPROVED' && <Button size="small" onClick={() => setCommandTarget({ version, command: 'retire' })}>停用</Button>}
          </Space> },
        ]} /></Card> },
      ]} />
      <Modal title="创建事实快照" open={snapshotOpen} footer={null} onCancel={() => setSnapshotOpen(false)} destroyOnHidden><Form<Schema<'CreateVersionRequest'>> layout="vertical" onFinish={(body) => createVersion.mutate(body)}><Form.Item name="change_summary" label="变更说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={createVersion.isPending}>创建快照</Button></Form></Modal>
      <Modal title={`事实快照 V${snapshotTarget?.version ?? ''}`} open={!!snapshotTarget} footer={null} onCancel={() => setSnapshotTarget(undefined)} width={900}><FactSnapshot version={snapshotTarget} /></Modal>
      <Modal title="确认状态操作" open={!!commandTarget} footer={null} onCancel={() => setCommandTarget(null)} width={commandTarget?.command === 'approve' ? 900 : undefined} destroyOnHidden><Typography.Paragraph type="secondary">审核者不能审核自己创建的版本，服务端会最终校验身份和状态。</Typography.Paragraph>{commandTarget?.command === 'approve' && <><Alert type="warning" showIcon message="批准前必须核对下方不可变快照，而不是当前事实工作区。" /><FactSnapshot version={commandTarget.version} /></>}<Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: commandTarget?.version.revision, comment: '' }} onFinish={(body) => commandTarget && command.mutate({ target: commandTarget, body })}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="comment" label="审核意见"><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={command.isPending}>确认</Button></Form></Modal>
    </div>
  );
}

function FactSnapshot({ version }: { version?: FactVersion }) {
  if (!version) return null;
  return <Card size="small" title={`V${version.version} · ${version.change_summary}`} className="section-card"><Typography.Paragraph type="secondary">以下 JSON 是服务端保存的完整只读快照，包含参数、替代关系、证据和声明关联。</Typography.Paragraph><pre className="snapshot-json">{JSON.stringify(version.snapshot, null, 2)}</pre></Card>;
}

function FactsForm({ draft, saving, disabled, onSave }: { draft: Schema<'ProductFactsDraft'>; saving: boolean; disabled: boolean; onSave: (value: Schema<'ProductFactsDraftUpdate'>) => void }) {
  return <Form<Schema<'ProductFactsDraftUpdate'>> layout="vertical" disabled={disabled} initialValues={{ ...draft, expected_revision: draft.revision }} onFinish={onSave}>
    <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
    <Card title="参考型号" className="section-card"><Form.List name="reference_parts">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <Space key={key} align="start" wrap className="dynamic-row"><Form.Item {...field} name={[name, 'client_key']} label="本地标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'part_number']} label="参考型号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'manufacturer']} label="制造商" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'category']} label="类别" rules={[{ required: true }]}><Input /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button icon={<PlusOutlined />} onClick={() => add()}>添加参考型号</Button></>}</Form.List></Card>
    <Card title="证据" className="section-card"><Form.List name="evidences">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="证据标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'type']} label="类型" rules={[{ required: true }]}><Select options={['DATASHEET','TEST_REPORT','APPLICATION_NOTE','CUSTOMER_AUTHORIZATION','OTHER'].map((value) => ({ value }))} /></Form.Item><Form.Item {...field} name={[name, 'title']} label="标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'version']} label="版本" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'confidentiality']} label="密级" rules={[{ required: true }]}><Select options={['PUBLIC','INTERNAL','RESTRICTED'].map((value) => ({ value }))} /></Form.Item><Form.Item {...field} name={[name, 'source_url']} label="来源 URL"><Input type="url" /></Form.Item><EvidenceFileField name={name} disabled={disabled} /><Button danger onClick={() => remove(name)}>删除</Button></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ confidentiality: 'INTERNAL' })}>添加证据</Button></>}</Form.List></Card>
    <Card title="产品与参考型号参数" className="section-card"><Typography.Paragraph type="secondary">`owner_key` 使用 `product` 或上方参考型号标识。系统不会推断或补全任何参数。</Typography.Paragraph><Form.List name="parameters">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="参数标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'owner_key']} label="归属" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'key']} label="参数键" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'name']} label="参数名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'value_type']} label="值类型"><Select options={['NUMERIC','RANGE','TEXT'].map((value) => ({ value }))} /></Form.Item><Form.Item {...field} name={[name, 'min_value']} label="最小值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'typical_value']} label="典型值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'max_value']} label="最大值"><InputNumber /></Form.Item><Form.Item {...field} name={[name, 'text_value']} label="文本值"><Input /></Form.Item><Form.Item {...field} name={[name, 'unit']} label="单位"><Input /></Form.Item><Form.Item {...field} name={[name, 'test_conditions']} label="测试条件"><Input /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识"><Select mode="tags" /></Form.Item><Form.Item {...field} name={[name, 'is_critical']} valuePropName="checked"><Checkbox>关键参数</Checkbox></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ owner_key: 'product', value_type: 'TEXT', is_critical: false, evidence_keys: [] })}>添加参数</Button></>}</Form.List></Card>
    <Card title="替代关系" className="section-card"><Form.List name="replacement_relations">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <div key={key} className="dynamic-block"><Space align="start" wrap><Form.Item {...field} name={[name, 'client_key']} label="关系标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'reference_part_key']} label="参考型号标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'replacement_level']} label="替代等级" rules={[{ required: true }]}><Select options={replacementOptions} /></Form.Item><Form.Item {...field} name={[name, 'conditions']} label="成立条件" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'exclusions']} label="排除场景" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ evidence_keys: [] })}>添加替代关系</Button></>}</Form.List></Card>
    <Card title="内容声明" className="section-card"><Form.List name="claims">{(fields, { add, remove }) => <>{fields.map(({ key, name, ...field }) => <Space key={key} align="start" wrap className="dynamic-row"><Form.Item {...field} name={[name, 'client_key']} label="声明标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item {...field} name={[name, 'type']} label="类型"><Select options={['APPROVED','PROHIBITED','REQUIRED_DISCLOSURE'].map((value) => ({ value }))} /></Form.Item><Form.Item {...field} name={[name, 'text']} label="正文" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item {...field} name={[name, 'evidence_keys']} label="证据标识"><Select mode="tags" /></Form.Item><Button danger onClick={() => remove(name)}>删除</Button></Space>)}<Button icon={<PlusOutlined />} onClick={() => add({ evidence_keys: [] })}>添加声明</Button></>}</Form.List></Card>
    <Divider />{!disabled && <Button type="primary" htmlType="submit" size="large" loading={saving}>保存事实工作区</Button>}
  </Form>;
}

function EvidenceFileField({ name, disabled }: { name: number; disabled: boolean }) {
  const form = Form.useFormInstance<Schema<'ProductFactsDraftUpdate'>>();
  const fileId = Form.useWatch(['evidences', name, 'file_id'], form);
  return <Form.Item label="证据文件"><Form.Item name={['evidences', name, 'file_id']} hidden><Input /></Form.Item><Space direction="vertical"><DirectUpload category="EVIDENCE" disabled={disabled} onUploaded={(file) => form.setFieldValue(['evidences', name, 'file_id'], file.id)} />{fileId && <Typography.Text code>{fileId}</Typography.Text>}</Space></Form.Item>;
}
