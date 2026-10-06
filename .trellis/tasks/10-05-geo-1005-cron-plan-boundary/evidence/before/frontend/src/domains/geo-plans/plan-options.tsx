import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { PlanNotice, PlanSelect, planErrorMessage } from './plan-controls';
import { roleLabels, type PlanValues } from './plans.model';
import { planOptionsQuery, type PlanOptionKind } from './plans.options';

const optionLabels = { subjects: '监测对象', prompts: '问题变体', profiles: '采集配置' } as const;
const optionFields = { subjects: 'subjects', prompts: 'prompt_variant_ids', profiles: 'collection_profile_ids' } as const;
const optionPaths = { subjects: '/configuration/geo-entities', prompts: '/geo/questions', profiles: '/configuration/geo-surfaces?tab=profiles' } as const;
type SubjectSelection = PlanValues['subjects'];
function PlanOptions({ kind, selected, subjects, onChange, onSubjectsChange, disabled, describedBy, invalid }: {
  kind: PlanOptionKind; selected: string[]; subjects?: SubjectSelection; onChange: (ids: string[]) => void;
  onSubjectsChange?: (items: SubjectSelection) => void; disabled?: boolean; describedBy?: string; invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // 仅保留用户选取时的展示文案；身份及显式角色始终由 RHF 持有，不从文案推断资格。
  const [chosenLabels, setChosenLabels] = useState<Record<string, string>>({});
  const query = useQuery({ ...planOptionsQuery(kind, q, page), enabled: !disabled });
  const label = optionLabels[kind];
  const field = optionFields[kind];
  const roleChoices = Object.entries(roleLabels).map(([value, text]) => ({ value, label: text }));
  const name = (id: string) => query.data?.items.find((item) => item.id === id)?.label ?? chosenLabels[id] ?? id;
  function select(id: string, optionLabel: string, role?: SubjectSelection[number]['role']) {
    setChosenLabels((current) => ({ ...current, [id]: optionLabel }));
    if (kind === 'subjects' && role) {
      const current = subjects ?? [];
      onSubjectsChange?.(current.some((item) => item.subject_id === id) ? current.map((item) => item.subject_id === id ? { ...item, role } : item) : [...current, { subject_id: id, role }]);
    } else onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }
  function remove(id: string) {
    if (kind === 'subjects') onSubjectsChange?.((subjects ?? []).filter((item) => item.subject_id !== id));
    else onChange(selected.filter((value) => value !== id));
  }
  return <div aria-describedby={describedBy} aria-invalid={invalid} aria-label={label} className="min-w-0 space-y-4" id={`plan-${field}`} role="group" tabIndex={-1}>
    <section aria-label={`已选${label}`} className="space-y-2">
      <h3 className="text-sm font-medium">已选{label}（{selected.length}）</h3>
      {selected.length === 0 ? <p className="text-sm text-text-muted">尚未选择{label}。</p> : <ul className="space-y-2">{selected.map((id) => <li className="min-w-0 space-y-2 rounded-lg border border-border-subtle p-3" id={`plan-${field}-${id}`} key={id} tabIndex={-1}>
        <p className="break-words text-sm">{name(id)}</p><p className="break-all text-xs text-text-muted">{id}</p>
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'subjects' && <div className="min-w-0 flex-1"><PlanSelect choices={roleChoices} disabled={disabled} label={`已选对象角色：${name(id)}`} onChange={(role) => select(id, name(id), role as SubjectSelection[number]['role'])} value={subjects?.find((item) => item.subject_id === id)?.role ?? ''} /></div>}
          <Button aria-label={`移除${label}：${name(id)}`} className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => remove(id)} type="button" variant="outline">移除</Button>
        </div>
      </li>)}</ul>}
    </section>
    <Input aria-label={`搜索${label}选项`} disabled={disabled} maxLength={200} onChange={(event) => { setQ(event.currentTarget.value); setPage(1); }} placeholder={`搜索${label}`} type="search" value={q} />
    {query.isPending && <p role="status">正在读取{label}选项…</p>}
    {query.error && <PlanNotice error>{planErrorMessage(query.error)}<Button disabled={disabled} onClick={() => void query.refetch()} type="button" variant="outline">重试{label}选项</Button></PlanNotice>}
    {query.data?.items.length === 0 && <PlanNotice><p>{q ? '没有匹配的选项，请调整搜索。' : `暂无${label}选项。请在已有资源页面准备配置。`}</p>{!q && <><a className="underline underline-offset-2" href={optionPaths[kind]} rel="noopener noreferrer" target="_blank">查看{label}资源（新标签页）</a><p className="text-xs">配置管理仍受服务端权限控制；工程师需要管理员协助时，请保留当前草稿。</p></>}</PlanNotice>}
    {query.data && <>
      <ul aria-label={`${label}候选`} className="space-y-2">{query.data.items.map((item) => <li className="min-w-0 space-y-2 rounded-lg border border-border-subtle p-3" key={item.id}>
        <p className="break-words text-sm">{item.label}</p><p className="break-words text-xs text-text-secondary">{item.description}</p>
        {kind === 'subjects' ? selected.includes(item.id) ? <p className="text-sm text-text-muted">已选择，请在上方修改角色或移除。</p> : <PlanSelect choices={[{ value: '', label: '请选择对象角色后加入' }, ...roleChoices]} disabled={disabled} label={`选择对象角色：${item.label}`} onChange={(role) => select(item.id, item.label, role as SubjectSelection[number]['role'])} value="" /> : <Button aria-label={`${selected.includes(item.id) ? '取消选择' : '选择'}${label}：${item.label}`} aria-pressed={selected.includes(item.id)} className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => select(item.id, item.label)} type="button" variant={selected.includes(item.id) ? 'secondary' : 'outline'}>{selected.includes(item.id) ? '已选择 · 取消选择' : '选择'}</Button>}
      </li>)}</ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted"><span>第 {query.data.page} 页 · 共 {query.data.total} 个{label}</span><Button className="min-h-11 sm:min-h-8" disabled={disabled || page <= 1 || query.isFetching} onClick={() => setPage(page - 1)} type="button" variant="outline">上一页{label}选项</Button><Button className="min-h-11 sm:min-h-8" disabled={disabled || query.data.page * query.data.page_size >= query.data.total || query.isFetching} onClick={() => setPage(page + 1)} type="button" variant="outline">下一页{label}选项</Button></div>
    </>}
  </div>;
}
export { PlanOptions };
