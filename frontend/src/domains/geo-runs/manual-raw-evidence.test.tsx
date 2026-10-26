import { File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { runKeys } from './runs.api';
import {
  runId, initialDraft, context, draftOut, receipt, response, failure, renderEditor,
} from './manual.test-support';

const rawId = '10000000-0000-4000-8000-000000000005';
const imageId = '10000000-0000-4000-8000-000000000006';
const serverId = '10000000-0000-4000-8000-000000000007';
const unknownSummary = { schema_version: 1 as const, payload_format: null, payload_bytes: null, finish_reason: null };
function fixture(id: string, category: 'EVIDENCE' | 'OPERATION_SCREENSHOT') {
  const bytes = category === 'EVIDENCE' ? 'raw-body' : 'evidence';
  const file = new NodeFile([bytes], category === 'EVIDENCE' ? 'raw.txt' : 'screen.png', { type: category === 'EVIDENCE' ? 'text/plain' : 'image/png' });
  const record: components['schemas']['FileRecord'] = {
    id, category, original_filename: file.name, object_key: `evidence/${id}`, content_type: file.type,
    size: file.size, sha256: createHash('sha256').update(bytes).digest('hex'),
    access_level: 'INTERNAL', status: 'PENDING', created_at: '2026-10-02T00:00:00Z',
  };
  const intent: components['schemas']['UploadIntent'] = {
    file: record, upload: { method: 'PUT', url: `/api/v1/files/${id}/content`, headers: { 'Content-Type': 'application/octet-stream' }, fields: {}, expires_at: '2026-10-02T00:05:00Z' },
  };
  return { file, record, intent };
}
const raw = fixture(rawId, 'EVIDENCE');
const image = fixture(imageId, 'OPERATION_SCREENSHOT');
type Request = { body?: unknown; params?: { path?: { file_id?: string } } };
function mockUploads(complete?: (id: string) => Promise<never>, draftRevision = 3) {
  return vi.spyOn(api, 'POST').mockImplementation(async (path: string, request?: unknown) => {
    const options = request as Request;
    if (path === '/api/v1/files/upload-intents') {
      const category = (options.body as components['schemas']['UploadIntentCreate']).category;
      return response(category === 'EVIDENCE' ? raw.intent : image.intent);
    }
    if (path === '/api/v1/files/{file_id}/complete') {
      const id = options.params?.path?.file_id;
      if (complete) return complete(id!);
      return response({ ...(id === rawId ? raw.record : image.record), status: 'VERIFIED' });
    }
    if (path === '/api/v1/geo/observation-runs/{run_id}/manual-submit') return response({ ...receipt, draft_revision: draftRevision });
    throw new Error(`意外请求 ${path}`);
  });
}
function transfer() {
  return vi.spyOn(api, 'PUT').mockResolvedValue({ response: new Response(null, { status: 204 }) } as never);
}
function selectRaw() {
  fireEvent.change(screen.getByLabelText('上传原始文本证据'), { target: { files: [raw.file] } });
}
async function uploadRaw() {
  await screen.findByLabelText('上传原始文本证据');
  selectRaw();
  await screen.findByText(`已校验原始文本证据：${rawId}`);
}
afterEach(() => vi.restoreAllMocks());

describe('人工表单的原始文本关联', () => {
  it('VERIFIED替换旧ID，草稿保存采用canonical后提交新ID；回答不被文件内容覆盖', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = mockUploads(undefined, 4);
    const put = vi.spyOn(api, 'PUT').mockImplementation(async (path: string) => {
      if (path === '/api/v1/geo/observation-runs/{run_id}/manual-draft')
        return response(draftOut({ ...initialDraft, raw_payload_file_id: rawId, raw_payload_summary: unknownSummary }, 4));
      return { response: new Response(null, { status: 204 }) } as never;
    });
    const { submitted } = renderEditor();
    await uploadRaw();
    expect(screen.getByLabelText('回答原文')).toHaveValue(initialDraft.answer_text);
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(screen.getByText(/草稿 Revision 4/)).toHaveTextContent('已保存'));
    expect(put).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/manual-draft', expect.objectContaining({
      body: { expected_draft_revision: 3, draft: expect.objectContaining({ raw_payload_file_id: rawId, raw_payload_summary: undefined, answer_text: initialDraft.answer_text }) },
    }));
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith(runId));
    expect(post).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/manual-submit', expect.objectContaining({
      body: expect.objectContaining({ raw_payload_file_id: rawId, raw_payload_summary: unknownSummary, expected_draft_revision: 4 }),
    }));
    expect(post).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenCalledWith('/api/v1/files/{file_id}/content', expect.objectContaining({ body: raw.file }));
  });
  it('显式移除旧关联发送null，不自动删除文件或重新带回旧ID/摘要', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const put = vi.spyOn(api, 'PUT').mockResolvedValue(response(draftOut({ ...initialDraft, raw_payload_file_id: null, raw_payload_summary: unknownSummary }, 4)));
    const remove = vi.spyOn(api, 'DELETE');
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: '移除原始文本证据关联' }));
    expect(screen.getByText('尚未关联原始文本证据')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/v1/geo/observation-runs/{run_id}/manual-draft', expect.objectContaining({
      body: expect.objectContaining({ draft: expect.objectContaining({ raw_payload_file_id: null, raw_payload_summary: undefined }) }),
    })));
    expect(remove).not.toHaveBeenCalled();
  });
  it('409后显式重读保留本地rawID，采用服务端草稿才换成服务端ID', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    mockUploads();
    const put = vi.spyOn(api, 'PUT').mockImplementation(async (path: string) =>
      path === '/api/v1/files/{file_id}/content' ? ({ response: new Response(null, { status: 204 }) } as never) : failure(),
    );
    renderEditor();
    await uploadRaw();
    await userEvent.click(screen.getByRole('button', { name: '保存人工草稿' }));
    await screen.findByText(/服务端拒绝当前人工操作/);
    const serverDraft = { ...initialDraft, raw_payload_file_id: serverId };
    get.mockResolvedValue(response(context({ draft_revision: 7, draft: draftOut(serverDraft, 7) })));
    await userEvent.click(screen.getByRole('button', { name: '读取最新上下文并保留输入' }));
    await screen.findByRole('button', { name: '采用服务端草稿' });
    expect(screen.getByText(`已校验原始文本证据：${rawId}`)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '采用服务端草稿' }));
    expect(screen.getByText(`已校验原始文本证据：${serverId}`)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('文本校验失败保留原关联和未保存回答，403后仍可同主体放弃原上传', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const post = vi.spyOn(api, 'POST').mockResolvedValueOnce(response(raw.intent)).mockResolvedValueOnce(failure('FILE_PENDING', 503)).mockResolvedValueOnce(response({ ...raw.record, status: 'ABORTED' }));
    transfer();
    const { client } = renderEditor();
    const answer = await screen.findByLabelText('回答原文');
    await userEvent.clear(answer);
    await userEvent.type(answer, '未保存的回答');
    selectRaw();
    await screen.findByRole('button', { name: '重试原始文本证据校验' });
    expect(screen.getByText(`已校验原始文本证据：${initialDraft.raw_payload_file_id}`)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '返回运行详情' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('证据尚未确认完成');
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    get.mockResolvedValue(failure('FORBIDDEN', 403));
    await act(async () => { await client.refetchQueries({ queryKey: runKeys.manual(runId), exact: true }); });
    expect(screen.getByRole('button', { name: '放弃原始文本证据上传' })).toBeEnabled();
    get.mockResolvedValue(response(raw.record));
    await userEvent.click(screen.getByRole('button', { name: '放弃原始文本证据上传' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '读取最新上下文并保留输入' })).toBeEnabled());
    expect(screen.getByLabelText('回答原文')).toHaveValue('未保存的回答');
    expect(screen.getByText(`已校验原始文本证据：${initialDraft.raw_payload_file_id}`)).toBeVisible();
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('双上传独立：截图完成不得解除仍待文本校验的保存/提交阻塞', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context()));
    const finish = new Map<string, (value: never) => void>();
    mockUploads((id) => new Promise((resolve) => { finish.set(id, resolve); }));
    const put = transfer();
    renderEditor();
    await screen.findByLabelText('上传人工采集截图');
    fireEvent.change(screen.getByLabelText('上传人工采集截图'), { target: { files: [image.file] } });
    await screen.findByText('正在校验截图…');
    selectRaw();
    await screen.findByText('正在校验原始文本证据…');
    await act(async () => finish.get(imageId)!(response({ ...image.record, status: 'VERIFIED' })));
    expect(screen.getByText(`已校验截图：${imageId}`)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移除原始文本证据关联' })).toBeDisabled();
    await act(async () => finish.get(rawId)!(response({ ...raw.record, status: 'VERIFIED' })));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存人工草稿' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '正式提交人工观测' })).toBeEnabled();
    expect(put).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('require_screenshot=%s：原始文本遵守冻结截图要求', async (required) => {
    vi.spyOn(api, 'GET').mockResolvedValue(response(context({ require_screenshot: required, draft: draftOut({ ...initialDraft, screenshot_file_id: null, raw_payload_file_id: null }) })));
    const post = mockUploads();
    transfer();
    const { submitted } = renderEditor();
    await uploadRaw();
    await userEvent.click(screen.getByRole('button', { name: '正式提交人工观测' }));
    if (required) {
      expect(await screen.findAllByText('冻结配置要求截图，请先上传并完成校验')).not.toHaveLength(0);
      expect(submitted).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(2);
    } else {
      await waitFor(() => expect(submitted).toHaveBeenCalledWith(runId));
      expect(post).toHaveBeenLastCalledWith('/api/v1/geo/observation-runs/{run_id}/manual-submit', expect.objectContaining({ body: expect.objectContaining({ raw_payload_file_id: rawId, screenshot_file_id: null }) }));
    }
  });
});
