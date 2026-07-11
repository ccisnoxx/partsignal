/** 人工发布工作台只登记已批准内容，不包含平台自动化或账号凭据。 */
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Timeline, Typography, message } from 'antd';
import { useState } from 'react';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import type { ContentVersion, FileRecord, PublicationRecord, Schema } from '../../shared/api/types';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { StatusTag } from '../../shared/components/StatusTag';

type PublicationStatus = Schema<'PublicationStatus'>;

export function PublicationsPage() {
  const canEdit = true;
  const [candidate, setCandidate] = useState<ContentVersion>();
  const [selected, setSelected] = useState<PublicationRecord>();
  const candidates = useQuery({ queryKey: ['publication-candidates'], queryFn: async () => unwrap(await api.GET('/api/v1/publication-candidates')) });
  const records = useQuery({ queryKey: ['publication-records'], queryFn: async () => unwrap(await api.GET('/api/v1/publication-records', { params: { query: { page: 1, page_size: 100 } } })) });
  return <div className="page-stack"><header className="page-heading"><div><Typography.Text className="eyebrow">HUMAN PUBLISHING</Typography.Text><Typography.Title>人工发布</Typography.Title><Typography.Paragraph>系统只准备发布包并记录结果，不登录或操作外部平台。</Typography.Paragraph></div></header>
    {(candidates.error || records.error) && <Alert type="error" message={errorMessage(candidates.error ?? records.error)} />}
    <Card title="待发布候选"><Table<ContentVersion> rowKey="id" loading={candidates.isLoading} dataSource={candidates.data?.items} columns={[{ title: '标题', dataIndex: 'title' }, { title: '版本', dataIndex: 'version', render: (v) => `V${v}` }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> }, ...(canEdit ? [{ title: '操作', render: (_: unknown, row: ContentVersion) => <Button type="primary" onClick={() => setCandidate(row)}>准备人工发布</Button> }] : [])]} /></Card>
    <Card title="发布记录"><Table<PublicationRecord> rowKey="id" loading={records.isLoading} dataSource={records.data?.items} columns={[{ title: '创建时间', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('zh-CN') }, { title: '内容版本', dataIndex: 'content_version_id' }, { title: '状态', dataIndex: 'status', render: (v) => <StatusTag status={v} /> }, { title: '最终 URL', dataIndex: 'final_url', render: (url) => url ? <a href={url} target="_blank" rel="noreferrer">打开 <LinkOutlined /></a> : '—' }, { title: '操作', render: (_, row) => <Button onClick={() => setSelected(row)}>查看与更新</Button> }]} /></Card>
    {candidate && <PublicationCreateModal candidate={candidate} onClose={() => setCandidate(undefined)} />}
    {selected && <PublicationDetailModal initial={selected} canEdit={canEdit} onClose={() => setSelected(undefined)} />}
  </div>;
}

function PublicationCreateModal({ candidate, onClose }: { candidate: ContentVersion; onClose: () => void }) {
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const accounts = useQuery({ queryKey: ['platform-accounts'], queryFn: async () => unwrap(await api.GET('/api/v1/platform-accounts')) });
  const packageQuery = useQuery({ queryKey: ['publication-package', candidate.id], queryFn: async () => unwrap(await api.GET('/api/v1/content-versions/{content_version_id}/publication-package', { params: { path: { content_version_id: candidate.id } } })) });
  const create = useMutation({ mutationFn: async (values: Schema<'ManualPublicationCreate'>) => unwrap(await api.POST('/api/v1/publication-records/manual', { params: { header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } }, body: { ...values, attachment_file_ids: attachments.map((item) => item.id) } })), onSuccess: async () => { onClose(); await Promise.all([queryClient.invalidateQueries({ queryKey: ['publication-records'] }), queryClient.invalidateQueries({ queryKey: ['publication-candidates'] })]); } });
  const copy = async (value: string, label: string) => { await navigator.clipboard.writeText(value); void message.success(`${label}已复制`); };
  return <Modal title="准备人工发布" open footer={null} onCancel={onClose} width={800} destroyOnHidden>{create.error && <Alert type="error" message={errorMessage(create.error)} />}<Card size="small" title={packageQuery.data?.title ?? candidate.title} loading={packageQuery.isLoading}><Space wrap><Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.title, '标题')}>复制标题</Button><Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_markdown, 'Markdown')}>复制 Markdown</Button><Button icon={<CopyOutlined />} onClick={() => packageQuery.data && void copy(packageQuery.data.body_text, '纯文本')}>复制纯文本</Button></Space><Typography.Paragraph type="secondary">内容哈希：{packageQuery.data?.content_hash}</Typography.Paragraph></Card><Form<Schema<'ManualPublicationCreate'>> layout="vertical" initialValues={{ content_version_id: candidate.id, attachment_file_ids: [] }} onFinish={(body) => create.mutate(body)}><Form.Item name="content_version_id" hidden><Input /></Form.Item><Form.Item name="platform_account_id" label="平台账号标识" rules={[{ required: true }]}><Select options={accounts.data?.items.filter((item) => item.is_active).map((item) => ({ value: item.id, label: `${item.label} / ${item.account_identifier}` }))} /></Form.Item><Form.Item name="section_url" label="目标栏目 URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Form.Item label="发布截图（可选）"><DirectUpload category="OPERATION_SCREENSHOT" onUploaded={(file) => setAttachments((items) => [...items, file])} />{attachments.map((file) => <StatusTag key={file.id} status={file.status} />)}</Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>登记待人工发布</Button></Form></Modal>;
}

