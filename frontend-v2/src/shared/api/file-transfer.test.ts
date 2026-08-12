import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import { sha256File, transferFile } from './file-transfer';

type UploadIntent = components['schemas']['UploadIntent'];

const file = new File(['evidence'], 'proof.png', { type: 'image/png' });
const intent = {
  file: {
    id: '10000000-0000-4000-8000-000000000001',
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
    url: 'https://storage.example.test/proof',
    headers: { 'x-amz-meta-sha256': 'hash' },
    fields: {},
    expires_at: '2026-08-11T00:05:00Z',
  },
} satisfies UploadIntent;

afterEach(() => vi.restoreAllMocks());

describe('file transfer', () => {
  it('使用浏览器 SHA-256，并按 signed PUT headers 直传', async () => {
    expect(await sha256File(file))
      .toBe('ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e');

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    await transferFile(file, intent);

    expect(fetchMock).toHaveBeenCalledWith(intent.upload.url, {
      method: 'PUT',
      headers: intent.upload.headers,
      body: file,
    });
  });

  it('按 signed POST fields 直传并保留文件字段', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await transferFile(file, {
      ...intent,
      upload: { ...intent.upload, method: 'POST', fields: { key: 'evidence/proof.png' } },
    });

    const [, request] = fetchMock.mock.calls[0]!;
    expect(request?.method).toBe('POST');
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).get('key')).toBe('evidence/proof.png');
    expect((request?.body as FormData).get('file')).toBe(file);
  });
});
