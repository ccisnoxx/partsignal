import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    url: 'https://storage.example.test/proof',
    headers: {},
    fields: {},
    expires_at: '2026-08-12T00:05:00Z',
  },
} satisfies UploadIntent;

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const onUploaded = vi.fn();
    render(<GeoEvidenceUpload csrfToken="csrf" onUploaded={onUploaded} />);

    await userEvent.upload(
      screen.getByLabelText('上传 GEO 证据截图'),
      new File(['evidence'], 'proof.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('文件校验失败');
    await userEvent.click(screen.getByRole('button', { name: '重试校验' }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({
      ...pendingFile,
      status: 'VERIFIED',
    }));
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/files/upload-intents', expect.anything());
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/files/{file_id}/complete', expect.anything());
    expect(post).toHaveBeenNthCalledWith(3, '/api/v1/files/{file_id}/complete', expect.anything());
  });
});
