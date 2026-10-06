import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { PublicationEvidenceUpload } from './publication-evidence-upload';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];

const fileId = '10000000-0000-4000-8000-000000000001';
const pendingFile = {
  id: fileId,
  category: 'OPERATION_SCREENSHOT',
  original_filename: 'proof.png',
  object_key: 'evidence/proof.png',
  content_type: 'image/png',
  size: 8,
  sha256: 'hash',
  access_level: 'INTERNAL',
  status: 'PENDING',
  created_at: '2026-08-12T00:00:00Z',
} satisfies FileRecord;
const intent = {
  file: pendingFile,
  upload: {
    method: 'PUT',
    url: `/api/v1/files/${fileId}/content`,
    headers: { 'Content-Type': 'application/octet-stream' },
    fields: {},
    expires_at: '2026-08-12T00:05:00Z',
  },
} satisfies UploadIntent;

afterEach(() => vi.restoreAllMocks());

describe('Publication evidence upload', () => {
  it('保留可访问的 publication 证据选择入口', () => {
    const queryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PublicationEvidenceUpload csrfToken="csrf" onBusyChange={() => undefined} onUploaded={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('上传发布证据截图')).toBeEnabled();
  });

  it('后端 PUT 带会话 CSRF，complete 失败后仅重试 complete', async () => {
    const post = vi.spyOn(api, 'POST');
    post.mockResolvedValueOnce({ data: intent, response: Response.json(intent) } as never);
    post.mockResolvedValueOnce({
      error: { error: { code: 'STORAGE_UNAVAILABLE', message: '对象校验暂不可用', details: {}, request_id: 'req-complete' } },
      response: Response.json({}, { status: 503 }),
    } as never);
    post.mockResolvedValueOnce({ data: { ...pendingFile, status: 'VERIFIED' }, response: Response.json({}) } as never);
    const put = vi.spyOn(api, 'PUT').mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never);
    const onBusyChange = vi.fn();
    const onUploaded = vi.fn();
    const queryClient = createAppQueryClient();
    render(<QueryClientProvider client={queryClient}>
      <PublicationEvidenceUpload csrfToken="publication-csrf" onBusyChange={onBusyChange} onUploaded={onUploaded} />
    </QueryClientProvider>);

    await userEvent.upload(screen.getByLabelText('上传发布证据截图'), new File(['evidence'], 'proof.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('对象校验暂不可用');
    expect(put).toHaveBeenCalledWith('/api/v1/files/{file_id}/content', expect.objectContaining({
      params: { path: { file_id: fileId }, header: { 'X-CSRF-Token': 'publication-csrf' } },
      redirect: 'error',
    }));
    await userEvent.click(screen.getByRole('button', { name: '重试校验' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ ...pendingFile, status: 'VERIFIED' }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/files/upload-intents', expect.anything());
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/files/{file_id}/complete', expect.anything());
    expect(post).toHaveBeenNthCalledWith(3, '/api/v1/files/{file_id}/complete', expect.anything());
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('传输失败时 abort，且不进入 complete', async () => {
    const post = vi.spyOn(api, 'POST');
    post.mockResolvedValueOnce({ data: intent, response: Response.json(intent) } as never);
    post.mockResolvedValueOnce({ data: { ...pendingFile, status: 'ABORTED' }, response: Response.json({}) } as never);
    vi.spyOn(api, 'PUT').mockResolvedValue({
      error: { error: { code: 'FILE_SHA256_MISMATCH', message: '文件摘要不匹配', details: {}, request_id: 'req-transfer' } },
      response: Response.json({}, { status: 422 }),
    } as never);
    const queryClient = createAppQueryClient();
    render(<QueryClientProvider client={queryClient}>
      <PublicationEvidenceUpload csrfToken="publication-csrf" onBusyChange={vi.fn()} onUploaded={vi.fn()} />
    </QueryClientProvider>);

    await userEvent.upload(screen.getByLabelText('上传发布证据截图'), new File(['evidence'], 'proof.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('文件摘要不匹配');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/files/upload-intents', expect.anything());
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/files/{file_id}/abort', expect.anything());
  });
});
