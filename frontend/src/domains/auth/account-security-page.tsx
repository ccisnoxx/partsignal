import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, type ErrorSummaryItem } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import type { components } from '@/shared/api/generated/schema';
import { AuthPageFrame } from './auth-page-frame';

type ChangePasswordRequest = components['schemas']['ChangePasswordRequest'];

const changePasswordFormSchema = z.object({
  old_password: z.string().min(8, '当前密码至少需要 8 个字符'),
  new_password: z.string().min(8, '新密码至少需要 8 个字符'),
});

type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;
type AccountSecurityPageProps = {
  mustChangePassword: boolean;
  onSubmit: (payload: ChangePasswordRequest) => Promise<void>;
};

const fieldIds = {
  old_password: 'account-security-old-password',
  new_password: 'account-security-new-password',
} as const;

function AccountSecurityPage({ mustChangePassword, onSubmit }: AccountSecurityPageProps) {
  const [passwordsVisible, setPasswordsVisible] = useState(false);
  const form = useForm<ChangePasswordFormValues>({
    defaultValues: { old_password: '', new_password: '' },
    resolver: zodResolver(changePasswordFormSchema),
  });
  const isSubmitting = form.formState.isSubmitting;

  async function submit(values: ChangePasswordFormValues) {
    form.clearErrors('root.server');
    try {
      await onSubmit(values);
      form.reset();
    } catch (error) {
      form.setError('root.server', {
        type: 'server',
        message: error instanceof Error ? error.message : '修改密码失败',
      });
    }
  }

  const summaryErrors: ErrorSummaryItem[] = (Object.keys(fieldIds) as Array<keyof typeof fieldIds>).flatMap((field) => {
    const message = form.formState.errors[field]?.message;
    return message ? [{ id: field, fieldId: fieldIds[field], message }] : [];
  });
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });

  return (
    <AuthPageFrame
      description={mustChangePassword
        ? '首次登录必须修改临时密码，完成前不能进入业务页面。'
        : '修改成功后，当前会话继续有效，其他会话将由服务端撤销。'}
      title="修改密码"
    >
      <FormProvider {...form}>
        <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={summaryErrors} />
          <FormField<ChangePasswordFormValues, 'old_password'>
            id={fieldIds.old_password}
            label="当前密码"
            name="old_password"
            required
            render={(context) => (
              <Input
                {...context.field}
                aria-describedby={context['aria-describedby']}
                aria-invalid={context['aria-invalid']}
                aria-required={context['aria-required']}
                autoComplete="current-password"
                autoFocus
                disabled={isSubmitting}
                id={context.inputId}
                type={passwordsVisible ? 'text' : 'password'}
              />
            )}
          />
          <FormField<ChangePasswordFormValues, 'new_password'>
            id={fieldIds.new_password}
            label="新密码"
            name="new_password"
            required
            render={(context) => (
              <Input
                {...context.field}
                aria-describedby={context['aria-describedby']}
                aria-invalid={context['aria-invalid']}
                aria-required={context['aria-required']}
                autoComplete="new-password"
                disabled={isSubmitting}
                id={context.inputId}
                type={passwordsVisible ? 'text' : 'password'}
              />
            )}
          />
          <Button
            aria-label={passwordsVisible ? '隐藏密码' : '显示密码'}
            disabled={isSubmitting}
            onClick={() => setPasswordsVisible((visible) => !visible)}
            type="button"
            variant="outline"
          >
            {passwordsVisible ? '隐藏密码' : '显示密码'}
          </Button>
          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? '修改中…' : '确认修改'}
          </Button>
        </form>
      </FormProvider>
    </AuthPageFrame>
  );
}

export { AccountSecurityPage };
export type { AccountSecurityPageProps };
