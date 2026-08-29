import { useId, type ReactNode } from 'react';
import {
  useController,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { cn } from '@/shared/lib/utils';

type FormFieldRenderContext<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  field: ControllerRenderProps<TFieldValues, TName>;
  fieldState: ControllerFieldState;
  inputId: string;
  descriptionId?: string;
  errorId?: string;
  'aria-describedby'?: string;
  'aria-invalid': boolean;
  'aria-required'?: boolean;
};

type FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  name: TName;
  label: string;
  description?: string;
  id?: string;
  required?: boolean;
  className?: string;
  render: (context: FormFieldRenderContext<TFieldValues, TName>) => ReactNode;
};

function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ className, description, id, label, name, render, required }: FormFieldProps<TFieldValues, TName>) {
  const { field, fieldState } = useController<TFieldValues, TName>({ name });
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = fieldState.error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="type-label block text-text-primary" htmlFor={inputId}>
        {label}
        {required && <span aria-hidden="true" className="ml-1 text-danger">*</span>}
      </label>
      {description && (
        <p className="text-xs text-text-secondary" id={descriptionId}>
          {description}
        </p>
      )}
      {render({
        field,
        fieldState,
        inputId,
        descriptionId,
        errorId,
        'aria-describedby': describedBy,
        'aria-invalid': fieldState.invalid,
        'aria-required': required,
      })}
      {fieldState.error && (
        <p className="text-xs text-danger" id={errorId} role="alert">
          {fieldState.error.message}
        </p>
      )}
    </div>
  );
}

export { FormField };
export type { FormFieldProps, FormFieldRenderContext };
