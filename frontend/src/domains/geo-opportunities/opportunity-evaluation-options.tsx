import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { evaluationOptions, type EvaluationOptionKind } from './opportunity-evaluation.api';
import { OpportunityNotice } from './opportunity-controls';

export function EvaluationOptions({ kind, label, value, onChange, disabled }: { kind: EvaluationOptionKind; label: string; value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const query = useQuery(evaluationOptions(kind, q, page));
  return <section aria-label={label} className="min-w-0 space-y-2">
    <h4 className="type-label">{label}</h4>
    <Input aria-label={`搜索${label}`} type="search" value={q} maxLength={200} disabled={disabled} onChange={(event) => { setQ(event.currentTarget.value); setPage(1); }} />
    {query.isFetching && <p role="status">正在读取{label}…</p>}
    {query.error && <OpportunityNotice error><p>{query.error instanceof Error ? query.error.message : '候选读取失败'}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>重试{label}</Button></OpportunityNotice>}
    {query.data && !query.error && <><div className="space-y-2">{query.data.items.map((item) => <Button type="button" className="h-auto w-full justify-start whitespace-normal text-left" variant="outline" aria-pressed={value.includes(item.id)} disabled={disabled || (!value.includes(item.id) && value.length >= 50)} key={item.id} onClick={() => onChange(value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id])}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{value.includes(item.id) ? '已选：' : '选择：'}{item.label}<span className="block text-xs text-text-muted">{item.description}</span></span></Button>)}</div>
      {!query.data.items.length && <p className="text-sm">没有匹配的{label}。</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs"><span>第 {page} 页 · 共 {query.data.total} 项</span><Button type="button" size="sm" variant="outline" disabled={disabled || page === 1 || query.isFetching} onClick={() => setPage(page - 1)}>上一页{label}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || page * 10 >= query.data.total || query.isFetching} onClick={() => setPage(page + 1)}>下一页{label}</Button></div></>}
    <p className="text-xs">已选择 {value.length} 项</p>
    {value.map((id) => <div key={id} className="flex min-w-0 items-center gap-2"><span className="min-w-0 break-all text-xs">{id}</span><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`移除${label} ${id}`} onClick={() => onChange(value.filter((item) => item !== id))}>移除</Button></div>)}
  </section>;
}
