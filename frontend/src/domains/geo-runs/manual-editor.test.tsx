import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import type { ManualContext } from './manual.model';
import {
  runId,
  screenshotId,
  actorId,
  initialDraft,
  draftOut,
  context,
  receipt,
  response,
  failure,
  renderEditor,
} from './manual.test-support';
import { runKeys } from './runs.api';

async function replaceAnswer(value: string) {
  const input = await screen.findByLabelText('回答原文');
  await userEvent.clear(input);
  await userEvent.type(input, value);
}
afterEach(() => vi.restoreAllMocks());

describe('人工采集编辑器', () => {
  it.each([401, 403, 404])('人工上下文%d没有可恢复资源时提供退出而非无效重试', async (status) => {
    vi.spyOn(api, 'GET').mockResolvedValue(failure('INACCESSIBLE', status));
    renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent('req-manual');
    expect(screen.queryByRole('button', { name: '重新读取人工录入' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回运行详情' })).toBeEnabled();
  });
  it('保存采用 canonical 草稿；下一次提交包含最后未保存编辑与新 revision', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    let release!: (value: never) => void;
    const put = vi.spyOn(api, 'PUT').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const post = vi.spyOn(api, 'POST').mockResolvedValue(response({ ...receipt, draft_revision: 4 }));
    const { submitted } = renderEditor();
    await replaceAnswer('本地回答');
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      '/api/v1/geo/observation-runs/{run_id}/manual-draft',
      expect.objectContaining({
        body: {
          expected_draft_revision: 3,
          draft: expect.objectContaining({
            answer_text: '本地回答',
            raw_payload_file_id: initialDraft.raw_payload_file_id,
            raw_payload_summary: initialDraft.raw_payload_summary,
          }),
        },
      }),
    );
    expect(screen.getByLabelText('回答原文')).toBeDisabled();
    await act(async () => {
      release(response(draftOut({ ...initialDraft, answer_text: '服务端 canonical 回答' }, 4)));
    });
    await waitFor(() => expect(screen.getByLabelText('回答原文')).toHaveValue('服务端 canonical 回答'));
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(screen.getByText(/草稿 Revision 4/)).toHaveTextContent('已保存');
    await replaceAnswer('最后未保存编辑');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith(runId));
    expect(post).toHaveBeenCalledWith(
      '/api/v1/geo/observation-runs/{run_id}/manual-submit',
      expect.objectContaining({
        body: expect.objectContaining({ answer_text: '最后未保存编辑', expected_draft_revision: 4 }),
        params: expect.objectContaining({
          header: { 'X-CSRF-Token': 'manual-csrf', 'Idempotency-Key': expect.any(String) },
        }),
      }),
    );
    expect(put).toHaveBeenCalledTimes(1);
  });
  it('409 保留全部输入和请求 ID，冻结旧写资格；被动更新不恢复，显式 GET 后比较/采用', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(failure());
    const post = vi.spyOn(api, 'POST');
    const { client } = renderEditor();
    await replaceAnswer('不能丢失的回答');
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    expect(await screen.findByText(/请求 ID：req-manual/)).toBeInTheDocument();
    expect(screen.getByLabelText('回答原文')).toHaveValue('不能丢失的回答');
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    const newer = context({ draft_revision: 9, draft: draftOut({ ...initialDraft, answer_text: '其他人保存' }, 9) });
    act(() => client.setQueryData(runKeys.manual(runId), newer));
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    expect(screen.getByText(/草稿 Revision 3/)).toBeInTheDocument();
    get.mockResolvedValue(response(newer));
    await userEvent.click(screen.getByRole('button', { name: '读取最新上下文并保留输入' }));
    await screen.findByRole('region', { name: '最新服务端草稿供比较' });
    expect(screen.getByLabelText('回答原文')).toHaveValue('不能丢失的回答');
    expect(screen.getByText(/草稿 Revision 9/)).toBeInTheDocument();
    expect(put).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '采用服务端草稿' }));
    expect(screen.getByLabelText('回答原文')).toHaveValue('其他人保存');
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
  });
  it('后台成功读不覆盖 dirty 值或独立 draft_revision 基线', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const put = vi
      .spyOn(api, 'PUT')
      .mockResolvedValue(response(draftOut({ ...initialDraft, answer_text: '本地输入' }, 4)));
    const { client } = renderEditor();
    await replaceAnswer('本地输入');
    act(() =>
      client.setQueryData(
        runKeys.manual(runId),
        context({ draft_revision: 88, draft: draftOut({ ...initialDraft, answer_text: '后台值' }, 88) }),
      ),
    );
    expect(screen.getByLabelText('回答原文')).toHaveValue('本地输入');
    expect(screen.getByText(/草稿 Revision 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: expect.objectContaining({ expected_draft_revision: 3 }) }),
      ),
    );
  });
  it('保存取消旧 manual GET；迟到响应不能覆盖 canonical 保存结果', async () => {
    let release!: (value: never) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(api, 'GET')
      .mockResolvedValueOnce(response(context()))
      .mockImplementationOnce((_path, options) => {
        signal = (options as { signal?: AbortSignal | null } | undefined)?.signal ?? undefined;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
    vi.spyOn(api, 'PUT').mockResolvedValue(response(draftOut({ ...initialDraft, answer_text: 'canonical 新保存' }, 4)));
    const { client } = renderEditor();
    await replaceAnswer('当前编辑');
    let refetch!: Promise<void>;
    act(() => {
      refetch = client.refetchQueries({ queryKey: runKeys.manual(runId), exact: true });
    });
    await waitFor(() => expect(release).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(screen.getByLabelText('回答原文')).toHaveValue('canonical 新保存'));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      release(
        response(context({ draft_revision: 88, draft: draftOut({ ...initialDraft, answer_text: '旧读迟到' }, 88) })),
      );
      await refetch;
    });
    expect(screen.getByLabelText('回答原文')).toHaveValue('canonical 新保存');
    expect(client.getQueryData<ManualContext>(runKeys.manual(runId))?.draft_revision).toBe(4);
  });
  it('待校验截图阻止保存、提交和无提示离开，保留原有已校验关联', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const pending: components['schemas']['FileRecord'] = {
      id: actorId,
      category: 'OPERATION_SCREENSHOT',
      original_filename: 'proof.png',
      object_key: 'screenshots/proof.png',
      content_type: 'image/png',
      size: 8,
      sha256: 'a'.repeat(64),
      access_level: 'INTERNAL',
      status: 'PENDING',
      created_at: '2026-10-02T00:00:00Z',
    };
    const intent: components['schemas']['UploadIntent'] = {
      file: pending,
      upload: {
        method: 'PUT',
        url: `/api/v1/files/${pending.id}/content`,
        headers: { 'Content-Type': 'application/octet-stream' },
        fields: {},
        expires_at: '2026-10-02T00:05:00Z',
      },
    };
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response(intent))
      .mockResolvedValueOnce(failure('FILE_PENDING', 503));
    vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
    const { client } = renderEditor();
    await replaceAnswer('截图等待期间的修改');
    fireEvent.change(screen.getByLabelText('上传人工采集截图'), {
      target: { files: [new NodeFile(['evidence'], 'proof.png', { type: 'image/png' })] },
    });
    await screen.findByRole('button', { name: '重试截图校验' });
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    expect(screen.getByText(`已校验截图：${screenshotId}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回运行详情' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('截图尚未确认完成');
    expect(post).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    get.mockResolvedValue(failure('FORBIDDEN', 403));
    await act(async () => {
      await client.refetchQueries({ queryKey: runKeys.manual(runId), exact: true });
    });
    expect(screen.getByRole('button', { name: '放弃截图上传' })).toBeEnabled();
    get.mockImplementation(async (path) =>
      path === '/api/v1/files/{file_id}' ? response(pending) : failure('FORBIDDEN', 403),
    );
    post.mockResolvedValueOnce(response({ ...pending, status: 'ABORTED' }));
    await userEvent.click(screen.getByRole('button', { name: '放弃截图上传' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '读取最新上下文并保留输入' })).toBeEnabled());
    expect(screen.getByText(`已校验截图：${screenshotId}`)).toBeInTheDocument();
  });
  it('响应未知时保留同一 key 和 payload，仅显式安全恢复，不自动重发', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(new TypeError('响应连接丢失'))
      .mockResolvedValueOnce(response(receipt));
    const { submitted } = renderEditor();
    await replaceAnswer('未知结果的最后编辑');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    expect(await screen.findByText(/提交结果未知/)).toBeInTheDocument();
    expect(screen.getByLabelText('回答原文')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '使用同一请求安全重试' }));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith(runId));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  });
  it('畸形 201 回执视为未知结果，保留 payload/key，不触发成功导航', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(response({ run_id: runId }))
      .mockResolvedValueOnce(response(receipt));
    const { submitted } = renderEditor();
    await screen.findByLabelText('回答原文');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    expect(await screen.findByText(/提交回执不完整/)).toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '使用同一请求安全重试' }));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith(runId));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  });
  it('未知提交的显式恢复绑定发起主体，不能在新 epoch 下发送旧 payload', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = vi.spyOn(api, 'POST').mockRejectedValueOnce(new TypeError('响应未知'));
    const { client, submitted } = renderEditor();
    await screen.findByLabelText('回答原文');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    await screen.findByText(/提交结果未知/);
    invalidatePrincipalEpoch(client);
    await userEvent.click(screen.getByRole('button', { name: '使用同一请求安全重试' }));
    expect(await screen.findByText(/认证主体已经变化/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
  });
  it('畸形保存回执保留本地草稿和原 revision，显式 GET 才可重新建立基线', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    vi.spyOn(api, 'PUT').mockResolvedValue(response({ run_id: runId, draft_revision: 4, draft: {} }));
    renderEditor();
    await replaceAnswer('不能被畸形回执清空');
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    expect(await screen.findByText(/保存回执不完整/)).toBeInTheDocument();
    expect(screen.getByLabelText('回答原文')).toHaveValue('不能被畸形回执清空');
    expect(screen.getByText(/草稿 Revision 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '读取最新上下文并保留输入' })).toBeEnabled();
  });
  it('明确 422 不自动重放；输入修改后显式提交形成新的幂等请求', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(failure('VALIDATION_ERROR', 422))
      .mockResolvedValueOnce(response(receipt));
    const { submitted } = renderEditor();
    await replaceAnswer('第一次内容');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    await screen.findByText(/请求 ID：req-manual/);
    expect(screen.getByLabelText('回答原文')).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(1);
    await replaceAnswer('人工修正后的内容');
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    await waitFor(() => expect(submitted).toHaveBeenCalled());
    const calls = post.mock.calls as unknown as [string, { params: { header: Record<string, string> } }][];
    const first = calls[0]?.[1].params.header;
    const second = calls[1]?.[1].params.header;
    expect(second?.['Idempotency-Key']).not.toBe(first?.['Idempotency-Key']);
  });
  it('仅服务端 action 决定写资格；初始无权限有真实错误和返回入口', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context({ available_actions: [] })));
    const put = vi.spyOn(api, 'PUT');
    const post = vi.spyOn(api, 'POST');
    const { view } = renderEditor();
    await screen.findByLabelText('回答原文');
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    expect(screen.getByLabelText('上传人工采集截图')).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    view.unmount();
    get.mockResolvedValue(failure('FORBIDDEN', 403));
    renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent('req-manual');
    expect(screen.queryByLabelText('回答原文')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回运行详情' })).toBeEnabled();
  });
  it('后台读取失败保留可见输入但停止旧资格，仅显式读取恢复', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const { client } = renderEditor();
    await replaceAnswer('读取失败仍保留');
    get.mockResolvedValue(failure('FORBIDDEN', 403));
    await act(async () => {
      await client.refetchQueries({ queryKey: runKeys.manual(runId), exact: true });
    });
    expect(await screen.findByText(/后台读取失败/)).toBeInTheDocument();
    expect(screen.getByLabelText('回答原文')).toHaveValue('读取失败仍保留');
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    act(() => client.setQueryData(runKeys.manual(runId), context()));
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    expect(screen.getByText(/后台读取失败/)).toHaveTextContent('req-manual');
    get.mockResolvedValue(response(context()));
    await userEvent.click(screen.getByRole('button', { name: '读取最新上下文并保留输入' }));
    await waitFor(() => expect(screen.getByLabelText('回答原文')).toBeEnabled());
    expect(screen.getByLabelText('回答原文')).toHaveValue('读取失败仍保留');
  });
  it('脏草稿允许筛选变化，退出编辑与 pathname 变化触发离开保护', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const { router } = renderEditor();
    await replaceAnswer('脏输入');
    await userEvent.click(screen.getByRole('button', { name: '改变筛选' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'changed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回运行详情' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('回答原文')).toHaveValue('脏输入');
    await userEvent.click(screen.getByRole('button', { name: '去计划' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it('HTML_TEXT 只作为文本；Markdown 预览不执行 HTML、图片或 javascript URL', async () => {
    const malicious =
      '<img src=x onerror=alert(1)>\n[危险](javascript:alert(1))\n![外链](https://example.com/image.png)';
    vi.spyOn(api, 'GET').mockResolvedValue(
      response(context({ draft: draftOut({ ...initialDraft, answer_format: 'HTML_TEXT', answer_text: malicious }) })),
    );
    renderEditor();
    expect(await screen.findByLabelText('回答原文')).toHaveValue(malicious);
    expect(document.querySelector('img')).toBeNull();
    const user = userEvent.setup();
    screen.getByRole('combobox', { name: '答案格式' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Markdown' }));
    const preview = await screen.findByRole('article', { name: '回答 Markdown 安全预览' });
    expect(preview.querySelector('img')).toBeNull();
    expect(preview.querySelector('[onerror]')).toBeNull();
    expect(within(preview).queryByRole('link', { name: '危险' })).not.toBeInTheDocument();
  });
  it.each(['unmount', 'principal'] as const)('%s 后迟到保存不重置新身份的表单或 cache', async (change) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    let release!: (value: never) => void;
    vi.spyOn(api, 'PUT').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { client, view } = renderEditor();
    await replaceAnswer('等待保存');
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(release).toBeDefined());
    if (change === 'unmount') view.unmount();
    else invalidatePrincipalEpoch(client);
    await act(async () => {
      release(response(draftOut({ ...initialDraft, answer_text: '迟到 canonical' }, 4)));
    });
    expect(client.getQueryData<ManualContext>(runKeys.manual(runId))?.draft_revision).toBe(3);
    if (change === 'principal') expect(screen.getByLabelText('回答原文')).toHaveValue('等待保存');
  });
});
import { File as NodeFile } from 'node:buffer';
