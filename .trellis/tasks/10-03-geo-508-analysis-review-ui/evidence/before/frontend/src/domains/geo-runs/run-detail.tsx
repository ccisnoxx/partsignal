import { useEffect, useRef, useState } from 'react';
import type { components } from '@/shared/api/generated/schema';
import { TableShell } from '@/design-system/data-table/table-shell';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { batchStatusLabels, modeLabels, runCost, runPrimaryLabels, runStatusLabels, timestamp } from './runs.model';

type Detail = components['schemas']['GeoRunDetail'];
function BatchSummary({ summary }: { summary: components['schemas']['GeoBatchSummary'] }) {
  const counts = summary.status_counts;
  return (
    <section
      aria-label="完整批次摘要"
      className="min-w-0 space-y-3 rounded-xl border border-border-default bg-surface-panel p-4"
    >
      <h2 className="type-section-title">完整批次摘要</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-text-muted">计划采样数</dt>
          <dd>{summary.requested_run_count}</dd>
        </div>
        <div>
          <dt className="text-text-muted">执行尝试数</dt>
          <dd>{summary.attempt_count}</dd>
        </div>
        <div>
          <dt className="text-text-muted">待人工录入</dt>
          <dd>{summary.pending_manual_count}</dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {(
          [
            ['pending', '待采集'],
            ['running', '采集中'],
            ['collected', '已采集'],
            ['analyzing', '分析中'],
            ['needs_review', '待复核'],
            ['completed', '已完成'],
            ['failed', '失败'],
            ['cancelled', '已取消'],
            ['budget_blocked', '预算阻断'],
          ] as const
        ).map(([key, label]) => (
          <div className="flex justify-between gap-2" key={key}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-text-secondary">
        费用已知：{summary.cost.known_attempt_count} 次；未知：{summary.cost.unknown_attempt_count} 次。
        {summary.cost.known_costs.map((cost) => (
          <span key={cost.currency}>
            {' '}
            {cost.value} {cost.currency}。
          </span>
        ))}
        计数与费用来自完整批次，不随当前运行页变化。
      </p>
    </section>
  );
}
function RunDetail({
  detail,
  onSelectAttempt,
  onEdit,
  onRefreshEvidence,
  retryControl,
  blocked = false,
}: {
  detail: Detail;
  onSelectAttempt: (id: string) => void;
  onEdit: () => void;
  onRefreshEvidence: () => void;
  retryControl?: React.ReactNode;
  blocked?: boolean;
}) {
  const { run, answer, data_quality: quality } = detail;
  const input = run.input_snapshot;
  const heading = useRef<HTMLHeadingElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [run.id]);
  return (
    <section
      aria-label="运行详情"
      className="min-w-0 space-y-5 rounded-xl border border-border-default bg-surface-panel p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2 className="type-section-title break-words" ref={heading} tabIndex={-1}>
            {input.prompt.canonical_question}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Badge>{runStatusLabels[run.status]}</Badge>
            <Badge variant="secondary">{modeLabels[input.profile.collection_mode]}</Badge>
            <span className="text-sm">
              采样 {run.repeat_index} · 尝试 {run.attempt_no}
            </span>
          </div>
        </div>
        {run.available_actions.includes('ENTER_MANUAL_OBSERVATION') && (
          <Button disabled={blocked} onClick={onEdit} type="button">
            {runPrimaryLabels.ENTER_MANUAL_OBSERVATION}
          </Button>
        )}
      </header>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <Fact label="运行 ID" value={run.id} />
        <Fact label="批次 ID" value={run.batch_id} />
        <Fact
          label="冻结计划"
          value={`${detail.batch.plan_name} · Revision ${detail.batch.plan_revision ?? '临时配置'}`}
        />
        <Fact label="批次状态" value={batchStatusLabels[detail.batch.status]} />
        <Fact label="观测面 / 采集配置" value={`${input.profile.surface.name} / ${input.profile.name}`} />
        <Fact
          label="语言 / 地区 / 登录状态"
          value={`${input.profile.language_code} / ${input.profile.region_code} / ${input.profile.login_state}`}
        />
        <Fact
          label="搜索策略 / 适配器版本"
          value={`${input.profile.web_search_policy} / ${input.profile.adapter_version}`}
        />
        <Fact label="数据分级 / 规则版本" value={`${input.data_classification} / ${input.rule_set_revision}`} />
        <Fact
          label="冻结监测对象"
          value={input.subjects.map((item) => `${item.display_name} (${item.role})`).join('；')}
        />
        <Fact label="来源请求 ID" value={run.provider_request_id ?? '未记录'} />
        <Fact label="外部调用状态" value={`${externalCallLabels[run.external_call_state]} · ${run.external_call_state}`} />
        <Fact label="输入 tokens" value={run.prompt_tokens === null ? '未报告' : String(run.prompt_tokens)} />
        <Fact label="输出 tokens" value={run.completion_tokens === null ? '未报告' : String(run.completion_tokens)} />
        <Fact label="总 tokens" value={run.total_tokens === null ? '未报告' : String(run.total_tokens)} />
        <Fact label="供应商 HTTP 状态" value={run.provider_status === null ? '未报告' : String(run.provider_status)} />
        <Fact label="Retry-After" value={run.retry_after_seconds === null ? '未报告' : `${run.retry_after_seconds} 秒`} />
        <Fact label="创建 / 采集时间" value={`${timestamp(run.created_at)} / ${timestamp(run.collected_at)}`} />
        <Fact
          label="耗时 / 费用"
          value={`${run.duration_ms === null ? '未知' : `${run.duration_ms} ms`} / ${runCost(run)}`}
        />
      </dl>
      <p className="text-sm text-text-secondary">费用未知不计为零；三项 token 用量独立报告，缺失时不推算。发送后失败不会自动再次调用。</p>
      {retryControl}
      <section className="space-y-2">
        <h3 className="type-section-title">冻结问题全文</h3>
        <pre className="whitespace-pre-wrap break-words text-sm">{input.prompt.prompt_text}</pre>
      </section>
      {run.error_code && (
        <div className="space-y-1 text-sm text-danger" role="alert">
          <p>
            错误阶段：{run.error_stage} · {run.error_code}
          </p>
          <p>{run.error_summary}</p>
        </div>
      )}
      <section className="space-y-3 border-t border-border-subtle pt-4">
        <h3 className="type-section-title">原始回答与证据（只读）</h3>
        {answer ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Fact
                label="来源产品 / 模型 / 版本"
                value={`${answer.source_product ?? '未知'} / ${answer.source_model ?? '未知'} / ${answer.source_version ?? '未知'}`}
              />
              <Fact
                label="实际联网搜索"
                value={answer.web_search_observed === null ? '未知' : answer.web_search_observed ? '是' : '否'}
              />
              <Fact label="采集时间" value={timestamp(answer.collected_at)} />
              <Fact label="回答 SHA-256" value={answer.answer_sha256} />
            </dl>
            <details open>
              <summary className="cursor-pointer text-sm">完整回答 · {answer.answer_format}</summary>
              <pre className="mt-3 max-h-[36rem] overflow-y-auto whitespace-pre-wrap break-words text-sm">
                {answer.answer_text}
              </pre>
            </details>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(answer.answer_text).then(
                  () => setCopyMessage('已复制回答原文'),
                  () => setCopyMessage('复制失败，请手动选择原文'),
                );
              }}
              type="button"
              variant="outline"
            >
              复制回答原文
            </Button>
            <p aria-live="polite" className="text-sm">
              {copyMessage}
            </p>
            <details>
              <summary className="cursor-pointer text-sm">安全载荷摘要</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(answer.raw_payload_summary, null, 2)}
              </pre>
            </details>
          </>
        ) : (
          <p className="text-sm text-text-secondary">尚未提交原始回答。</p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="type-section-title">原始引用</h3>
        <p className="text-sm text-text-secondary">按原始位置展示；来源分类尚未分析。链接在新标签页打开。</p>
        {detail.citations.length ? (
          <TableShell regionLabel="原始引用列表">
            <thead>
              <tr>
                <th>位置 / 全部出现位置</th>
                <th>域名与引用</th>
                <th>采集来源</th>
              </tr>
            </thead>
            <tbody>
              {detail.citations.map((citation) => (
                <tr key={citation.id}>
                  <td>
                    {citation.position} / {citation.occurrences.join(', ')}
                  </td>
                  <td className="max-w-xl break-all">
                    <p>{citation.hostname}</p>
                    <a
                      className="text-interaction-primary underline"
                      href={safeCitation(citation.normalized_url)}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {citation.title ?? citation.original_url}
                    </a>
                  </td>
                  <td>{citation.extraction_source}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : (
          <p className="text-sm text-text-secondary">没有原始引用。</p>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="type-section-title">截图与文件</h3>
        <p className="text-sm text-text-secondary">内部证据，含敏感信息时仅按授权使用。访问链接限时有效。</p>
        {detail.evidence_files.map((file) => (
          <EvidenceFile file={file} key={`${file.id}:${file.download.url}`} onRefresh={onRefreshEvidence} />
        ))}
        {!detail.evidence_files.length && <p className="text-sm text-text-secondary">尚无正式提交的证据文件。</p>}
      </section>
      <section className="space-y-2 border-t border-border-subtle pt-4">
        <h3 className="type-section-title">分析与数据质量</h3>
        <p className="text-sm text-text-secondary">评估：{quality.assessment}；指标资格尚未实现。</p>
        <p className="text-sm">
          尚未实现：{quality.unavailable_sections.join('、')}。原始采集成功不表示已完成分析或复核。
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="type-section-title">尝试链</h3>
        <ul className="space-y-2">
          {detail.attempts.map((attempt) => (
            <li className="flex flex-wrap items-center gap-2 text-sm" key={attempt.id}>
              <Button
                aria-current={attempt.id === run.id ? 'true' : undefined}
                onClick={() => onSelectAttempt(attempt.id)}
                type="button"
                variant="link"
              >
                尝试 {attempt.attempt_no}
              </Button>
              <span>
                {runStatusLabels[attempt.status]} · {timestamp(attempt.created_at)}
                {attempt.error_code ? ` · ${attempt.error_code}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="type-section-title">状态时间线</h3>
        <ol className="space-y-2 text-sm">
          {detail.timeline.map((event) => (
            <li key={`${event.run_id}:${event.event}`}>
              尝试 {event.attempt_no} · {eventLabels[event.event]} · {timestamp(event.occurred_at)}
            </li>
          ))}
        </ol>
        <p className="text-xs text-text-muted">仅显示实际记录的时间，数据截止 {timestamp(detail.as_of)}。</p>
      </section>
    </section>
  );
}
const externalCallLabels = {
  NOT_STARTED: '尚未发送', SENT: '已发送', UNKNOWN: '结果未知', COMPLETED: '调用已结束',
} satisfies Record<components['schemas']['GeoExternalCallState'], string>;
const eventLabels = { CREATED: '创建', STARTED: '开始', COLLECTED: '采集完成', FINISHED: '结束' } satisfies Record<
  components['schemas']['GeoRunTimelineEvent']['event'],
  string
>;
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="break-words [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
function safeCitation(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('服务端返回不安全的引用链接');
  return value;
}
function EvidenceFile({
  file,
  onRefresh,
}: {
  file: components['schemas']['GeoRunEvidenceFile'];
  onRefresh: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border-subtle p-3">
      <p className="break-words text-sm">
        {file.kind === 'SCREENSHOT' ? '截图证据' : '原始载荷'} · {file.access_level} · {file.size} 字节 · 到期{' '}
        {timestamp(file.download.expires_at)}
      </p>
      <p className="break-all text-xs text-text-muted">SHA-256：{file.sha256}</p>
      {file.kind === 'SCREENSHOT' && !failed && (
        <img
          alt="人工采集截图证据"
          className="max-h-[32rem] max-w-full rounded-md object-contain"
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
          src={file.download.url}
        />
      )}
      {failed && (
        <p className="text-sm text-danger" role="alert">
          截图加载失败，链接可能已过期。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          className="text-sm text-interaction-primary underline"
          href={file.download.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          打开受控证据文件
        </a>
        <Button onClick={onRefresh} size="sm" type="button" variant="outline">
          刷新证据访问链接
        </Button>
      </div>
    </div>
  );
}
export { BatchSummary, RunDetail };
