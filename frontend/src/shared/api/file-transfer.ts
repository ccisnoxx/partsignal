import type { components } from '@/shared/api/generated/schema';

type UploadIntent = components['schemas']['UploadIntent'];

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function transferFile(file: File, intent: UploadIntent) {
  if (intent.upload.method === 'PUT') {
    const response = await fetch(intent.upload.url, {
      method: 'PUT',
      headers: intent.upload.headers,
      body: file,
    });
    if (!response.ok) throw new Error(`对象存储上传失败（HTTP ${response.status}）`);
    return;
  }

  const body = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => body.append(key, value));
  body.append('file', file);
  const response = await fetch(intent.upload.url, {
    method: 'POST',
    headers: intent.upload.headers,
    body,
  });
  if (!response.ok) throw new Error(`对象存储上传失败（HTTP ${response.status}）`);
}

export { sha256File, transferFile };
