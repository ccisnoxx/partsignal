import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppQueryClient } from '@/app/query-client';
import { invalidatePrincipalEpoch } from '@/app/auth/principal-epoch';
import { composeScreenshots } from './screenshot-composition';
import { ScreenshotPreparation } from './screenshot-preparation';

vi.mock('./screenshot-composition', () => ({ composeScreenshots: vi.fn() }));
const resultFile = () => new File(['composite'], 'geo-screenshots.png', { type: 'image/png' });
const images = () => ['first.png', 'second.png'].map((name) => new File(['original'], name, { type: 'image/png' }));
let sequence = 0;
beforeEach(() => {
  sequence = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:local-${++sequence}`);
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(composeScreenshots).mockReset().mockResolvedValue(resultFile());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const client = createAppQueryClient();
  const upload = vi.fn();
  const blocking = vi.fn();
  const content = (disabled = false, locked = false) => (
    <QueryClientProvider client={client}>
      <ScreenshotPreparation disabled={disabled} locked={locked} onBlockingChange={blocking} onUpload={upload} />
    </QueryClientProvider>
  );
  const view = render(content());
  return { client, upload, blocking, view, content };
}
function select(files = images()) {
  fireEvent.change(screen.getByLabelText('上传人工采集截图'), { target: { files } });
}

describe('人工多图本地整理', () => {
  it('键盘排序、追加、移除使旧合成失效，显式上传使用最新顺序的结果', async () => {
    const user = userEvent.setup();
    const { upload, blocking, view } = setup();
    const sources = images();
    select(sources);
    expect(upload).not.toHaveBeenCalled();
    expect(blocking).toHaveBeenLastCalledWith(true);
    const down = screen.getByRole('button', { name: '下移截图 1' });
    down.focus();
    await user.keyboard('{Enter}');
    expect(down).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    expect(composeScreenshots).toHaveBeenLastCalledWith([sources[1], sources[0]], expect.any(AbortSignal));
    expect(await screen.findByRole('img', { name: '按当前顺序合成的完整截图' })).toHaveAttribute('src', 'blob:local-3');
    expect(screen.getByRole('link', { name: '查看原尺寸合成图' })).toHaveAttribute('href', 'blob:local-3');
    expect(screen.getByRole('link', { name: '查看原尺寸合成图' })).toHaveAttribute('rel', 'noopener noreferrer');
    select([new File(['third'], 'third.webp', { type: 'image/webp' })]);
    expect(screen.queryByRole('button', { name: '上传合成截图' })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-3');
    await user.click(screen.getByRole('button', { name: '移除截图 3' }));
    expect(screen.getByLabelText('上传人工采集截图')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    await user.click(await screen.findByRole('button', { name: '上传合成截图' }));
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]![0].name).toBe('geo-screenshots.png');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
  });
  it('非法输入和合成失败保留列表，放弃整理才解除本地阻塞', async () => {
    const user = userEvent.setup();
    const { upload, blocking } = setup();
    select();
    select([new File(['svg'], 'bad.svg', { type: 'image/svg+xml' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    vi.mocked(composeScreenshots).mockRejectedValueOnce(new Error('合成结果不可上传：超过10MiB'));
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('超过10MiB');
    expect(blocking).toHaveBeenLastCalledWith(true);
    expect(upload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '放弃本地截图整理' }));
    expect(blocking).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('删除到一张时上传原文件，单张初选继续直接上传', async () => {
    const user = userEvent.setup();
    const { upload, view, content } = setup();
    const files = images();
    select([files[0]!]);
    expect(upload).toHaveBeenCalledExactlyOnceWith(files[0]);
    select(files);
    await user.click(screen.getByRole('button', { name: '移除截图 2' }));
    await user.click(screen.getByRole('button', { name: '上传所选截图' }));
    expect(upload).toHaveBeenLastCalledWith(files[0]);
    view.rerender(content(true));
    expect(screen.getByRole('button', { name: '上传所选截图' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '放弃本地截图整理' })).toBeEnabled();
    view.rerender(content(false, true));
    expect(screen.getByRole('button', { name: '放弃本地截图整理' })).toBeDisabled();
  });
  it.each(['principal', 'unmount'] as const)('%s 后迟到合成不能创建预览或上传', async (change) => {
    const user = userEvent.setup();
    let finish!: (file: File) => void;
    vi.mocked(composeScreenshots).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { client, upload, view } = setup();
    select();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    const signal = vi.mocked(composeScreenshots).mock.calls[0]![1];
    if (change === 'unmount') view.unmount();
    else invalidatePrincipalEpoch(client);
    await act(async () => finish(resultFile()));
    expect(upload).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    if (change === 'unmount') {
      expect(signal.aborted).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    } else {
      expect(screen.getByRole('alert')).toHaveTextContent('认证主体已经变化');
      expect(screen.queryByRole('button', { name: '上传合成截图' })).not.toBeInTheDocument();
    }
  });
  it('已合成结果绑定原主体，主体变化后不上传，也不追加到旧选择', async () => {
    const user = userEvent.setup();
    const { client, upload } = setup();
    select();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    await screen.findByRole('button', { name: '上传合成截图' });
    invalidatePrincipalEpoch(client);
    await user.click(screen.getByRole('button', { name: '上传合成截图' }));
    select([new File(['new'], 'new.png', { type: 'image/png' })]);
    expect(screen.getByRole('alert')).toHaveTextContent('认证主体已经变化');
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });
  it('显式取消等待合成释放，不丢失本地顺序，可重新合成', async () => {
    const user = userEvent.setup();
    vi.mocked(composeScreenshots).mockImplementationOnce((_files, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const { upload, blocking } = setup();
    select();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    expect(screen.getByRole('button', { name: '合成并预览截图' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '取消合成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已取消合成');
    expect(blocking).toHaveBeenLastCalledWith(true);
    expect(upload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '合成并预览截图' }));
    expect(await screen.findByRole('button', { name: '上传合成截图' })).toBeEnabled();
  });
});
