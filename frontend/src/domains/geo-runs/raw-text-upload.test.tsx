import { File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { RawTextUpload } from './raw-text-upload';

const contents = '\ufeff第一行\r\n\tsecond line  \n';
const original = () => new NodeFile([contents], 'evidence.txt', { type: 'text/plain' });
const record: components['schemas']['FileRecord'] = {
  id: '10000000-0000-4000-8000-000000000005', category: 'EVIDENCE',
  original_filename: 'evidence.txt', object_key: 'evidence/one.txt', content_type: 'text/plain',
  size: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex'),
  access_level: 'INTERNAL', status: 'PENDING', created_at: '2026-10-02T00:00:00Z',
};
const intent: components['schemas']['UploadIntent'] = {
  file: record, upload: { method: 'PUT', url: `/api/v1/files/${record.id}/content`,
    headers: { 'Content-Type': 'application/octet-stream' }, fields: {}, expires_at: '2026-10-02T00:05:00Z' },
};
const verified = { ...record, status: 'VERIFIED' as const };
const response = (data: unknown) => ({ data, response: Response.json(data) }) as never;
const failure = () => ({ error: { error: { code: 'FILE_PENDING', message: '文本校验暂不可用', details: {}, request_id: 'req-text' } }, response: new Response(null, { status: 503 }) }) as never;
beforeEach(() => vi.spyOn(api, 'GET').mockResolvedValue(response(record)));
afterEach(() => vi.restoreAllMocks());
function setup() {
  const client = createAppQueryClient();
  const uploaded = vi.fn();
  const blocking = vi.fn();
  const view = render(<QueryClientProvider client={client}><RawTextUpload csrfToken="csrf" onUploaded={uploaded} onBlockingChange={blocking} /></QueryClientProvider>);
  return { client, uploaded, blocking, view };
}
function select(file: File | NodeFile = original()) {
  fireEvent.change(screen.getByLabelText('上传原始文本证据'), { target: { files: [file] } });
}
function transfer() {
  return vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
}

describe('原始文本证据上传', () => {
  it('EVIDENCE/text/plain使用原字节SHA与单次PUT，VERIFIED后才关联', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(response(verified));
    const put = transfer();
    const { uploaded, blocking } = setup();
    const file = original();
    select(file);
    await waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith(verified));
    expect(blocking).toHaveBeenLastCalledWith(false);
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/files/upload-intents', expect.objectContaining({
      body: { category: 'EVIDENCE', access_level: 'INTERNAL', content_type: 'text/plain', original_filename: file.name, size: record.size, sha256: record.sha256 },
    }));
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/v1/files/{file_id}/content', expect.objectContaining({ body: file }));
    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from(contents));
  });
  it.each([
    { type: 'application/json', size: 2 }, { type: 'text/plain', size: 0 }, { type: 'text/plain', size: 50 * 1024 * 1024 + 1 },
  ])('非法输入$type/$size在intent之前失败', async (file) => {
    const post = vi.spyOn(api, 'POST');
    setup();
    select({ ...file, name: 'raw.txt' } as File);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });
  it.each([
    { category: 'OPERATION_SCREENSHOT' as const }, { content_type: 'application/json' }, { size: record.size + 1 },
    { sha256: 'a'.repeat(64) }, { access_level: 'PUBLIC' as const }, { status: 'VERIFIED' as const },
  ])('不匹配的上传意图%j不能接收原始文件字节', async (change) => {
    vi.spyOn(api, 'POST').mockResolvedValue(response({ ...intent, file: { ...record, ...change } }));
    const put = transfer();
    const { uploaded, blocking } = setup();
    select();
    expect(await screen.findByRole('alert')).toHaveTextContent('上传意图与所选文件不一致');
    expect(put).not.toHaveBeenCalled();
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(false);
  });
  it('complete失败保留旧意图与阻塞，只显式重试校验，不再传字节', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(failure()).mockResolvedValueOnce(response(verified));
    const put = transfer();
    const { uploaded, blocking } = setup();
    select();
    expect(await screen.findByRole('alert')).toHaveTextContent('req-text');
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: '重试原始文本证据校验' }));
    await waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith(verified));
    expect(post).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenCalledOnce();
  });
  it('传输未知不自动重发，读取原状态并显式放弃后才解除阻塞', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(response({ ...record, status: 'ABORTED' }));
    const put = vi.spyOn(api, 'PUT').mockRejectedValue(new TypeError('传输结果未知'));
    const { uploaded, blocking } = setup();
    select();
    await screen.findByRole('button', { name: '核对原始文本证据状态' });
    expect(blocking).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('上传原始文本证据')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '放弃原始文本证据上传' }));
    await waitFor(() => expect(blocking).toHaveBeenLastCalledWith(false));
    expect(put).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledTimes(2);
    expect(uploaded).not.toHaveBeenCalled();
  });
  it('complete回执丢失后读取VERIFIED关联，不重复complete', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockRejectedValueOnce(new TypeError('回执丢失'));
    const put = transfer();
    const { uploaded, blocking } = setup();
    select();
    await screen.findByRole('button', { name: '重试原始文本证据校验' });
    vi.mocked(api.GET).mockResolvedValue(response(verified));
    await userEvent.click(screen.getByRole('button', { name: '重试原始文本证据校验' }));
    await waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith(verified));
    expect(blocking).toHaveBeenLastCalledWith(false);
    expect(post).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledOnce();
  });
  it('校验回执跨文件类别时不关联，继续保留恢复意图', async () => {
    vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(response({ ...verified, category: 'OPERATION_SCREENSHOT' }));
    transfer();
    const { uploaded, blocking } = setup();
    select();
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未完成可信校验');
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
  });
  it.each(['unmount', 'principal'] as const)('%s后迟到文本校验不关联或解除其他实例阻塞', async (change) => {
    let finish!: (value: never) => void;
    vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    transfer();
    const { client, view, uploaded, blocking } = setup();
    select();
    await screen.findByText('正在校验原始文本证据…');
    if (change === 'unmount') view.unmount();
    else invalidatePrincipalEpoch(client);
    await act(async () => finish(response(verified)));
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
  });
  it('失败意图不能借新主体继续恢复旧上传', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(failure());
    transfer();
    const { client, uploaded } = setup();
    select();
    await screen.findByRole('button', { name: '重试原始文本证据校验' });
    invalidatePrincipalEpoch(client);
    await userEvent.click(screen.getByRole('button', { name: '重试原始文本证据校验' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('认证主体已经变化');
    expect(post).toHaveBeenCalledTimes(2);
    expect(uploaded).not.toHaveBeenCalled();
  });
});
