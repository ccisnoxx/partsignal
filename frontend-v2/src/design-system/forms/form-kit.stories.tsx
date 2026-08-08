import { zodResolver } from '@hookform/resolvers/zod';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { fn } from 'storybook/test';
import { z } from 'zod';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, FormActions, FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';

const schema = z.object({
  title: z.string().trim().min(3, '标题至少需要 3 个字符'),
  source: z.url('请输入有效的来源 URL'),
});
type Values = z.infer<typeof schema>;

function FormStory({ disabled = false, initialErrors = false }: { disabled?: boolean; initialErrors?: boolean }) {
  const form = useForm<Values>({
    defaultValues: { title: initialErrors ? 'x' : '额定电压', source: initialErrors ? 'invalid' : 'https://example.com/spec' },
    resolver: zodResolver(schema),
  });
  useEffect(() => {
    if (initialErrors) void form.trigger();
  }, [form, initialErrors]);

  const errors = [
    ...(form.formState.errors.title?.message ? [{ id: 'title', fieldId: 'story-title', message: form.formState.errors.title.message }] : []),
    ...(form.formState.errors.source?.message ? [{ id: 'source', fieldId: 'story-source', message: form.formState.errors.source.message }] : []),
  ];

  return (
    <main className="mx-auto max-w-2xl bg-surface-app p-6">
      <h1 className="sr-only">Form Kit</h1>
      <FormProvider {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(fn())}>
          <ErrorSummary errors={errors} />
          <FormSection description="业务 schema 由调用方持有" title="基础事实">
            <FormField<Values, 'title'>
              description="简短、可识别的事实名称"
              id="story-title"
              label="标题"
              name="title"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} aria-required={context['aria-required']} id={context.inputId} />}
            />
            <FormField<Values, 'source'>
              description="用于人工复核的原始来源"
              id="story-source"
              label="来源 URL"
              name="source"
              required
              render={(context) => <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} aria-required={context['aria-required']} id={context.inputId} type="url" />}
            />
          </FormSection>
          <FormActions>
            <Button type="button" variant="outline">取消</Button>
            <Button disabled={disabled} focusableWhenDisabled type="submit">保存</Button>
          </FormActions>
          {disabled && <p className="text-right text-xs text-text-secondary">只读快照不可提交</p>}
        </form>
      </FormProvider>
    </main>
  );
}

function DirtyRoute() {
  const [value, setValue] = useState('初始内容');
  const router = useRouter();
  const dirty = value !== '初始内容';
  return (
    <main className="mx-auto max-w-xl space-y-4 bg-surface-app p-6">
      <h1 className="type-page-title">Dirty Form</h1>
      <label className="type-label block" htmlFor="dirty-title">标题</label>
      <Input id="dirty-title" onChange={(event) => setValue(event.target.value)} value={value} />
      <p className="text-sm text-text-secondary">{dirty ? '有未保存修改' : '修改字段后将启用离开保护'}</p>
      <a
        className="text-primary underline"
        href="/next"
        onClick={(event) => {
          event.preventDefault();
          router.history.push('/next');
        }}
      >
        离开当前页面
      </a>
      <DirtyGuard when={dirty} />
    </main>
  );
}

function DirtyFormStory() {
  const [router] = useState(() => {
    const root = createRootRoute({ component: Outlet });
    const form = createRoute({ getParentRoute: () => root, path: '/', component: DirtyRoute });
    const next = createRoute({ getParentRoute: () => root, path: '/next', component: () => <h1>目标页面</h1> });
    return createRouter({ history: createMemoryHistory({ initialEntries: ['/'] }), routeTree: root.addChildren([form, next]) });
  });
  return <RouterProvider router={router} />;
}

const meta = {
  title: 'Design System/Form Kit',
  component: FormStory,
} satisfies Meta<typeof FormStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DirtyForm: Story = { name: 'Dirty Form', render: () => <DirtyFormStory /> };
export const ValidationErrors: Story = { name: 'Validation Errors', args: { initialErrors: true } };
export const DisabledSubmit: Story = {
  name: 'Disabled Submit',
  args: { disabled: true },
  render: (args) => (
    <>
      <FormStory {...args} />
      <StickyActionBar
        actions={[{ key: 'submit', label: '提交审核', intent: 'primary', enabled: false, disabledReason: 'Server 未提供该动作', onSelect: fn() }]}
        status="动作资格来自已解析的 UI actions"
      />
    </>
  ),
};
