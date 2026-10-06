import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, FormActions, FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';

const formSchema = z.object({ title: z.string().trim().min(3, '标题至少需要 3 个字符') });
type FormValues = z.infer<typeof formSchema>;

function FormDemo({ onSubmit = vi.fn() }: { onSubmit?: (values: FormValues) => void }) {
  const form = useForm<FormValues>({
    defaultValues: { title: '' },
    resolver: zodResolver(formSchema),
  });
  const titleError = form.formState.errors.title?.message;
  const rootError = form.formState.errors.root?.server?.message;
  const summaryErrors = [
    ...(titleError ? [{ id: 'title', fieldId: 'title-field', message: titleError }] : []),
    ...(rootError ? [{ id: 'root', message: rootError }] : []),
  ];

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <ErrorSummary errors={summaryErrors} />
        <FormSection description="填写可验证信息" title="基础信息">
          <FormField<FormValues, 'title'>
            description="用于识别这条记录"
            id="title-field"
            label="标题"
            name="title"
            required
            render={(context) => (
              <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} aria-required={context['aria-required']} id={context.inputId} />
            )}
          />
        </FormSection>
        <FormActions className="mt-4">
          <Button
            onClick={() => form.setError('title', { message: '服务端拒绝了这个标题' })}
            type="button"
            variant="outline"
          >
            模拟字段错误
          </Button>
          <Button
            onClick={() => form.setError('root.server', { message: '保存失败，请稍后重试' })}
            type="button"
            variant="outline"
          >
            模拟根错误
          </Button>
          <Button type="submit">保存</Button>
        </FormActions>
      </form>
    </FormProvider>
  );
}

function GuardedFormRoute() {
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  return (
    <main>
      <label><input checked={dirty} onChange={(event) => setDirty(event.target.checked)} type="checkbox" />有未保存修改</label>
      <Button onClick={() => setDirty(false)} type="button">模拟保存成功</Button>
      <a
        href="/next"
        onClick={(event) => {
          event.preventDefault();
          router.history.push('/next');
        }}
      >
        离开页面
      </a>
      <DirtyGuard when={dirty} />
    </main>
  );
}

function renderGuardRoute(browserHistory = false) {
  const rootRoute = createRootRoute({ component: Outlet });
  const formRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: GuardedFormRoute });
  const nextRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/next',
    component: () => <h1>下一个页面</h1>,
  });
  const router = createRouter({
    history: browserHistory ? createBrowserHistory() : createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([formRoute, nextRoute]),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

describe('Form Kit', () => {
  it('RHF + Zod 成功提交，不复制 domain schema', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<FormDemo onSubmit={submit} />);

    await user.type(screen.getByRole('textbox', { name: /标题/ }), '有效标题');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(submit).toHaveBeenCalledWith({ title: '有效标题' }, expect.anything());
  });

  it('客户端错误关联 label、description、field error，并可从 summary 聚焦字段', async () => {
    const user = userEvent.setup();
    render(<FormDemo />);

    await user.click(screen.getByRole('button', { name: '保存' }));
    const input = screen.getByRole('textbox', { name: /标题/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('title-field-description');
    expect(input.getAttribute('aria-describedby')).toContain('title-field-error');
    expect(screen.getAllByText('标题至少需要 3 个字符')).toHaveLength(2);

    await user.click(screen.getByRole('link', { name: '标题至少需要 3 个字符' }));
    expect(input).toHaveFocus();
  });

  it('server field/root errors 通过 setError 进入同一显示入口', async () => {
    const user = userEvent.setup();
    render(<FormDemo />);

    await user.click(screen.getByRole('button', { name: '模拟字段错误' }));
    expect(screen.getAllByText('服务端拒绝了这个标题')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '模拟根错误' }));
    expect(screen.getByText('保存失败，请稍后重试')).toBeInTheDocument();
  });

  it('clean navigation 不拦截，dirty navigation 可取消或确认', async () => {
    const user = userEvent.setup();
    const cleanView = renderGuardRoute();
    await user.click(await screen.findByRole('link', { name: '离开页面' }));
    expect(await screen.findByRole('heading', { name: '下一个页面' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    cleanView.unmount();

    const { router } = renderGuardRoute();
    await user.click(await screen.findByRole('checkbox', { name: '有未保存修改' }));
    await user.click(screen.getByRole('link', { name: '离开页面' }));
    expect(await screen.findByRole('dialog', { name: '要离开当前页面吗？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('link', { name: '离开页面' })).toHaveFocus();

    await user.click(screen.getByRole('link', { name: '离开页面' }));
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(await screen.findByRole('heading', { name: '下一个页面' })).toBeInTheDocument();
  });

  it('调用方 reset dirty 后不再拦截', async () => {
    const user = userEvent.setup();
    renderGuardRoute();
    await user.click(await screen.findByRole('checkbox', { name: '有未保存修改' }));
    await user.click(screen.getByRole('button', { name: '模拟保存成功' }));
    await user.click(screen.getByRole('link', { name: '离开页面' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '下一个页面' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('仅在 dirty 时启用 beforeunload 保护', async () => {
    window.history.replaceState({}, '', '/');
    const user = userEvent.setup();
    const { router, unmount } = renderGuardRoute(true);
    await screen.findByRole('checkbox', { name: '有未保存修改' });

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: '有未保存修改' }));
    await waitFor(() => {
      const dirtyEvent = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(dirtyEvent);
      expect(dirtyEvent.defaultPrevented).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: '模拟保存成功' }));
    await waitFor(() => {
      const resetEvent = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(resetEvent);
      expect(resetEvent.defaultPrevented).toBe(false);
    });
    unmount();
    router.history.destroy();
  });
});
