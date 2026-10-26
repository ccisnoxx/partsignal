import { useEffect, useRef } from 'react';
import { Button } from '@/design-system/primitives/button';
import {
  analysisStatusLabels,
  type Accepted,
  type Detail,
} from './reanalysis.api';

/** 回执身份保持稳定，计算状态与当前指针继续来自原详情。 */
export function ReanalysisReceipt({
  accepted,
  target,
  currentId,
  disabled,
  onRead,
}: {
  accepted: Accepted;
  target: Detail['analysis']['revisions'][number]['analysis'] | undefined;
  currentId: string | null;
  disabled: boolean;
  onRead: () => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    region.current?.focus();
  }, [accepted]);
  return (
    <div
      role="region"
      ref={region}
      tabIndex={-1}
      aria-label="本次重新分析回执"
      className="min-w-0 space-y-2 rounded-lg border border-border-default p-3 text-sm"
    >
      <p className="break-all">
        目标分析 ID：{accepted.analysis_revision_id} · 请求 ID：
        {accepted.request_id}
      </p>
      <p>
        目标状态：
        {target
          ? analysisStatusLabels[target.status]
          : '本次读取尚未包含目标版本，请重新读取'}
        {target && currentId === target.id ? ' · 当前分析' : ''}
      </p>
      {target && (
        <a
          className="inline-flex min-h-11 items-center text-interaction-primary underline"
          href={`#analysis-revision-${target.id}`}
        >
          在历史中查看本次分析
        </a>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onRead}
      >
        读取最新分析结果
      </Button>
    </div>
  );
}
