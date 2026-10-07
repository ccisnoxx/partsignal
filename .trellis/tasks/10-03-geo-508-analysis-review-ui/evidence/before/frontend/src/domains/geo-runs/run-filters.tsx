import { z } from 'zod';
import { useState } from 'react';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { canonicalUuidSchema } from '@/shared/lib/canonical-uuid';
import { batchStatusLabels, modeLabels, runSearchSchema, runStatusLabels, type RunSearch } from './runs.model';

function RunSelect({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 space-y-1 text-sm">
      <span>{label}</span>
      <Select items={choices} onValueChange={(next) => next !== null && onChange(next)} value={value}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function RunFilters({ search, onChange }: { search: RunSearch; onChange: (next: RunSearch) => void }) {
  const [q, setQ] = useState(search.q ?? '');
  const [error, setError] = useState('');
  const runs = search.view === 'runs';
  function change(patch: Record<string, unknown>) {
    onChange(runSearchSchema.parse({ ...search, ...patch, page: 1 }));
  }
  return (
    <section
      aria-label="运行中心筛选"
      className="min-w-0 space-y-3 rounded-xl border border-border-default bg-surface-panel p-3"
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          change({ q });
        }}
      >
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          {runs ? '搜索冻结问题' : '搜索冻结计划名称'}
          <Input maxLength={200} onChange={(event) => setQ(event.target.value)} value={q} />
        </label>
        <Button type="submit">应用筛选</Button>
        <Button
          onClick={() => {
            setQ('');
            onChange(
              runSearchSchema.parse({
                view: search.view,
                run_id: search.run_id,
                edit: search.edit,
                create: search.create,
              }),
            );
          }}
          type="button"
          variant="outline"
        >
          清除筛选
        </Button>
      </form>
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <RunSelect
          choices={[
            { value: '', label: '全部状态' },
            ...Object.entries(runs ? runStatusLabels : batchStatusLabels).map(([value, label]) => ({ value, label })),
          ]}
          label={runs ? '运行状态' : '批次状态'}
          onChange={(value) => change(runs ? { status: value } : { batch_status: value })}
          value={(runs ? search.status : search.batch_status) ?? ''}
        />
        {runs ? (
          <RunSelect
            choices={[
              { value: '', label: '全部方式' },
              ...Object.entries(modeLabels).map(([value, label]) => ({ value, label })),
            ]}
            label="采集方式"
            onChange={(value) => change({ collection_mode: value })}
            value={search.collection_mode ?? ''}
          />
        ) : (
          <RunSelect
            choices={[
              { value: '', label: '全部触发' },
              { value: 'MANUAL', label: '手动触发' },
              { value: 'SCHEDULED', label: '调度触发' },
              { value: 'RETEST', label: '复测' },
            ]}
            label="触发方式"
            onChange={(value) => change({ trigger_type: value })}
            value={search.trigger_type ?? ''}
          />
        )}
        <RunSelect
          choices={[
            { value: '', label: '最新创建' },
            { value: 'CREATED_ASC', label: '最早创建' },
          ]}
          label="创建排序"
          onChange={(value) => change({ sort: value })}
          value={search.sort ?? ''}
        />
      </div>
      <details>
        <summary className="cursor-pointer text-sm">更多筛选：身份与时间</summary>
        <form
          className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"
          key={JSON.stringify(search)}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const patch: Record<string, unknown> = {};
            for (const [key, raw] of data.entries()) {
              const value = String(raw).trim();
              if (key.endsWith('_id') && value && !canonicalUuidSchema.safeParse(value).success) {
                setError('身份筛选需要完整 UUID');
                return;
              }
              if (key.startsWith('created_') && value && !z.iso.datetime({ offset: true }).safeParse(value).success) {
                setError('时间筛选需要带时区的 ISO 时间');
                return;
              }
              if (key === 'error_code' && value && !runSearchSchema.parse({ error_code: value }).error_code) {
                setError('错误码需要使用服务端定义的值');
                return;
              }
              patch[key] = value || undefined;
            }
            if (
              patch.created_from &&
              patch.created_to &&
              Date.parse(String(patch.created_from)) >= Date.parse(String(patch.created_to))
            ) {
              setError('开始时间必须早于结束时间');
              return;
            }
            setError('');
            change(patch);
          }}
        >
          {(
            [
              ['plan_id', '计划 ID'],
              ['subject_id', '监测对象 ID'],
              ...(runs
                ? ([
                    ['batch_id', '批次 ID'],
                    ['product_id', '产品 ID'],
                    ['query_topic_id', '问题主题 ID'],
                    ['prompt_variant_id', '问题变体 ID'],
                    ['collection_profile_id', '采集配置 ID'],
                    ['engine_surface_id', '观测面 ID'],
                  ] as const)
                : []),
            ] as readonly (readonly [keyof RunSearch, string])[]
          ).map(([key, label]) => (
            <label className="min-w-0 space-y-1 text-sm" key={key}>
              {label}
              <Input defaultValue={String(search[key] ?? '')} name={key} />
            </label>
          ))}
          <label className="min-w-0 space-y-1 text-sm">
            创建时间起点（含）
            <Input defaultValue={search.created_from ?? ''} name="created_from" placeholder="2026-10-02T00:00:00Z" />
          </label>
          <label className="min-w-0 space-y-1 text-sm">
            创建时间终点（不含）
            <Input defaultValue={search.created_to ?? ''} name="created_to" placeholder="2026-10-03T00:00:00Z" />
          </label>
          {runs && (
            <>
              <RunSelect
                choices={[
                  { value: '', label: '最新尝试' },
                  { value: 'false', label: '全部历史尝试' },
                ]}
                label="尝试范围"
                onChange={(value) => change({ latest_only: value })}
                value={search.latest_only === false ? 'false' : ''}
              />
              <RunSelect
                choices={[
                  { value: '', label: '全部复核状态' },
                  { value: 'true', label: '需要复核' },
                  { value: 'false', label: '无需复核' },
                ]}
                label="是否需要复核"
                onChange={(value) => change({ needs_review: value })}
                value={search.needs_review === undefined ? '' : String(search.needs_review)}
              />
              <label className="min-w-0 space-y-1 text-sm">
                错误码
                <Input defaultValue={search.error_code ?? ''} name="error_code" placeholder="例如 PROVIDER_TIMEOUT" />
              </label>
            </>
          )}
          {error && (
            <p className="text-sm text-danger sm:col-span-2" role="alert">
              {error}
            </p>
          )}
          <Button className="justify-self-start" type="submit">
            应用更多筛选
          </Button>
        </form>
      </details>
    </section>
  );
}
export { RunFilters, RunSelect };
