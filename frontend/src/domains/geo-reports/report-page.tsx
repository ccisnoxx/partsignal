import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/design-system/primitives/button';
import { ReportContent } from './report-content';
import { reportOptions, ReportRequestError, retainReport } from './reports.api';
import { exportLabels, exportUrl, type ReportSearch } from './reports.model';

type Props = { search: ReportSearch; print?: boolean };
export function ReportPage({ search, print = false }: Props) {
  const query = useQuery(reportOptions(search, print));
  const report = retainReport(query.error) ? query.data : undefined;
  return <section className="min-w-0 space-y-5" aria-labelledby="geo-report-title">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2"><h1 id="geo-report-title" className="type-page-title">{print ? 'GEO 报告打印' : 'GEO 报告预览'}</h1><p className="text-text-secondary">回答级监测报告 · 各指标独立展示</p></div>
      <div className="geo-report-controls flex flex-wrap gap-3">
        {print ? <><Link to="/geo/reports" search={search} className="text-primary underline underline-offset-4">返回报告预览</Link>{report?.available && !query.error && <Button onClick={() => window.print()}>打印</Button>}</> : <><Link to="/geo/insights/answers" search={search} className="text-primary underline underline-offset-4">返回回答洞察</Link>{report?.available && !query.error && <Link to="/geo/reports/print" search={search} className="text-primary underline underline-offset-4">打开打印报告</Link>}</>}
        {(!query.error || retainReport(query.error)) && <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>重新读取报告</Button>}
      </div>
    </header>
    {query.isFetching && <p className="geo-report-controls" role="status">{report ? '正在刷新报告…' : '正在读取报告…'}</p>}
    {query.error && <ReportFailure error={query.error} retained={!!report} retry={() => void query.refetch()}/>}
    {report && <>
      {!print && <section aria-label="CSV 导出" className="geo-report-controls space-y-3 rounded-lg border border-border-subtle p-4"><h2 className="type-section-title">CSV 导出</h2><p className="text-sm text-text-secondary">导出使用当前筛选，由服务端流式发送。每次读取有独立 as_of；空数据、无权限或不可用数据会返回明确错误。点击下载不代表传输已完成。</p><nav aria-label="CSV 下载" className="flex flex-wrap gap-4">{report.exports.map((item) => item.available ? <a key={item.kind} href={exportUrl(item.kind, search)} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{exportLabels[item.kind]} CSV</a> : <span key={item.kind} className="text-text-tertiary">{exportLabels[item.kind]} CSV：{item.unavailable_reason === 'NOT_IMPLEMENTED' ? '尚未实现' : '当前无可导出的记录'}</span>)}</nav></section>}
      <ReportContent report={report}/>
    </>}
  </section>;
}
function ReportFailure({ error, retained, retry }: { error: Error; retained: boolean; retry: () => void }) {
  const status = error instanceof ReportRequestError ? error.status : undefined;
  const recoverable = retainReport(error);
  return <div role="alert" className="space-y-2 rounded-md border border-border-subtle p-4">
    <p>{status === 401 || status === 403 ? '报告不可访问，请确认登录与访问权限。' : status === 400 || status === 422 ? '报告筛选不符合合同，请返回预览重新选择。' : '报告读取失败，可稍后重新读取。'}</p>
    {error instanceof ReportRequestError && error.detail && <p className="text-xs">错误码：{error.detail.code} · 请求 ID：{error.detail.request_id}</p>}
    {retained && <p>保留同一筛选的上次报告，数据截止时间见 as_of；刷新成功后更新。</p>}
    {recoverable && <Button variant="outline" onClick={retry}>重试读取</Button>}
  </div>;
}