function PublicationDetailModal({ initial, canEdit, onClose }: { initial: PublicationRecord; canEdit: boolean; onClose: () => void }) {
  const [commandName, setCommandName] = useState<PublicationStatus>();
  const detail = useQuery({ queryKey: ['publication-record', initial.id], queryFn: async () => unwrap(await api.GET('/api/v1/publication-records/{publication_id}', { params: { path: { publication_id: initial.id } } })), initialData: initial });
  const commands: Partial<Record<PublicationStatus, 'mark-platform-review' | 'mark-published' | 'verify' | 'reject' | 'remove' | 'mark-verification-failed'>> = { PLATFORM_REVIEW: 'mark-platform-review', PUBLISHED: 'mark-published', VERIFIED: 'verify', REJECTED: 'reject', REMOVED: 'remove', VERIFICATION_FAILED: 'mark-verification-failed' };
  const transitions: Partial<Record<PublicationStatus, PublicationStatus[]>> = {
    PENDING_MANUAL_PUBLISH: ['PLATFORM_REVIEW', 'REJECTED'],
    PLATFORM_REVIEW: ['PUBLISHED', 'REJECTED'],
    PUBLISHED: ['VERIFIED', 'REMOVED', 'VERIFICATION_FAILED'],
    VERIFIED: ['REMOVED', 'VERIFICATION_FAILED'],
  };
  const mutate = useMutation({ mutationFn: async (body: Schema<'PublicationCommand'>) => { const command = commandName ? commands[commandName] : undefined; if (!command) throw new Error('未选择发布状态'); return unwrap(await api.POST('/api/v1/publication-records/{publication_id}/{command}', { params: { path: { publication_id: initial.id, command }, header: csrfHeader() }, body })); }, onSuccess: async () => { setCommandName(undefined); await Promise.all([queryClient.invalidateQueries({ queryKey: ['publication-record', initial.id] }), queryClient.invalidateQueries({ queryKey: ['publication-records'] })]); } });
  const record = detail.data;
  const available = canEdit ? transitions[record.status] ?? [] : [];
  return <Modal title="发布记录" open footer={null} onCancel={onClose} width={780}><Descriptions column={1} items={[{ label: '状态', children: <StatusTag status={record.status} /> }, { label: '内容版本', children: record.content_version_id }, { label: '栏目', children: record.section_url }, { label: '最终 URL', children: record.final_url ?? '—' }, { label: '内容哈希', children: record.content_hash }]} /><Space wrap className="command-bar">{available.map((status) => <Button key={status} onClick={() => setCommandName(status)}>{status}</Button>)}</Space><Timeline items={record.status_events.map((event) => ({ children: <><strong><StatusTag status={event.status} /></strong> {event.comment}<br /><Typography.Text type="secondary">{new Date(event.created_at).toLocaleString('zh-CN')}</Typography.Text></> }))} />
    <Modal title="更新发布状态" open={!!commandName} footer={null} onCancel={() => setCommandName(undefined)} destroyOnHidden><Form<Schema<'PublicationCommand'>> layout="vertical" initialValues={{ comment: '' }} onFinish={(body) => mutate.mutate(body)}>{commandName === 'PUBLISHED' && <><Form.Item name="actual_title" label="实际标题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="final_url" label="最终 URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item><Form.Item name="published_at" label="发布时间（RFC3339）" rules={[{ required: true }]}><Input placeholder="2026-07-10T10:00:00+08:00" /></Form.Item></>}{commandName === 'VERIFIED' && <Form.Item name="content_matches" label="正文一致" rules={[{ required: true }]}><Select options={[{ value: true, label: '已人工核对，与批准正文一致' }]} /></Form.Item>}<Form.Item name="comment" label="说明" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit" loading={mutate.isPending}>确认</Button></Form></Modal>
  </Modal>;
}
