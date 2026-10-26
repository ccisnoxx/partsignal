import { useFormContext, useWatch } from 'react-hook-form';
import { FormField } from '@/design-system/forms/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import type { ManualValues } from './manual.model';

type Observation = components['schemas']['GeoCitationObservation'];
const labels: Record<Observation['status'] | 'UNRECORDED', string> = {
  UNRECORDED: '未记录（草稿）',
  COMPLETE: '已完整记录引用',
  NONE: '确认无引用',
  PARTIAL: '引用部分缺失',
  UNKNOWN: '无法判断引用',
};
function CitationObservationFields({ disabled }: { disabled: boolean }) {
  const { control } = useFormContext<ManualValues>();
  const status = useWatch({ control, name: 'citation_observation_status' });
  return (
    <div className="min-w-0 space-y-3">
      <FormField<ManualValues, 'citation_observation_status'>
        id="manual-citation_observation_status"
        label="引用观察状态"
        name="citation_observation_status"
        render={({ field, inputId, ...aria }) => (
          <Select disabled={disabled} onValueChange={field.onChange} value={field.value}>
            <SelectTrigger
              aria-describedby={aria['aria-describedby']}
              aria-invalid={aria['aria-invalid']}
              id={inputId}
              onBlur={field.onBlur}
              ref={field.ref}
            >
              <SelectValue>{labels[field.value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(labels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <p className="text-sm text-text-secondary">
        请查看完整回答及来源区域后声明。空列表不会自动判定为无引用。部分缺失或无法判断的观测不进入引用类指标。
      </p>
      {['PARTIAL', 'UNKNOWN'].includes(status) && (
        <FormField<ManualValues, 'citation_missing_reason'>
          id="manual-citation_missing_reason"
          label="引用缺失原因"
          name="citation_missing_reason"
          render={({ field, inputId, ...aria }) => (
            <Textarea
              {...field}
              aria-describedby={aria['aria-describedby']}
              aria-invalid={aria['aria-invalid']}
              id={inputId}
              maxLength={2000}
              rows={3}
            />
          )}
        />
      )}
    </div>
  );
}
function CitationObservationSummary({ observation }: { observation: Observation | null | undefined }) {
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p>引用观察状态：{observation ? labels[observation.status] : '未记录'}</p>
      {observation?.missing_reason && (
        <p className="whitespace-pre-wrap break-words">引用缺失原因：{observation.missing_reason}</p>
      )}
      {!observation && (
        <p className="text-text-secondary">没有采集声明，不能据引用数量推测来源观察是否完整。</p>
      )}
    </div>
  );
}
export { CitationObservationFields, CitationObservationSummary };
