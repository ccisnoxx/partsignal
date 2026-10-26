import { useFormContext, useWatch } from 'react-hook-form';
import { FormField } from '@/design-system/forms/form-field';
import { Input } from '@/design-system/primitives/input';
import { Button } from '@/design-system/primitives/button';
import { OpportunitySelect } from './opportunity-controls';
import { EvaluationOptions } from './opportunity-evaluation-options';
import { modeLabels } from './opportunities.model';
import type { Values } from './opportunity-schedule.api';

export function ScheduleFields({ disabled }: { disabled: boolean }) {
  const form = useFormContext<Values>();
  const values = useWatch({ control: form.control }) as Values;
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['interval_hours', '评估周期（小时）', 168],
            ['lookback_days', '回看天数', 31],
            ['rule_set_revision', '自动评估规则修订号', undefined],
          ] as const
        ).map(([name, label, max]) => (
          <FormField<Values, typeof name>
            name={name}
            key={name}
            id={`schedule-${name}`}
            label={label}
            required
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={max}
                step={1}
                id={inputId}
                aria-describedby={aria['aria-describedby']}
                aria-invalid={aria['aria-invalid']}
                onChange={(event) =>
                  field.onChange(event.currentTarget.valueAsNumber)
                }
              />
            )}
          />
        ))}
      </div>
      <FormField<Values, 'scope'>
        name="scope"
        id="schedule-scope"
        label="自动评估范围"
        required
        render={({ field, inputId }) => (
          <OpportunitySelect
            id={inputId}
            label="自动评估范围"
            value={field.value}
            onChange={field.onChange}
            choices={[
              { value: 'ALL', label: '全部对象（不带实体过滤）' },
              { value: 'FILTERED', label: '明确筛选对象' },
            ]}
          />
        )}
      />
      <p className="text-xs">
        规则修订号固定使用已存在版本，不会自动跟随新规则。切换全部范围不会清空已有选择；需要显式移除实体过滤。
      </p>
      {values.scope === 'ALL' &&
        Boolean(
          values.subject_ids.length ||
          values.engine_surface_ids.length ||
          values.collection_profile_ids.length,
        ) && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              for (const name of [
                'subject_ids',
                'engine_surface_ids',
                'collection_profile_ids',
              ] as const)
                form.setValue(name, [], {
                  shouldDirty: true,
                  shouldValidate: true,
                });
            }}
          >
            明确清除周期评估实体过滤
          </Button>
        )}
      {values.scope === 'FILTERED' && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {(
            [
              { kind: 'subject_ids', label: 'Subject / 产品' },
              { kind: 'engine_surface_ids', label: 'Surface' },
              { kind: 'collection_profile_ids', label: 'Profile' },
            ] as const
          ).map(({ kind, label }) => (
            <EvaluationOptions
              key={kind}
              kind={kind}
              label={label}
              value={values[kind]}
              disabled={disabled}
              onChange={(ids) =>
                form.setValue(kind, ids, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          ))}
        </div>
      )}
      <div className="space-y-2">
        <p className="type-label">周期评估采集模式（空选表示所有历史模式）</p>
        <div className="flex flex-wrap gap-2">
          {(['MANUAL', 'API', 'BROWSER'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant="outline"
              disabled={disabled}
              aria-pressed={values.collection_modes.includes(mode)}
              onClick={() =>
                form.setValue(
                  'collection_modes',
                  values.collection_modes.includes(mode)
                    ? values.collection_modes.filter((value) => value !== mode)
                    : [...values.collection_modes, mode],
                  { shouldDirty: true, shouldValidate: true },
                )
              }
            >
              {modeLabels[mode]}
            </Button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
