import { screenshotIssue } from './manual.model';

const maxSide = 16384;
const maxPixels = 32_000_000;

async function composeScreenshots(files: File[], signal: AbortSignal): Promise<File> {
  let width = 0;
  let height = 0;
  // 分两遍顺序解码，避免把全部原图位图同时保留在内存中。
  for (const file of files) {
    signal.throwIfAborted();
    const bitmap = await decode(file);
    try {
      signal.throwIfAborted();
      width = Math.max(width, bitmap.width);
      height += bitmap.height;
      if (width > maxSide || height > maxSide || width * height > maxPixels)
        throw new Error('截图合成超过本地容量（单边 16384 像素、总计 3200 万像素），请减少截图或在本地整理后上传；不会自动缩小原图');
    } finally {
      bitmap.close();
    }
  }
  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建截图画布，请在本地合成后使用单张上传');
    let top = 0;
    for (const file of files) {
      signal.throwIfAborted();
      const bitmap = await decode(file);
      try {
        signal.throwIfAborted();
        context.drawImage(bitmap, 0, top);
        top += bitmap.height;
      } finally {
        bitmap.close();
      }
    }
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('截图编码失败，请减少截图或在本地合成后上传')), 'image/png');
    });
    signal.throwIfAborted();
    const result = new File([blob], 'geo-screenshots.png', { type: 'image/png' });
    const issue = screenshotIssue(result);
    if (issue) throw new Error(`合成结果不可上传：${issue}。请减少截图或在本地整理后上传，当前顺序已保留`);
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function decode(file: File) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(`无法读取截图“${file.name}”，请确认文件未损坏；也可在本地合成后使用单张上传`);
  }
}

export { composeScreenshots };
