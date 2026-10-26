import { useEffect, useRef, useState } from 'react';
import { ScreenshotPreparation } from './screenshot-preparation';
import { ManualUploadFeedback, useManualFileUpload, type ManualFileUploadProps } from './manual-file-upload';

type RunUploadProps = ManualFileUploadProps & { inputId?: string; describedBy?: string; invalid?: boolean };
function RunUpload({ inputId, describedBy, invalid, onBlockingChange, ...props }: RunUploadProps) {
  const [preparationBlocking, setPreparationBlocking] = useState(false);
  const [networkBlocking, setNetworkBlocking] = useState(false);
  const callback = useRef(onBlockingChange);
  useEffect(() => { callback.current = onBlockingChange; }, [onBlockingChange]);
  useEffect(() => { callback.current(preparationBlocking || networkBlocking); }, [preparationBlocking, networkBlocking]);
  const upload = useManualFileUpload({ ...props, kind: 'SCREENSHOT', onBlockingChange: setNetworkBlocking });
  return (
    <section aria-label="人工采集截图上传" className="space-y-2">
      <p className="text-sm text-text-secondary">上传前请裁剪截图，移除账号、凭据、个人信息和无关内容。仅支持 PNG、JPEG、WEBP，最大 10 MiB。</p>
      <ScreenshotPreparation
        describedBy={describedBy}
        disabled={Boolean(props.disabled) || !props.csrfToken}
        inputId={inputId}
        invalid={invalid}
        key={upload.verifiedSequence}
        locked={upload.busy || Boolean(upload.pending)}
        onBlockingChange={setPreparationBlocking}
        onUpload={(file) => void upload.start(file)}
      />
      <ManualUploadFeedback upload={upload} />
    </section>
  );
}
export { RunUpload };
export type { RunUploadProps };
