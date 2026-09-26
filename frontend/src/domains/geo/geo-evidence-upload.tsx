import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
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
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'aborting' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const [pendingIntent, setPendingIntent] = useState<UploadIntent>();

  const callbacks = useRef({ onUploaded, onBlockingChange });
  useEffect(() => { callbacks.current = { onUploaded, onBlockingChange }; }, [onUploaded, onBlockingChange]);
  const working = useRef(false);

  async function complete(intent: UploadIntent, continuation: PrincipalContinuation) {
    if (!continuation.isCurrent()) return;
    setPhase('completing');
    setError(undefined);
    try {
      const verified = await completeGeoFileUpload(intent.file.id, csrfToken);
      if (!continuation.isCurrent()) return;
      setPendingIntent(undefined);
      setPhase('idle');
      callbacks.current.onUploaded(verified);
      callbacks.current.onBlockingChange?.(false);
    } catch (reason) {
      if (!continuation.isCurrent()) return;
      setPendingIntent(intent);
      setPhase('failed');
      setError(errorMessage(reason, '确认 GEO 证据上传失败'));
    }
  }

  async function upload(file: File, continuation: PrincipalContinuation) {
    callbacks.current.onBlockingChange?.(true);
    setPhase('uploading');
    setError(undefined);
    setPendingIntent(undefined);
    const digest = await sha256File(file);
    if (!continuation.isCurrent()) return;
    const intent = await createGeoFileUploadIntent({
      access_level: 'INTERNAL',
      category: 'OPERATION_SCREENSHOT',
      content_type: file.type || 'application/octet-stream',
      original_filename: file.name,
      sha256: digest,
      size: file.size,
    }, csrfToken);
    if (!continuation.isCurrent()) return;

    try {
      await transferFile(file, intent);
    } catch (reason) {
      if (!continuation.isCurrent()) return;
      try {
        await abortGeoFileUpload(intent.file.id, csrfToken);
      } catch {
        // 原始传输错误更有诊断价值；未完成 intent 仍由服务端过期清理。
      }
      throw reason;
    }
    if (!continuation.isCurrent()) return;
    await complete(intent, continuation);
  }

  async function abandon(intent: UploadIntent) {
    if (working.current) return;
    const continuation = capturePrincipalContinuation(queryClient);
    working.current = true;
    setPhase('aborting');
    try {
      await abortGeoFileUpload(intent.file.id, csrfToken);
      if (!continuation.isCurrent()) return;
      setPendingIntent(undefined);
      setError(undefined);
      setPhase('idle');
      callbacks.current.onBlockingChange?.(false);
    } catch (reason) {
      if (!continuation.isCurrent()) return;
      setPhase('failed');
      setError(errorMessage(reason, '放弃 GEO 证据上传失败'));
    } finally {
      working.current = false;
    }
  }

  function startUpload(file: File) {
    if (working.current || disabled || pendingIntent) return;
    const continuation = capturePrincipalContinuation(queryClient);
    working.current = true;
    void upload(file, continuation).catch((reason: unknown) => {
      if (!continuation.isCurrent()) return;
      setPhase('failed');
      setError(errorMessage(reason, '上传 GEO 证据失败'));
      callbacks.current.onBlockingChange?.(false);
    }).finally(() => { working.current = false; });
  }

  function retryComplete() {
    if (working.current || disabled || !pendingIntent) return;
    const continuation = capturePrincipalContinuation(queryClient);
    working.current = true;
    void complete(pendingIntent, continuation).finally(() => { working.current = false; });
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
