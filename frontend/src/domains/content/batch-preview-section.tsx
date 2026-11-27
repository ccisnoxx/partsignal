import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  batchCellStatusRegistry,
  batchDiagnosticLabels,
  type BatchPreviewResponse,
} from './content-batch.model';

type BatchPreviewSectionProps = {
  preview: BatchPreviewResponse;
  previewIsStale: boolean;
  acknowledgeWarnings: boolean;
  busy: boolean;
  committing: boolean;
  canCommit: boolean;
  productNames: Map<string, string>;
  topicNames: Map<string, string>;
  platformNames: Map<string, string>;
  onAcknowledgeWarningsChange: (checked: boolean) => void;
  onCommit: () => void;
};

function BatchPreviewSection({
  preview,
  previewIsStale,
  acknowledgeWarnings,
  busy,
  committing,
  canCommit,
  productNames,
  topicNames,
  platformNames,
  onAcknowledgeWarningsChange,
  onCommit,
}: BatchPreviewSectionProps) {
  return (
    <section className="space-y-4 rounded-xl border border-border-subtle bg-surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">2. 预检诊断结果</h2>
          <p className="text-xs text-text-secondary">
            服务端在 REPEATABLE READ 快照下已完成逐格核验；提交时将在事务锁内重新校验。
          </p>
        </div>
        {previewIsStale && (
          <Badge variant="warning">上方矩阵已变更，请重新点击预览</Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="总规划格数" value={String(preview.total_cells)} />
        <SummaryCard label="无阻断可创建" value={String(preview.creatable_count)} />
        <SummaryCard label="软告警格数" value={String(preview.warning_cell_count)} />
        <SummaryCard label="硬阻断格数" value={String(preview.blocker_cell_count)} />
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border-subtle bg-surface-muted/40 text-text-secondary">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">产品 / 事实版本</th>
              <th className="px-3 py-2">问题主题</th>
              <th className="px-3 py-2">内容角度</th>
              <th className="px-3 py-2">目标平台</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">诊断明细</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {preview.cells.map((cell) => {
              const statusMeta = batchCellStatusRegistry[cell.status];
              return (
                <tr key={cell.index}>
                  <td className="px-3 py-2 font-mono text-text-muted">{cell.index + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-primary">
                      {productNames.get(cell.product_id) ?? cell.product_id}
                    </div>
                    <div className="text-text-muted">
                      {cell.resolved_fact_version ? `事实 v${cell.resolved_fact_version}` : '无可用事实'}
                    </div>
                  </td>
                  <td className="max-w-xs px-3 py-2 text-text-primary">
                    {topicNames.get(cell.query_topic_id) ?? cell.query_topic_id}
                  </td>
                  <td className="px-3 py-2 text-text-primary">{cell.content_angle}</td>
                  <td className="px-3 py-2 text-text-primary">
                    {platformNames.get(cell.platform_profile_id) ?? cell.platform_profile_id}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>
                  </td>
                  <td className="max-w-md px-3 py-2">
                    {cell.blockers.length === 0 && cell.warnings.length === 0 ? (
                      <span className="text-text-muted">通过所有检查</span>
                    ) : (
                      <ul className="space-y-1">
                        {cell.blockers.map((diag, i) => (
                          <li className="text-destructive" key={`b-${i}`}>
                            [阻断 · {batchDiagnosticLabels[diag.code]}] {diag.message}
                          </li>
                        ))}
                        {cell.warnings.map((diag, i) => (
                          <li className="text-warning-foreground" key={`w-${i}`}>
                            [告警 · {batchDiagnosticLabels[diag.code]}] {diag.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 border-t border-border-subtle pt-4">
        {!preview.can_commit && (
          <p className="text-sm text-destructive" role="alert">
            存在 {preview.blocker_cell_count} 个硬阻断单元格，无法提交。请调整上方矩阵并重新预览。
          </p>
        )}
        {preview.requires_warning_acknowledgement && !previewIsStale && (
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              checked={acknowledgeWarnings}
              className="mt-1"
              disabled={busy}
              onChange={(event) => onAcknowledgeWarningsChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              我已知晓上述 {preview.warning_cell_count} 个单元格的软告警（如已有开放任务、近期发布、缺 Prompt 或事实到期），确认继续全量原子创建。
            </span>
          </label>
        )}
        <div className="flex justify-end">
          <Button disabled={!canCommit} onClick={onCommit} type="button">
            {committing ? '正在原子创建…' : `原子创建全部 ${preview.total_cells} 个内容任务`}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

export { BatchPreviewSection };
