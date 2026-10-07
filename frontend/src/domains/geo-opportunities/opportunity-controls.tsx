import type { ReactNode } from 'react';
import { Button } from '@/design-system/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { OpportunityRequestError } from './opportunities.api';

export function OpportunitySelect({ label, value, choices, onChange, id }: { label: string; value: string; choices: readonly { value: string; label: string }[]; onChange: (value: string) => void; id?: string }) {
  return <Select items={choices} value={value} onValueChange={(next) => { if (next !== null) onChange(next); }}><SelectTrigger className="w-full min-w-0" aria-label={label} id={id}><SelectValue /></SelectTrigger><SelectContent>{choices.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>;
}
export function OpportunityNotice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div role={error ? 'alert' : 'status'} className={`min-w-0 space-y-2 rounded-lg border p-3 text-sm ${error ? 'border-danger/30 bg-danger/5 text-danger' : 'border-border-default bg-surface-raised text-text-secondary'}`}>{children}</div>; }
export function canShowOpportunitySnapshot(error: unknown) { return !(error instanceof OpportunityRequestError) || ![401, 403, 404, 409, 400, 422].includes(error.status ?? 0); }
export function canRetryOpportunityRead(error: unknown) { return !(error instanceof OpportunityRequestError) || ![401, 403, 404, 400, 422].includes(error.status ?? 0); }
export function OpportunityReadFailure({ error, retained, onRetry, evidence = false }: { error: unknown; retained?: boolean; onRetry: () => void; evidence?: boolean }) {
  const status = error instanceof OpportunityRequestError ? error.status : undefined;
  const recoverable = canRetryOpportunityRead(error);
  const message = status === 401 || status === 403 ? '当前机会不可访问，请确认登录与访问权限。' : status === 404 ? '该机会不存在，请关闭详情并返回列表。' : status === 409 ? '历史证据关联不完整，当前详情不可安全展示。可显式重新读取，或关闭详情。' : status === 503 && evidence ? '证据签名服务暂不可用，请稍后重新读取。' : status === 400 || status === 422 ? '筛选条件不符合服务端合同，请调整筛选。' : '读取机会失败，可稍后重试。';
  return <OpportunityNotice error><p>{message}</p>{error instanceof OpportunityRequestError && error.detail && <p className="break-words text-xs">错误码：{error.detail.code} · 请求 ID：{error.detail.request_id}</p>}{retained && canShowOpportunitySnapshot(error) && <p>刷新失败，保留同一条件的上次成功快照；操作暂停，刷新成功后更新。</p>}{recoverable && <Button type="button" variant="outline" onClick={onRetry}>重试读取</Button>}</OpportunityNotice>;
}
