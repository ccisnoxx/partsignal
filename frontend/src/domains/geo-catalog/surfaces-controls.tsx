import { FormField } from '@/design-system/forms/form-field';
import { Input } from '@/design-system/primitives/input';
import { CatalogSelect } from './catalog-controls';

function SurfaceTextField({ name, label, description, maxLength = 160, required, type = 'text' }: {
  name: string; label: string; description?: string; maxLength?: number; required?: boolean; type?: 'text' | 'number';
}) {
  return <FormField description={description} id={`surfaces-${name}`} label={label} name={name} required={required} render={({ field, inputId, ...aria }) => (
    <Input {...field} aria-describedby={aria['aria-describedby']} aria-invalid={aria['aria-invalid']} aria-required={aria['aria-required']} id={inputId} maxLength={maxLength} step={type === 'number' ? 'any' : undefined} type={type} />
  )} />;
}

function SurfaceChoiceField({ name, label, choices }: {
  name: string; label: string; choices: readonly { value: string; label: string }[];
}) {
  return <FormField id={`surfaces-${name}`} label={label} name={name} render={({ field, inputId, ...aria }) => (
    <CatalogSelect choices={choices} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label={label} onChange={field.onChange} value={field.value} />
  )} />;
}

function SurfaceBooleanField({ name, label }: { name: string; label: string }) {
  return <FormField id={`surfaces-${name}`} label={label} name={name} render={({ field, inputId, ...aria }) => (
    <CatalogSelect choices={[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label={label} onChange={(value) => field.onChange(value === 'true')} value={String(field.value)} />
  )} />;
}
export { SurfaceTextField, SurfaceChoiceField, SurfaceBooleanField };
