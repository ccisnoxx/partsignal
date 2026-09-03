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

type LoginRequest = components['schemas']['LoginRequest'];

const loginFormSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(8, '密码至少需要 8 个字符'),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;
type LoginPageProps = {
  onSubmit: (payload: LoginRequest) => Promise<void>;
};

const fieldIds = {
  username: 'login-username',
  password: 'login-password',
} as const;

function LoginPage({ onSubmit }: LoginPageProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const form = useForm<LoginFormValues>({
    defaultValues: { username: '', password: '' },
    resolver: zodResolver(loginFormSchema),
  });
  const isSubmitting = form.formState.isSubmitting;

  async function submit(values: LoginFormValues) {
    form.clearErrors('root.server');
    try {
      await onSubmit(values);
      form.reset();
    } catch (error) {
      form.setError('root.server', {
        type: 'server',
        message: error instanceof Error ? error.message : '登录失败',
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
    <AuthPageFrame description="使用系统分配的账户进入运营工作台。" title="登录">
      <FormProvider {...form}>
        <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit(submit)}>
          <ErrorSummary errors={summaryErrors} />
          <FormField<LoginFormValues, 'username'>
            id={fieldIds.username}
            label="用户名"
            name="username"
            required
            render={(context) => (
              <Input
                {...context.field}
                aria-describedby={context['aria-describedby']}
                aria-invalid={context['aria-invalid']}
                aria-required={context['aria-required']}
                autoComplete="username"
                autoFocus
                className="h-11 md:h-8"
                disabled={isSubmitting}
                id={context.inputId}
              />
            )}
          />
          <FormField<LoginFormValues, 'password'>
            id={fieldIds.password}
            label="密码"
            name="password"
            required
            render={(context) => (
              <div className="flex items-start gap-2">
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  aria-required={context['aria-required']}
                  autoComplete="current-password"
                  className="h-11 md:h-8"
                  disabled={isSubmitting}
                  id={context.inputId}
                  type={passwordVisible ? 'text' : 'password'}
                />
                <Button
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  className="h-11 md:h-8"
                  disabled={isSubmitting}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  type="button"
                  variant="outline"
                >
                  {passwordVisible ? '隐藏' : '显示'}
                </Button>
              </div>
            )}
          />
          <Button className="h-11 w-full md:h-8" disabled={isSubmitting} type="submit">
            {isSubmitting ? '登录中…' : '登录'}
          </Button>
        </form>
      </FormProvider>
    </AuthPageFrame>
  );
}

export { LoginPage };
export type { LoginPageProps };
