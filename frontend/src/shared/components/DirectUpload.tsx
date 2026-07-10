/** 按上传意图将文件直接传到对象存储，再由 API 完成完整性确认。 */
import { UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Typography } from 'antd';
import { useState } from 'react';
import { ApiError, api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../api/client';
import type { FileRecord, Schema } from '../api/types';

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function DirectUpload({ category, accessLevel = 'INTERNAL', disabled = false, onUploaded }: { category: Schema<'FileCategory'>; accessLevel?: Schema<'Confidentiality'>; disabled?: boolean; onUploaded: (file: FileRecord) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pendingFileId, setPendingFileId] = useState<string>();
  const complete = async (fileId: string) => {
    setUploading(true); setError(undefined);
    try {
      const verified = unwrap(await api.POST('/api/v1/files/{file_id}/complete', { params: { path: { file_id: fileId }, header: csrfHeader() } }));
      setPendingFileId(undefined);
      onUploaded(verified);
    } catch (cause) {
      if (cause instanceof ApiError && ['FILE_INTEGRITY_FAILED', 'INVALID_STATE_TRANSITION'].includes(cause.code)) setPendingFileId(undefined);
      setError(cause);
    } finally { setUploading(false); }
  };
  const upload = async (file: File) => {
    setUploading(true); setError(undefined);
    try {
      const intent = unwrap(await api.POST('/api/v1/files/upload-intents', { params: { header: csrfHeader() }, body: { category, original_filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size, sha256: await sha256(file), access_level: accessLevel } }));
      if (intent.upload.method === 'PUT') {
        const response = await fetch(intent.upload.url, { method: 'PUT', headers: intent.upload.headers, body: file });
        if (!response.ok) {
          // 仅在对象传输明确失败时中止意图；完成校验的瞬时故障应保留 PENDING 供重试。
          await api.POST('/api/v1/files/{file_id}/abort', { params: { path: { file_id: intent.file.id }, header: csrfHeader() } }).then(ensureSuccess).catch(() => undefined);
          throw new Error(`对象存储上传失败（HTTP ${response.status}）`);
        }
      } else {
        const form = new FormData();
        Object.entries(intent.upload.fields).forEach(([key, value]) => form.append(key, value));
        form.append('file', file);
        const response = await fetch(intent.upload.url, { method: 'POST', headers: intent.upload.headers, body: form });
        if (!response.ok) {
          await api.POST('/api/v1/files/{file_id}/abort', { params: { path: { file_id: intent.file.id }, header: csrfHeader() } }).then(ensureSuccess).catch(() => undefined);
          throw new Error(`对象存储上传失败（HTTP ${response.status}）`);
        }
      }
      setPendingFileId(intent.file.id);
      await complete(intent.file.id);
    } catch (cause) { setError(cause); } finally { setUploading(false); }
  };
  return <Space direction="vertical"><Space wrap><Button disabled={disabled} loading={uploading} icon={<UploadOutlined />}><label className="upload-label">{uploading ? '上传并校验中' : '选择文件'}<input type="file" disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label></Button>{pendingFileId && <Button disabled={disabled} loading={uploading} onClick={() => void complete(pendingFileId)}>重试完整性校验</Button>}</Space>{error ? <Alert type="error" message={errorMessage(error)} /> : <Typography.Text type="secondary">文件不会经过 FastAPI，由浏览器直接上传对象存储。</Typography.Text>}</Space>;
}
