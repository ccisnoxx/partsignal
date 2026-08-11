import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256, transferFile } from './publication-evidence-upload';

afterEach(() => vi.restoreAllMocks());

describe('Publication evidence upload', () => {
  it('使用浏览器 SHA-256，并按 signed PUT headers 直传', async () => {
    const file = new File(['evidence'], 'proof.png', { type: 'image/png' });
    expect(await sha256(file)).toBe('ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await transferFile(file, {
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
    });

    expect(fetchMock).toHaveBeenCalledWith('https://storage.example.test/proof', {
      method: 'PUT',
      headers: { 'x-amz-meta-sha256': 'hash' },
      body: file,
    });
  });
});
