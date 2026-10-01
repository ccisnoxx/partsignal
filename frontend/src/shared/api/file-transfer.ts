import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];
type UploadIntent = components['schemas']['UploadIntent'];

class FileTransferError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
  }
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function transferFile(file: File, intent: UploadIntent, csrfToken: string | null) {
  const fileId = intent.file.id;
  const upload = intent.upload;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fileId)
    || upload.method !== 'PUT'
    || upload.url !== `/api/v1/files/${fileId}/content`
    || Object.keys(upload.fields).length !== 0
    || Object.keys(upload.headers).length !== 1
    || upload.headers['Content-Type'] !== 'application/octet-stream'
  ) {
    throw new FileTransferError('文件上传意图无效');
  }
  if (!csrfToken) throw new FileTransferError('缺少会话安全令牌，无法上传文件');

  const result = await api.PUT('/api/v1/files/{file_id}/content', {
    // OpenAPI binary 生成为 string；运行时必须保留 File 原始字节，不经过 JSON 序列化。
    body: file as unknown as string,
    bodySerializer: (body) => body,
    headers: { 'Content-Type': 'application/octet-stream' },
    params: {
      path: { file_id: fileId },
      header: { 'X-CSRF-Token': csrfToken },
    },
    redirect: 'error',
  });
  if (result.response.status === 204) return;
  if (isErrorEnvelope(result.error)) {
    const detail = result.error.error;
    throw new FileTransferError(
      `${detail.message}（请求 ID：${detail.request_id}）`,
      result.response.status,
      detail.code,
    );
  }
  throw new FileTransferError(`上传文件失败（HTTP ${result.response.status}）`, result.response.status);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const detail = value.error;
  return Boolean(
    detail
    && typeof detail === 'object'
    && 'code' in detail
    && typeof detail.code === 'string'
    && 'message' in detail
    && typeof detail.message === 'string'
    && 'request_id' in detail
    && typeof detail.request_id === 'string',
  );
}

export { sha256File, transferFile };
