import { useEffect, useRef, useState } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { sha256File, transferFile } from '@/shared/api/file-transfer';
import {
  abortGeoFileUpload,
  completeGeoFileUpload,
  createGeoFileUploadIntent,
} from './geo.api';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];

type GeoEvidenceUploadProps = {
  csrfToken: string | null;
  disabled?: boolean;
  onUploaded: (file: FileRecord) => void;
  onBlockingChange?: (blocking: boolean) => void;
};

function useGeoEvidenceUpload({
  csrfToken,
  disabled = false,
  onUploaded,
  onBlockingChange,
}: GeoEvidenceUploadProps) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'aborting' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const [pendingIntent, setPendingIntent] = useState<UploadIntent>();

  const callbacks = useRef({ onUploaded, onBlockingChange });
  useEffect(() => { callbacks.current = { onUploaded, onBlockingChange }; }, [onUploaded, onBlockingChange]);
  const working = useRef(false);

  async function complete(intent: UploadIntent) {
    setPhase('completing');
    setError(undefined);
    try {
      const verified = await completeGeoFileUpload(intent.file.id, csrfToken);
      setPendingIntent(undefined);
      setPhase('idle');
      callbacks.current.onUploaded(verified);
      callbacks.current.onBlockingChange?.(false);
    } catch (reason) {
      setPendingIntent(intent);
      setPhase('failed');
      setError(errorMessage(reason, '确认 GEO 证据上传失败'));
    }
  }

  async function upload(file: File) {
    callbacks.current.onBlockingChange?.(true);
    setPhase('uploading');
    setError(undefined);
    setPendingIntent(undefined);
    const intent = await createGeoFileUploadIntent({
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
        await abortGeoFileUpload(intent.file.id, csrfToken);
      } catch {
        // 原始传输错误更有诊断价值；未完成 intent 仍由服务端过期清理。
      }
      throw reason;
    }
    await complete(intent);
  }

  async function abandon(intent: UploadIntent) {
    if (working.current) return;
    working.current = true;
    setPhase('aborting');
    try {
      await abortGeoFileUpload(intent.file.id, csrfToken);
      setPendingIntent(undefined);
      setError(undefined);
      setPhase('idle');
      callbacks.current.onBlockingChange?.(false);
    } catch (reason) {
      setPhase('failed');
      setError(errorMessage(reason, '放弃 GEO 证据上传失败'));
    } finally {
      working.current = false;
    }
  }

  function startUpload(file: File) {
    if (working.current || disabled || pendingIntent) return;
    working.current = true;
    void upload(file).catch((reason: unknown) => {
      setPhase('failed');
      setError(errorMessage(reason, '上传 GEO 证据失败'));
      callbacks.current.onBlockingChange?.(false);
    }).finally(() => { working.current = false; });
  }

  function retryComplete() {
    if (working.current || disabled || !pendingIntent) return;
    working.current = true;
    void complete(pendingIntent).finally(() => { working.current = false; });
  }

  const busy = phase === 'uploading' || phase === 'completing' || phase === 'aborting';
  return { phase, error, pendingIntent, busy, disabled, startUpload, retryComplete, abandon };
}

type GeoEvidenceUploadController = ReturnType<typeof useGeoEvidenceUpload>;

function GeoEvidenceUploadView({ controller }: { controller: GeoEvidenceUploadController }) {
  const { phase, error, pendingIntent, busy, disabled, startUpload, retryComplete, abandon } = controller;
  return (
    <div className="space-y-2">
      <Input
        accept="image/*"
        aria-label="上传 GEO 证据截图"
        disabled={disabled || busy || Boolean(pendingIntent)}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) startUpload(file);
        }}
        type="file"
      />
      {busy && (
        <p aria-live="polite" className="text-sm text-text-secondary">
          {phase === 'uploading' ? '正在上传 GEO 证据…' : phase === 'aborting' ? '正在放弃 GEO 证据…' : '正在校验 GEO 证据…'}
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="text-sm text-destructive">{error}</span>
          {pendingIntent && (
            <>
              <Button
                disabled={disabled || busy}
                onClick={retryComplete}
                size="sm"
                type="button"
                variant="outline"
              >
                重试校验
              </Button>
              <Button disabled={disabled || busy} onClick={() => void abandon(pendingIntent)} size="sm" type="button" variant="outline">放弃上传</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function GeoEvidenceUpload(props: GeoEvidenceUploadProps) {
  const controller = useGeoEvidenceUpload(props);
  return <GeoEvidenceUploadView controller={controller} />;
}

export { GeoEvidenceUpload, GeoEvidenceUploadView, useGeoEvidenceUpload };
export type { GeoEvidenceUploadController };
export type { GeoEvidenceUploadProps };
