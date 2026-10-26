import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeScreenshots } from './screenshot-composition';

const dimensions: Record<string, [number, number]> = { 'first.png': [800, 600], 'second.png': [500, 300] };
let bitmaps: ImageBitmap[];
let draw: ReturnType<typeof vi.fn>;
beforeEach(() => {
  bitmaps = [];
  draw = vi.fn();
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => {
    const [width, height] = dimensions[file.name]!;
    const bitmap = { width, height, close: vi.fn() } as unknown as ImageBitmap;
    bitmaps.push(bitmap);
    return bitmap;
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['encoded-png'], { type: 'image/png' })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const images = () => ['first.png', 'second.png'].map((name) => new File(['original'], name, { type: 'image/png' }));
function canvas() {
  return vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement;
}

describe('截图合成的浏览器图像I/O合同', () => {
  it('按传入顺序原尺寸左对齐拼接，输出PNG且关闭所有位图和画布', async () => {
    const input = images().reverse();
    let size: [number, number] | undefined;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (this: HTMLCanvasElement, callback) {
      size = [this.width, this.height];
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    const result = await composeScreenshots(input, new AbortController().signal);
    expect(size).toEqual([800, 900]);
    expect(draw.mock.calls.map(([bitmap, x, y]) => [bitmap.width, bitmap.height, x, y])).toEqual([
      [500, 300, 0, 0], [800, 600, 0, 300],
    ]);
    expect(draw.mock.calls.every((call) => call.length === 3)).toBe(true);
    expect(result.type).toBe('image/png');
    expect(await Promise.all(input.map((file) => file.text()))).toEqual(['original', 'original']);
    expect(bitmaps).toHaveLength(4);
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(canvas().width).toBe(0);
    expect(canvas().height).toBe(0);
  });
  it.each([[20000, 100], [8000, 5000]])('尺寸%s×%s超出容量时不分配绘制画布，已解码位图关闭', async (width, height) => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width, height, close } as unknown as ImageBitmap);
    await expect(composeScreenshots(images(), new AbortController().signal)).rejects.toThrow('超过本地容量');
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('坏图明确失败，前面已读取的位图已释放', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'));
    await expect(composeScreenshots(images(), new AbortController().signal)).rejects.toThrow('无法读取截图');
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });
  it('编码失败释放画布，不能返回成功文件', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));
    await expect(composeScreenshots(images(), new AbortController().signal)).rejects.toThrow('截图编码失败');
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(canvas().width).toBe(0);
  });
  it('合成PNG超过10MiB时明确失败，不自动缩放或有损压缩', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])));
    await expect(composeScreenshots(images(), new AbortController().signal)).rejects.toThrow('合成结果不可上传');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/png');
    expect(canvas().height).toBe(0);
  });
  it('取消后的迟到解码仍关闭位图，不进入画布或输出', async () => {
    let finish!: (bitmap: ImageBitmap) => void;
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const result = composeScreenshots(images(), controller.signal);
    controller.abort();
    finish({ width: 800, height: 600, close } as unknown as ImageBitmap);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });
  it('绘制期间取消，清空画布并关闭当前位图，不编码输出', async () => {
    const controller = new AbortController();
    draw.mockImplementationOnce(() => controller.abort());
    await expect(composeScreenshots(images(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(canvas().width).toBe(0);
  });
  it('画布不可用时明确失败', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(composeScreenshots(images(), new AbortController().signal)).rejects.toThrow('浏览器无法创建截图画布');
    expect(canvas().height).toBe(0);
  });
  it('编码期间取消后迟到Blob不能成为结果，画布仍会释放', async () => {
    let finish!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { finish = callback; });
    const controller = new AbortController();
    const pending = composeScreenshots(images(), controller.signal);
    await vi.waitFor(() => expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce());
    controller.abort();
    finish(new Blob(['late'], { type: 'image/png' }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvas().width).toBe(0);
    bitmaps.forEach((bitmap) => expect(bitmap.close).toHaveBeenCalledOnce());
  });
});
