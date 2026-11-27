import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DownloadIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { SubNavTabs } from '@/design-system/layout/sub-nav-tabs';
import { Badge } from '@/design-system/primitives/badge';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import { MetadataDisclosure } from '@/design-system/primitives/metadata-disclosure';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { ReportContent } from './report-content';
import { reportOptions, ReportRequestError, retainReport } from './reports.api';
import { exportLabels, exportUrl, type ReportSearch } from './reports.model';

type Props = { search: ReportSearch; print?: boolean };

export function ReportPage({ search, print = false }: Props) {
  const query = useQuery(reportOptions(search, print));
  const report = retainReport(query.error) ? query.data : undefined;

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="geo-report-title">
      <PageHeader
        actions={
          <div className="geo-report-controls flex flex-wrap items-center gap-2">
            {print ? (
              <>
                <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} search={search} to="/geo/reports">
                  返回报告预览
                </Link>
                {report?.available && !query.error && (
                  <Button onClick={() => window.print()} size="sm" type="button">
                    <PrinterIcon aria-hidden="true" className="size-3.5" />
                    <span>打印</span>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} search={search} to="/geo/insights/answers">
                  返回回答洞察
                </Link>
                {report?.available && !query.error && (
                  <Link className={buttonVariants({ size: 'sm', variant: 'default' })} search={search} to="/geo/reports/print">
                    <PrinterIcon aria-hidden="true" className="size-3.5" />
                    <span>打开打印报告</span>
                  </Link>
                )}
              </>
            )}
            {(!query.error || retainReport(query.error)) && (
              <Button disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
                <RefreshCwIcon aria-hidden="true" className="size-3.5" />
                <span>重新读取报告</span>
              </Button>
            )}
          </div>
        }
        description="回答级监测报告 · 各指标独立展示"
        title={print ? 'GEO 报告打印' : 'GEO 报告预览'}
        titleId="geo-report-title"
      />

      {!print && (
        <SubNavTabs
          ariaLabel="GEO 分析页面"
          className="geo-report-controls"
          items={[
            { key: 'overview', active: false, render: (props) => <Link search={search} to="/geo/overview" {...props}>总览</Link> },
            { key: 'answers', active: false, render: (props) => <Link search={search} to="/geo/insights/answers" {...props}>回答洞察</Link> },
            { key: 'reports', active: true, render: (props) => <Link search={search} to="/geo/reports" {...props}>报告预览</Link> },
            { key: 'article-insights', active: false, render: (props) => <Link search={search} to="/geo/insights" {...props}>文章关系洞察</Link> },
          ]}
        />
      )}

      {query.isFetching && (
        <div className="geo-report-controls space-y-3">
          <p className="text-xs text-text-secondary" role="status">
            {report ? '正在刷新报告…' : '正在读取报告…'}
          </p>
          {!report && <Skeleton className="h-64 rounded-xl" />}
        </div>
      )}
      {query.error && <ReportFailure error={query.error} retained={!!report} retry={() => void query.refetch()} />}
      {report && (
        <>
          {!print && (
            <section
              aria-label="CSV 导出"
              className="geo-report-controls space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-[var(--shadow-panel)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="type-section-title">CSV 导出</h2>
                <nav aria-label="CSV 下载" className="flex flex-wrap items-center gap-2">
                  {report.exports.map((item) =>
                    item.available ? (
                      <a
                        className={buttonVariants({ size: 'sm', variant: 'outline' })}
                        href={exportUrl(item.kind, search)}
                        key={item.kind}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <DownloadIcon aria-hidden="true" className="size-3.5" />
                        <span>{exportLabels[item.kind]} CSV</span>
                      </a>
                    ) : (
                      <Badge key={item.kind} variant="secondary">
                        {exportLabels[item.kind]} CSV：{item.unavailable_reason === 'NOT_IMPLEMENTED' ? '尚未实现' : '当前无可导出的记录'}
                      </Badge>
                    ),
                  )}
                </nav>
              </div>
              <MetadataDisclosure summary="导出口径与说明">
                <p className="text-xs text-text-secondary">
                  导出使用当前筛选，由服务端流式发送。每次读取有独立 as_of；空数据、无权限或不可用数据会返回明确错误。机会 CSV 与本报告待处理机会摘要使用同一范围；完整状态筛选可在机会工作台导出。点击下载不代表传输已完成。
                </p>
              </MetadataDisclosure>
            </section>
          )}
          <ReportContent report={report} />
        </>
      )}
    </section>
  );
}

function ReportFailure({ error, retained, retry }: { error: Error; retained: boolean; retry: () => void }) {
  const status = error instanceof ReportRequestError ? error.status : undefined;
  const recoverable = retainReport(error);
  const message =
    status === 401 || status === 403
      ? '报告不可访问，请确认登录与访问权限。'
      : status === 400 || status === 422
        ? '报告筛选不符合合同，请返回预览重新选择。'
        : '报告读取失败，可稍后重新读取。';

  return (
    <InlineBanner
      actions={recoverable ? <Button size="sm" variant="outline" onClick={retry}>重试读取</Button> : undefined}
      meta={
        error instanceof ReportRequestError && error.detail
          ? `错误码：${error.detail.code} · 请求 ID：${error.detail.request_id}`
          : undefined
      }
      tone="danger"
    >
      <p>{message}</p>
      {retained && <p className="mt-1 text-xs text-text-secondary">保留同一筛选的上次报告，数据截止时间见 as_of；刷新成功后更新。</p>}
    </InlineBanner>
  );
}
