import { type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';

import { FormField } from '@/design-system/forms/form-field';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';

type Choice = { value: string; label: string };

function CatalogSelect({ label, value, choices, onChange, disabled, id, describedBy, invalid, required }: {
  label: string; value: string; choices: readonly Choice[]; onChange: (value: string) => void;
  disabled?: boolean; id?: string; describedBy?: string; invalid?: boolean; required?: boolean;
}) {
  return (
    <Select disabled={disabled} items={choices} required={required} onValueChange={(next) => { if (next !== null) onChange(next); }} value={value}>
      <SelectTrigger aria-describedby={describedBy} aria-invalid={invalid} aria-label={label} className="w-full min-w-0" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function CatalogTextField({ name, label, maxLength, multiline = false, required = false, description }: {
  name: string; label: string; maxLength: number; multiline?: boolean; required?: boolean; description?: string;
}) {
  const { formState } = useFormContext();
  return (
    <FormField description={description} id={`catalog-${name}`} label={label} name={name} required={required} render={({ field, inputId, ...aria }) => (
      multiline
        ? <Textarea {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} disabled={formState.isSubmitting} id={inputId} maxLength={maxLength} rows={4} />
        : <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} disabled={formState.isSubmitting} id={inputId} maxLength={maxLength} />
    )} />
  );
}

function CatalogChoiceField({ name, label, choices }: { name: string; label: string; choices: readonly Choice[] }) {
  const { formState } = useFormContext();
  return <FormField id={`catalog-${name}`} label={label} name={name} render={({ field, inputId, ...aria }) => (
    <CatalogSelect choices={choices} describedBy={aria['aria-describedby']} disabled={formState.isSubmitting} id={inputId} invalid={aria['aria-invalid']} label={label} onChange={field.onChange} value={field.value} />
  )} />;
}

function CatalogNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`space-y-2 rounded-lg border p-3 text-sm ${error ? 'border-danger/30 bg-danger/5 text-danger' : 'border-border-default bg-surface-raised text-text-secondary'}`} role={error ? 'alert' : 'status'}>{children}</div>;
}

function catalogErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Catalog 请求发生未知错误';
}

export { CatalogSelect, CatalogTextField, CatalogChoiceField, CatalogNotice, catalogErrorMessage };
export type { Choice };
