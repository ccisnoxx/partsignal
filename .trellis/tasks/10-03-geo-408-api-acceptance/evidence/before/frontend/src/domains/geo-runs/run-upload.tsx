import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { sha256File, transferFile } from '@/shared/api/file-transfer';
import type { components } from '@/shared/api/generated/schema';
import { screenshotIssue } from './manual.model';
import { abortRunUpload, completeRunUpload, createRunUploadIntent, readRunUpload } from './runs.api';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];
type RunUploadProps = {
  csrfToken: string | null;
  disabled?: boolean;
  recoveryDisabled?: boolean;
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
  onUploaded: (file: FileRecord) => void;
  onBlockingChange: (blocking: boolean) => void;
};
type PendingUpload = { intent: UploadIntent; transferred: boolean; owner: PrincipalContinuation };

function RunUpload({
  csrfToken,
  disabled = false,
  recoveryDisabled = false,
  inputId,
  describedBy,
  invalid,
  onUploaded,
  onBlockingChange,
}: RunUploadProps) {
  const client = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'aborting' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingUpload>();
  const mounted = useRef(false);
  const working = useRef(false);
  const callbacks = useRef({ onUploaded, onBlockingChange });
  useEffect(() => {
    callbacks.current = { onUploaded, onBlockingChange };
  }, [onUploaded, onBlockingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = phase === 'uploading' || phase === 'completing' || phase === 'aborting';
  const current = (continuation: PrincipalContinuation) => mounted.current && continuation.isCurrent();

  async function complete(upload: PendingUpload, continuation: PrincipalContinuation) {
    if (!current(continuation)) return;
    setPhase('completing');
    setError('');
    try {
      continuation.assertCurrent();
      const file = await completeRunUpload(upload.intent.file.id, csrfToken);
      if (!current(continuation)) return;
      if (file.status !== 'VERIFIED' || !matchesIntent(file, upload.intent.file))
        throw new Error('截图尚未完成可信校验，不能关联到草稿');
      setPending(undefined);
      setPhase('idle');
      callbacks.current.onUploaded(file);
      callbacks.current.onBlockingChange(false);
    } catch (reason) {
      if (!current(continuation)) return;
      setPending(upload);
      setPhase('failed');
      setError(message(reason));
    }
  }
  async function start(file: File) {
    if (working.current || disabled || pending || !mounted.current) return;
    const issue = screenshotIssue(file);
    if (issue) {
      setError(issue);
      return;
    }
    let continuation: PrincipalContinuation | undefined;
    let upload: PendingUpload | undefined;
    try {
      continuation = capturePrincipalContinuation(client);
      working.current = true;
      setPhase('uploading');
      setError('');
      callbacks.current.onBlockingChange(true);
      const digest = await sha256File(file);
      if (!current(continuation)) return;
      const intent = await createRunUploadIntent(
        {
          category: 'OPERATION_SCREENSHOT',
          access_level: 'INTERNAL',
          content_type: file.type,
          original_filename: file.name,
          size: file.size,
          sha256: digest,
        },
        csrfToken,
      );
      if (!current(continuation)) return;
      upload = { intent, transferred: false, owner: continuation };
      setPending(upload);
      continuation.assertCurrent();
      await transferFile(file, intent, csrfToken);
      if (!current(continuation)) return;
      upload = { ...upload, transferred: true };
      setPending(upload);
      await complete(upload, continuation);
    } catch (reason) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setPhase('failed');
      setError(message(reason));
      // 已取得 intent 后，传输结果也可能未知；仅显式 abort 释放阻塞，不重发文件字节。
      if (upload) setPending(upload);
      else callbacks.current.onBlockingChange(false);
    } finally {
      working.current = false;
    }
  }
  async function recover(abandon: boolean) {
    // 已授权 intent 的恢复独立于 Run 写资格；同主体才能完成/放弃，避免资格变化造成恢复死锁。
    if (working.current || recoveryDisabled || !csrfToken || !pending || !mounted.current) return;
    let continuation: PrincipalContinuation | undefined;
    try {
      pending.owner.assertCurrent();
      continuation = capturePrincipalContinuation(client);
      working.current = true;
      // complete/abort 都不是幂等命令，先核对已提交状态再选择恢复动作。
      setPhase('completing');
      setError('');
      const canonical = await readRunUpload(pending.intent.file.id);
      if (!current(continuation)) return;
      if (!matchesIntent(canonical, pending.intent.file)) throw new Error('截图状态与原上传身份不一致');
      if (
        canonical.status === 'VERIFIED' ||
        canonical.status === 'FAILED' ||
        canonical.status === 'ABORTED' ||
        canonical.status === 'DELETING' ||
        canonical.status === 'DELETED'
      ) {
        setPending(undefined);
        setPhase('idle');
        if (canonical.status === 'VERIFIED' && !abandon) callbacks.current.onUploaded(canonical);
        else
          setError(
            canonical.status === 'VERIFIED'
              ? '已解除当前截图关联，未引用文件按服务端保留策略清理。'
              : '上传已终止，输入已保留，请重新选择截图。',
          );
        callbacks.current.onBlockingChange(false);
        return;
      }
      if (canonical.status !== 'PENDING') throw new Error('截图文件当前状态不可恢复，请退出上传');
      if (!abandon) {
        await complete(pending, continuation);
        return;
      }
      setPhase('aborting');
      setError('');
      const file = await abortRunUpload(pending.intent.file.id, csrfToken);
      if (!current(continuation)) return;
      if (file.id !== pending.intent.file.id || file.status !== 'ABORTED') throw new Error('服务端尚未确认放弃上传');
      setPending(undefined);
      setPhase('idle');
      callbacks.current.onBlockingChange(false);
    } catch (reason) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setPhase('failed');
      setError(message(reason));
    } finally {
      working.current = false;
    }
  }
  return (
    <section aria-label="人工采集截图上传" className="space-y-2">
      <p className="text-sm text-text-secondary">
        上传前请裁剪截图，移除账号、凭据、个人信息和无关内容。仅支持 PNG、JPEG、WEBP，最大 10 MiB。
      </p>
      <Input
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label="上传人工采集截图"
        disabled={disabled || busy || Boolean(pending)}
        id={inputId}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void start(file);
        }}
        type="file"
      />
      {busy && (
        <p aria-live="polite" className="text-sm text-text-secondary">
          {phase === 'uploading' ? '正在上传截图…' : phase === 'completing' ? '正在校验截图…' : '正在放弃上传…'}
        </p>
      )}
      {error && (
        <div className="space-y-2 text-sm" role="alert">
          <p className="text-danger">{error}</p>
          {pending && (
            <div className="flex flex-wrap gap-2">
              {
                <Button
                  disabled={recoveryDisabled || busy || !csrfToken}
                  onClick={() => void recover(false)}
                  type="button"
                  variant="outline"
                >
                  {pending.transferred ? '重试截图校验' : '核对截图状态'}
                </Button>
              }
              <Button
                disabled={recoveryDisabled || busy || !csrfToken}
                onClick={() => void recover(true)}
                type="button"
                variant="outline"
              >
                放弃截图上传
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function matchesIntent(file: FileRecord, original: FileRecord) {
  return (
    file.id === original.id &&
    file.category === 'OPERATION_SCREENSHOT' &&
    file.access_level === 'INTERNAL' &&
    file.sha256 === original.sha256 &&
    file.size === original.size &&
    file.content_type === original.content_type
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '截图上传失败，请核对后重试';
}
export { RunUpload };
export type { RunUploadProps };
