import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { catalogListQueryOptions, catalogProductOptionsQueryOptions } from './catalog.api';
import { CatalogSelect, CatalogNotice, catalogErrorMessage, type Choice } from './catalog-controls';

function CatalogIdentityPicker({ kind, value, label, currentLabel, onChange, disabled = false, invalid, describedBy, required }: {
  kind: 'product' | 'OWN_BRAND' | 'COMPETITOR_BRAND'; value: string; label: string; currentLabel?: string;
  onChange: (id: string) => void; disabled?: boolean; invalid?: boolean; describedBy?: string; required?: boolean;
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const products = useQuery({ ...catalogProductOptionsQueryOptions(q, page), enabled: kind === 'product' });
  const subjects = useQuery({ ...catalogListQueryOptions({ q: q || undefined, page, page_size: 10, subject_type: kind === 'product' ? undefined : kind }), enabled: kind !== 'product' });
  const query = kind === 'product' ? products : subjects;
  const choices: Choice[] = kind === 'product'
    ? (products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` })) ?? [])
    : (subjects.data?.items.map((item) => ({ value: item.id, label: item.display_name })) ?? []);
  if (value && !choices.some((item) => item.value === value)) choices.unshift({ value, label: currentLabel ?? `当前选择：${value}` });
  choices.unshift({ value: '', label: kind === 'product' ? '请选择现有产品' : '无父级品牌' });
  return <div className="min-w-0 space-y-2">
    <Input aria-label={`搜索${label}`} disabled={disabled} maxLength={200} onChange={(event) => { setQ(event.currentTarget.value); setPage(1); }} placeholder="输入名称搜索候选" type="search" value={q} />
    <CatalogSelect choices={choices} describedBy={describedBy} disabled={disabled || query.isPending} id={`catalog-${kind === 'product' ? 'product_id' : 'parent_subject_id'}`} invalid={invalid} label={label} onChange={onChange} required={required} value={value} />
    {query.isPending && <p role="status">正在读取候选…</p>}
    {query.error && <CatalogNotice error>{catalogErrorMessage(query.error)} <Button onClick={() => void query.refetch()} type="button" variant="outline">重试候选读取</Button></CatalogNotice>}
    {query.data && <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>第 {page} 页 · 共 {query.data.total} 个候选</span>
      <Button disabled={disabled || page <= 1} onClick={() => setPage(page - 1)} size="sm" type="button" variant="outline">上一页候选</Button>
      <Button disabled={disabled || page * 10 >= query.data.total} onClick={() => setPage(page + 1)} size="sm" type="button" variant="outline">下一页候选</Button>
    </div>}
  </div>;
}
export { CatalogIdentityPicker };
