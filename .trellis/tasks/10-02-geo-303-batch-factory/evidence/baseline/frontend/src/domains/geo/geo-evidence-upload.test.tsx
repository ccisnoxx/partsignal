import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { GeoEvidenceUpload } from './geo-evidence-upload';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];

const pendingFile = {
  id: '10000000-0000-4000-8000-000000000001',
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
    url: `/api/v1/files/${pendingFile.id}/content`,
    headers: { 'Content-Type': 'application/octet-stream' },
    fields: {},
    expires_at: '2026-08-12T00:05:00Z',
  },
} satisfies UploadIntent;

function renderUpload(onUploaded: (file: FileRecord) => void, onBlockingChange: (blocking: boolean) => void) {
  const queryClient = createAppQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GeoEvidenceUpload csrfToken="csrf" onUploaded={onUploaded} onBlockingChange={onBlockingChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('GeoEvidenceUpload', () => {
  it('intent、transfer、complete 使用 GEO 合同且 complete 失败只重试 complete', async () => {
    const post = vi.spyOn(api, 'POST');
    post.mockResolvedValueOnce({ data: intent, response: Response.json(intent) } as never);
    post.mockResolvedValueOnce({
      error: { error: { code: 'FILE_MISMATCH', message: '文件校验失败', details: {}, request_id: 'req-file' } },
      response: Response.json({}, { status: 422 }),
    } as never);
    post.mockResolvedValueOnce({
      data: { ...pendingFile, status: 'VERIFIED' },
      response: Response.json({ ...pendingFile, status: 'VERIFIED' }),
    } as never);
    const put = vi.spyOn(api, 'PUT').mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never);
    const onUploaded = vi.fn();
    const onBlockingChange = vi.fn();
    renderUpload(onUploaded, onBlockingChange);

    await userEvent.upload(
      screen.getByLabelText('上传 GEO 证据截图'),
      new File(['evidence'], 'proof.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('文件校验失败');
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: '重试校验' }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({
      ...pendingFile,
      status: 'VERIFIED',
    }));
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
    expect(put).toHaveBeenCalledWith('/api/v1/files/{file_id}/content', expect.objectContaining({
      params: { path: { file_id: pendingFile.id }, header: { 'X-CSRF-Token': 'csrf' } },
      redirect: 'error',
    }));
    expect(put).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/files/upload-intents', expect.anything());
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/files/{file_id}/complete', expect.anything());
    expect(post).toHaveBeenNthCalledWith(3, '/api/v1/files/{file_id}/complete', expect.anything());
  });
  it('校验失败后放弃上传，abort 失败保留阻塞，成功后才允许继续', async () => {
    const post = vi.spyOn(api, 'POST');
    post.mockResolvedValueOnce({ data: intent, response: Response.json(intent) } as never);
    post.mockResolvedValueOnce({ error: {}, response: Response.json({}, { status: 422 }) } as never);
    post.mockResolvedValueOnce({ error: {}, response: Response.json({}, { status: 500 }) } as never);
    post.mockResolvedValueOnce({ data: { ...pendingFile, status: 'ABORTED' }, response: Response.json({}) } as never);
    vi.spyOn(api, 'PUT').mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never);
    const onBlockingChange = vi.fn();
    const onUploaded = vi.fn();
    renderUpload(onUploaded, onBlockingChange);
    await userEvent.upload(screen.getByLabelText('上传 GEO 证据截图'), new File(['evidence'], 'proof.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: '放弃上传' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500'));
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('上传 GEO 证据截图')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '放弃上传' }));
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText('上传 GEO 证据截图')).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

});
