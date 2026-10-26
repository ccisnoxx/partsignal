import { Input } from '@/design-system/primitives/input';
import { ManualUploadFeedback, useManualFileUpload, type ManualFileUploadProps } from './manual-file-upload';

type RawTextUploadProps = ManualFileUploadProps & { inputId?: string; describedBy?: string; invalid?: boolean };
function RawTextUpload({ inputId, describedBy, invalid, ...props }: RawTextUploadProps) {
  const upload = useManualFileUpload({ ...props, kind: 'RAW_TEXT' });
  return (
    <section aria-label="原始文本证据上传" className="space-y-2">
      <p className="text-sm text-text-secondary">可选纯文本证据，仅支持 text/plain，最大 50 MiB。上传前人工检查并移除凭据和个人信息；文件不会替代回答原文，也不会自动脱敏。</p>
      <Input
        accept="text/plain"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label="上传原始文本证据"
        disabled={props.disabled || !props.csrfToken || upload.busy || Boolean(upload.pending)}
        id={inputId}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void upload.start(file);
        }}
        type="file"
      />
      <ManualUploadFeedback upload={upload} />
    </section>
  );
}
export { RawTextUpload };
