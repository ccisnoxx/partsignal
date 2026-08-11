import { useState } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import {
  abortFileUpload,
  completeFileUpload,
  createFileUploadIntent,
} from './publication.api';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];

type PublicationEvidenceUploadProps = {
  csrfToken: string | null;
  disabled?: boolean;
  onUploaded: (file: FileRecord) => void;
};

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function PublicationEvidenceUpload({
  csrfToken,
  disabled = false,
  onUploaded,
}: PublicationEvidenceUploadProps) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const [pendingIntent, setPendingIntent] = useState<UploadIntent>();

  async function complete(intent: UploadIntent) {
    setPhase('completing');
    setError(undefined);
    try {
      const verified = await completeFileUpload(intent.file.id, csrfToken);
      setPendingIntent(undefined);
      setPhase('idle');
      onUploaded(verified);
    } catch (reason) {
      setPendingIntent(intent);
      setPhase('failed');
      setError(reason instanceof Error ? reason.message : '确认文件上传失败');
    }
  }

  async function upload(file: File) {
    setPhase('uploading');
    setError(undefined);
    setPendingIntent(undefined);
    const intent = await createFileUploadIntent({
      access_level: 'INTERNAL',
      category: 'OPERATION_SCREENSHOT',
      content_type: file.type || 'application/octet-stream',
      original_filename: file.name,
      sha256: await sha256(file),
      size: file.size,
    }, csrfToken);

    try {
      await transferFile(file, intent);
    } catch (reason) {
      try {
        await abortFileUpload(intent.file.id, csrfToken);
      } catch {
        // 原始对象传输错误更有诊断价值；中止失败由服务端过期清理兜底。
      }
      throw reason;
    }
    await complete(intent);
  }

  const busy = phase === 'uploading' || phase === 'completing';

  return (
    <div className="space-y-2">
      <Input
        accept="image/*"
        aria-label="上传发布证据截图"
        disabled={disabled || busy || Boolean(pendingIntent)}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          void upload(file).catch((reason: unknown) => {
            setPhase('failed');
            setError(reason instanceof Error ? reason.message : '上传证据失败');
          });
        }}
        type="file"
      />
      {busy && <p aria-live="polite" className="text-sm text-text-secondary">{phase === 'uploading' ? '正在上传证据…' : '正在校验证据…'}</p>}
      {error && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="text-sm text-destructive">{error}</span>
          {pendingIntent && (
            <Button
              disabled={disabled}
              onClick={() => void complete(pendingIntent)}
              size="sm"
              type="button"
              variant="outline"
            >
              重试校验
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export { PublicationEvidenceUpload, sha256, transferFile };
export type { PublicationEvidenceUploadProps };
