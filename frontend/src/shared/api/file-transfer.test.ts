import { File as NodeFile } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@/shared/api/generated/schema';

type UploadIntent = components['schemas']['UploadIntent'];

// Node Request 需要同运行时的 Blob；浏览器中的 File 与 Request 天然共享实现。
const file = new NodeFile(['evidence'], 'proof.png', { type: 'image/png' }) as unknown as File;
const fileId = '10000000-0000-4000-8000-000000000001';
const intent = {
  file: {
    id: fileId,
    category: 'OPERATION_SCREENSHOT',
    original_filename: file.name,
    object_key: 'evidence/proof.png',
    content_type: file.type,
    size: file.size,
    sha256: 'hash',
    access_level: 'INTERNAL',
    status: 'PENDING',
    created_at: '2026-08-11T00:00:00Z',
  },
  upload: {
    method: 'PUT',
    url: `/api/v1/files/${fileId}/content`,
    headers: { 'Content-Type': 'application/octet-stream' },
    fields: {},
    expires_at: '2026-08-11T00:05:00Z',
  },
} satisfies UploadIntent;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('file transfer', () => {
  it('向 canonical API 发送原始 File、Cookie 与 CSRF，成功后仍等待 complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { sha256File, transferFile } = await import('./file-transfer');

    expect(await sha256File(file))
      .toBe('ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e');
    await transferFile(file, intent, 'session-csrf');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toBe(`https://api.example.test/api/v1/files/${fileId}/content`);
    expect(request.method).toBe('PUT');
    expect(request.credentials).toBe('include');
    expect(request.redirect).toBe('error');
    expect(request.headers.get('X-CSRF-Token')).toBe('session-csrf');
    expect(request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(await request.text()).toBe('evidence');
  });

  it('拒绝外部或不匹配的上传意图，不发送会话令牌', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { transferFile } = await import('./file-transfer');
    await expect(transferFile(file, {
      ...intent,
      upload: { ...intent.upload, url: 'https://storage.example.test/proof' },
    }, 'session-csrf')).rejects.toThrow('文件上传意图无效');
    await expect(transferFile(file, {
      ...intent,
      upload: { ...intent.upload, url: '/api/v1/files/20000000-0000-4000-8000-000000000002/content' },
    }, 'session-csrf')).rejects.toThrow('文件上传意图无效');
    await expect(transferFile(file, {
      ...intent,
      upload: { ...intent.upload, headers: { 'Content-Type': 'application/octet-stream', 'X-Target': 'outside' } },
    }, 'session-csrf')).rejects.toThrow('文件上传意图无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缺少 CSRF 时在发送前显式失败', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { transferFile } = await import('./file-transfer');
    await expect(transferFile(file, intent, null)).rejects.toThrow('缺少会话安全令牌');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('透出后端 ErrorEnvelope 的真实 message、code 和请求 ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      error: { code: 'FILE_SHA256_MISMATCH', message: '文件 SHA-256 不匹配', details: {}, request_id: 'req-transfer' },
    }, { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);
    const { transferFile } = await import('./file-transfer');
    await expect(transferFile(file, intent, 'session-csrf')).rejects.toMatchObject({
      message: '文件 SHA-256 不匹配（请求 ID：req-transfer）',
      code: 'FILE_SHA256_MISMATCH',
      status: 422,
    });
  });
});
