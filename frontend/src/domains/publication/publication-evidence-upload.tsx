import { useState } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { sha256File, transferFile } from '@/shared/api/file-transfer';
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
  onBusyChange: (busy: boolean) => void;
  onUploaded: (file: FileRecord) => void;
};

function PublicationEvidenceUpload({
  csrfToken,
  disabled = false,
  onBusyChange,
  onUploaded,
}: PublicationEvidenceUploadProps) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const [pendingIntent, setPendingIntent] = useState<UploadIntent>();

  async function complete(intent: UploadIntent) {
    setPhase('completing');
    onBusyChange(true);
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
    } finally {
      onBusyChange(false);
    }
  }

  async function upload(file: File) {
    setPhase('uploading');
    onBusyChange(true);
    setError(undefined);
    setPendingIntent(undefined);
    const intent = await createFileUploadIntent({
      access_level: 'INTERNAL',
      category: 'OPERATION_SCREENSHOT',
      content_type: file.type || 'application/octet-stream',
      original_filename: file.name,
      sha256: await sha256File(file),
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
            onBusyChange(false);
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

export { PublicationEvidenceUpload };
export type { PublicationEvidenceUploadProps };
