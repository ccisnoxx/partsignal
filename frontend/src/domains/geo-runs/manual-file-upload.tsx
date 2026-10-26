import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { sha256File, transferFile } from '@/shared/api/file-transfer';
import type { components } from '@/shared/api/generated/schema';
import { rawTextIssue, screenshotIssue } from './manual.model';
import { abortRunUpload, completeRunUpload, createRunUploadIntent, readRunUpload } from './runs.api';

type FileRecord = components['schemas']['FileRecord'];
type UploadIntent = components['schemas']['UploadIntent'];
type PendingUpload = { intent: UploadIntent; transferred: boolean; owner: PrincipalContinuation };
type ManualFileUploadProps = {
  csrfToken: string | null;
  disabled?: boolean;
  recoveryDisabled?: boolean;
  onUploaded: (file: FileRecord) => void;
  onBlockingChange: (blocking: boolean) => void;
};
const policies = {
  SCREENSHOT: { label: '截图', category: 'OPERATION_SCREENSHOT', issue: screenshotIssue },
  RAW_TEXT: { label: '原始文本证据', category: 'EVIDENCE', issue: rawTextIssue },
} as const;
type Policy = (typeof policies)[keyof typeof policies];

function useManualFileUpload({
  kind, csrfToken, disabled = false, recoveryDisabled = false, onUploaded, onBlockingChange,
}: ManualFileUploadProps & { kind: keyof typeof policies }) {
  const policy = policies[kind];
  const client = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'completing' | 'aborting' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingUpload>();
  const [verifiedSequence, setVerifiedSequence] = useState(0);
  const mounted = useRef(false);
  const working = useRef(false);
  const callbacks = useRef({ onUploaded, onBlockingChange });
  useEffect(() => { callbacks.current = { onUploaded, onBlockingChange }; }, [onUploaded, onBlockingChange]);
  const busy = phase === 'uploading' || phase === 'completing' || phase === 'aborting';
  useEffect(() => { callbacks.current.onBlockingChange(busy || Boolean(pending)); }, [busy, pending]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = (continuation: PrincipalContinuation) => mounted.current && continuation.isCurrent();
  async function complete(upload: PendingUpload, continuation: PrincipalContinuation) {
    if (!current(continuation)) return;
    setPhase('completing');
    setError('');
    try {
      continuation.assertCurrent();
      const file = await completeRunUpload(upload.intent.file.id, csrfToken);
      if (!current(continuation)) return;
      if (file.status !== 'VERIFIED' || !matchesIntent(file, upload.intent.file, policy))
        throw new Error(`${policy.label}尚未完成可信校验，不能关联到草稿`);
      setPending(undefined);
      setPhase('idle');
      callbacks.current.onUploaded(file);
      setVerifiedSequence((key) => key + 1);
    } catch (reason) {
      if (!current(continuation)) return;
      setPending(upload);
      setPhase('failed');
      setError(message(reason));
    }
  }
  async function start(file: File) {
    if (working.current || disabled || pending || !mounted.current) return;
    const issue = policy.issue(file);
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
      const digest = await sha256File(file);
      if (!current(continuation)) return;
      const metadata = {
        category: policy.category,
        access_level: 'INTERNAL' as const,
        content_type: file.type,
        original_filename: file.name,
        size: file.size,
        sha256: digest,
      };
      const intent = await createRunUploadIntent(metadata, csrfToken);
      if (!current(continuation)) return;
      if (intent.file.status !== 'PENDING' || !matchesMetadata(intent.file, metadata))
        throw new Error(`${policy.label}上传意图与所选文件不一致，未发送文件内容`);
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
      if (!matchesIntent(canonical, pending.intent.file, policy)) throw new Error(`${policy.label}状态与原上传身份不一致`);
      if (
        canonical.status === 'VERIFIED' ||
        canonical.status === 'FAILED' ||
        canonical.status === 'ABORTED' ||
        canonical.status === 'DELETING' ||
        canonical.status === 'DELETED'
      ) {
        setPending(undefined);
        setPhase('idle');
        if (canonical.status === 'VERIFIED' && !abandon) {
          callbacks.current.onUploaded(canonical);
          setVerifiedSequence((key) => key + 1);
        }
        else
          setError(
            canonical.status === 'VERIFIED'
              ? `已放弃本次${policy.label}关联，原有文件引用保留，未引用文件按服务端保留策略清理。`
              : `上传已终止，输入已保留，请重新选择${policy.label}。`,
          );
        return;
      }
      if (canonical.status !== 'PENDING') throw new Error(`${policy.label}文件当前状态不可恢复，请退出上传`);
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
    } catch (reason) {
      if (!mounted.current || (continuation && !continuation.isCurrent())) return;
      setPhase('failed');
      setError(message(reason));
    } finally {
      working.current = false;
    }
  }
  return { phase, error, pending, busy, start, recover, verifiedSequence, label: policy.label,
    recoveryBlocked: recoveryDisabled || busy || !csrfToken };
}

type UploadState = ReturnType<typeof useManualFileUpload>;
function ManualUploadFeedback({ upload }: { upload: UploadState }) {
  return (
    <>
      {upload.busy && <p aria-live="polite" className="text-sm text-text-secondary">
        {upload.phase === 'uploading' ? `正在上传${upload.label}…` : upload.phase === 'completing' ? `正在校验${upload.label}…` : `正在放弃${upload.label}上传…`}
      </p>}
      {upload.error && <div className="space-y-2 text-sm" role="alert">
        <p className="text-danger">{upload.error}</p>
        {upload.pending && <div className="flex flex-wrap gap-2">
          <Button disabled={upload.recoveryBlocked} onClick={() => void upload.recover(false)} type="button" variant="outline">
            {upload.pending.transferred ? `重试${upload.label}校验` : `核对${upload.label}状态`}
          </Button>
          <Button disabled={upload.recoveryBlocked} onClick={() => void upload.recover(true)} type="button" variant="outline">放弃{upload.label}上传</Button>
        </div>}
      </div>}
    </>
  );
}
function matchesMetadata(file: FileRecord, metadata: Pick<FileRecord, 'category' | 'access_level' | 'content_type' | 'size' | 'sha256'>) {
  return file.category === metadata.category && file.access_level === metadata.access_level &&
    file.content_type === metadata.content_type && file.size === metadata.size && file.sha256 === metadata.sha256;
}
function matchesIntent(file: FileRecord, original: FileRecord, policy: Policy) {
  return file.id === original.id && file.category === policy.category &&
    !policy.issue({ type: file.content_type, size: file.size }) && matchesMetadata(file, original);
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '证据上传失败，请核对后重试';
}
export { useManualFileUpload, ManualUploadFeedback };
export type { ManualFileUploadProps };
