import { File as NodeFile } from 'node:buffer';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { createAppQueryClient } from '@/app/query-client';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { RunUpload } from './run-upload';

const fileRecord: components['schemas']['FileRecord'] = {
  id: '10000000-0000-4000-8000-000000000001',
  category: 'OPERATION_SCREENSHOT',
  original_filename: 'proof.png',
  object_key: 'screenshots/proof.png',
  content_type: 'image/png',
  size: 8,
  sha256: 'ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e',
  access_level: 'INTERNAL',
  status: 'PENDING',
  created_at: '2026-10-02T00:00:00Z',
};
const intent: components['schemas']['UploadIntent'] = {
  file: fileRecord,
  upload: {
    method: 'PUT',
    url: `/api/v1/files/${fileRecord.id}/content`,
    headers: { 'Content-Type': 'application/octet-stream' },
    fields: {},
    expires_at: '2026-10-02T00:05:00Z',
  },
};
function response(data: unknown) {
  return { data, response: Response.json(data) } as never;
}
function failure() {
  const body = { error: { code: 'FILE_PENDING', message: '截图校验失败', details: {}, request_id: 'req-upload' } };
  return { error: body, response: Response.json(body, { status: 503 }) } as never;
}
function renderUpload() {
  const client = createAppQueryClient();
  const uploaded = vi.fn();
  const blocking = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <RunUpload csrfToken="csrf" onBlockingChange={blocking} onUploaded={uploaded} />
    </QueryClientProvider>,
  );
  return { client, uploaded, blocking, view };
}
function selectFile(type = 'image/png') {
  fireEvent.change(screen.getByLabelText('上传人工采集截图'), {
    target: { files: [new NodeFile(['evidence'], 'proof.png', { type })] },
  });
}
afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.spyOn(api, 'GET').mockResolvedValue(response(fileRecord)));

describe('人工采集截图生命周期', () => {
  it('真实 SHA256、共享 PUT 后等待 VERIFIED，complete 失败只重试 complete', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(response({ ...fileRecord, status: 'VERIFIED' }));
    const put = vi
      .spyOn(api, 'PUT')
      .mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never);
    const { uploaded, blocking } = renderUpload();
    selectFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('req-upload');
    expect(blocking).toHaveBeenLastCalledWith(true);
    expect(uploaded).not.toHaveBeenCalled();
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/files/upload-intents',
      expect.objectContaining({
        body: expect.objectContaining({
          category: 'OPERATION_SCREENSHOT',
          access_level: 'INTERNAL',
          content_type: 'image/png',
          sha256: fileRecord.sha256,
          size: 8,
        }),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: '重试截图校验' }));
    await waitFor(() => expect(uploaded).toHaveBeenCalledWith({ ...fileRecord, status: 'VERIFIED' }));
    expect(blocking).toHaveBeenLastCalledWith(false);
    expect(put).toHaveBeenCalledTimes(1);
    expect((post.mock.calls as unknown[][]).map((call) => call[0])).toEqual([
      '/api/v1/files/upload-intents',
      '/api/v1/files/{file_id}/complete',
      '/api/v1/files/{file_id}/complete',
    ]);
  });
  it('服务端没有返回 VERIFIED 时继续阻塞；abort 失败保留 intent，成功才释放', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockResolvedValueOnce(response(fileRecord))
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(response({ ...fileRecord, status: 'ABORTED' }));
    vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { uploaded, blocking } = renderUpload();
    selectFile();
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未完成可信校验');
    await userEvent.click(screen.getByRole('button', { name: '放弃截图上传' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(blocking).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('上传人工采集截图')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '放弃截图上传' }));
    await waitFor(() => expect(blocking).toHaveBeenLastCalledWith(false));
    expect(uploaded).not.toHaveBeenCalled();
  });
  it('不支持的格式在 intent 之前失败；未知传输不自动发送第二次文件', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockResolvedValueOnce(response({ ...fileRecord, status: 'ABORTED' }));
    const put = vi.spyOn(api, 'PUT').mockRejectedValue(new TypeError('传输连接断开'));
    const { uploaded, blocking } = renderUpload();
    selectFile('image/svg+xml');
    expect(await screen.findByRole('alert')).toHaveTextContent('仅支持');
    expect(post).not.toHaveBeenCalled();
    selectFile();
    expect(await screen.findByText('传输连接断开')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '核对截图状态' })).toBeEnabled();
    expect(blocking).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: '放弃截图上传' }));
    await waitFor(() => expect(blocking).toHaveBeenLastCalledWith(false));
    expect(put).toHaveBeenCalledTimes(1);
    expect(uploaded).not.toHaveBeenCalled();
  });
  it.each(['VERIFIED', 'FAILED', 'ABORTED', 'DELETING', 'DELETED'] as const)(
    'complete回执丢失后核对已提交%s，保留输入并释放阻塞，不重复complete',
    async (status) => {
      const post = vi
        .spyOn(api, 'POST')
        .mockResolvedValueOnce(response(intent))
        .mockRejectedValueOnce(new TypeError('完成回执丢失'));
      vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
      vi.mocked(api.GET).mockResolvedValue(response({ ...fileRecord, status }));
      const { uploaded, blocking } = renderUpload();
      selectFile();
      await userEvent.click(await screen.findByRole('button', { name: '重试截图校验' }));
      await waitFor(() => expect(blocking).toHaveBeenLastCalledWith(false));
      expect(post).toHaveBeenCalledTimes(2);
      if (status === 'VERIFIED') expect(uploaded).toHaveBeenCalledWith({ ...fileRecord, status });
      else expect(uploaded).not.toHaveBeenCalled();
    },
  );
  it('abort已提交但回执丢失后读取ABORTED恢复，不重复非幂等abort', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockResolvedValueOnce(failure())
      .mockRejectedValueOnce(new TypeError('放弃回执丢失'));
    vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { uploaded, blocking } = renderUpload();
    selectFile();
    await userEvent.click(await screen.findByRole('button', { name: '放弃截图上传' }));
    await screen.findByText('放弃回执丢失');
    vi.mocked(api.GET).mockResolvedValue(response({ ...fileRecord, status: 'ABORTED' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃截图上传' }));
    await waitFor(() => expect(blocking).toHaveBeenLastCalledWith(false));
    expect(post).toHaveBeenCalledTimes(3);
    expect(uploaded).not.toHaveBeenCalled();
  });
  it.each(['unmount', 'principal'] as const)('%s 后迟到 complete 不关联文件或释放其他实例的阻塞', async (change) => {
    let release!: (value: never) => void;
    vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { client, view, uploaded, blocking } = renderUpload();
    selectFile();
    await screen.findByText('正在校验截图…');
    if (change === 'unmount') view.unmount();
    else invalidatePrincipalEpoch(client);
    await act(async () => {
      release(response({ ...fileRecord, status: 'VERIFIED' }));
    });
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
  });
  it('失败 intent 的显式恢复仍绑定原主体，不借新 epoch 继续旧上传', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(intent)).mockResolvedValueOnce(failure());
    vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { client, uploaded, blocking } = renderUpload();
    selectFile();
    await screen.findByRole('button', { name: '重试截图校验' });
    invalidatePrincipalEpoch(client);
    await userEvent.click(screen.getByRole('button', { name: '重试截图校验' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('认证主体已经变化');
    expect(post).toHaveBeenCalledTimes(2);
    expect(uploaded).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
  });
});
