import { useId, type ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

type FormSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

function FormSection({ children, className, description, title }: FormSectionProps) {
  return (
    <fieldset className={cn('space-y-4 rounded-xl border border-border-subtle p-4', className)}>
      <legend className="type-section-title px-1 text-text-primary">{title}</legend>
      {description && <p className="text-sm text-text-secondary">{description}</p>}
      {children}
    </fieldset>
  );
}

type FormActionsProps = {
  children: ReactNode;
  className?: string;
};

function FormActions({ children, className }: FormActionsProps) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>{children}</div>;
}

type ErrorSummaryItem = {
  id: string;
  message: string;
  fieldId?: string;
};

type ErrorSummaryProps = {
  errors: readonly ErrorSummaryItem[];
  title?: string;
  className?: string;
};

function ErrorSummary({ className, errors, title = '请修正以下问题' }: ErrorSummaryProps) {
  const titleId = useId();
  if (errors.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-lg border border-danger/30 bg-danger/5 p-3', className)}
      role="alert"
      tabIndex={-1}
    >
      <h2 className="font-medium text-danger" id={titleId}>{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-primary">
        {errors.map((error) => {
          const fieldId = error.fieldId;
          return (
            <li key={error.id}>
              {fieldId ? (
              <a
                className="underline underline-offset-2"
                href={`#${fieldId}`}
                onClick={(event) => {
                  const field = document.getElementById(fieldId);
                  if (!field) return;
                  event.preventDefault();
                  field.focus();
                }}
              >
                {error.message}
              </a>
              ) : (
                error.message
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { ErrorSummary, FormActions, FormSection };
export type { ErrorSummaryItem, ErrorSummaryProps, FormActionsProps, FormSectionProps };
