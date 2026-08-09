import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import {
  ErrorSummary,
  FormActions,
  FormSection,
  type ErrorSummaryItem,
} from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { createProduct, mapProductCreateError } from './new-product.api';
import {
  newProductFormSchema,
  toProductCreate,
  type NewProductField,
  type NewProductFormValues,
} from './new-product.model';
import { productsKeys } from './products-list.api';

type NewProductPageProps = {
  csrfToken: string | null;
  onCancel: () => void;
  onCreated: (productId: string) => void;
};

const fieldIds: Record<NewProductField, string> = {
  part_number: 'new-product-part-number',
  brand: 'new-product-brand',
  category: 'new-product-category',
};

function NewProductPage({ csrfToken, onCancel, onCreated }: NewProductPageProps) {
  const queryClient = useQueryClient();
  const [requestId, setRequestId] = useState<string>();
  const [createdProductId, setCreatedProductId] = useState<string>();
  const form = useForm<NewProductFormValues>({
    defaultValues: { part_number: '', brand: '', category: '' },
    resolver: zodResolver(newProductFormSchema),
  });
  const create = useMutation({ mutationFn: (values: NewProductFormValues) => createProduct(toProductCreate(values), csrfToken) });
  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (!createdProductId || isDirty) return;
    onCreated(createdProductId);
  }, [createdProductId, isDirty, onCreated]);

  async function submit(values: NewProductFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    create.reset();
    try {
      const product = await create.mutateAsync(values);
      form.reset(values);
      await queryClient.invalidateQueries({ queryKey: productsKeys.lists() });
      setCreatedProductId(product.id);
    } catch (error) {
      const mapped = mapProductCreateError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as NewProductField, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
    }
  }

  const summaryErrors: ErrorSummaryItem[] = (Object.keys(fieldIds) as NewProductField[]).flatMap((field) => {
    const message = form.formState.errors[field]?.message;
    return message ? [{ id: field, fieldId: fieldIds[field], message }] : [];
  });
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="new-product-title">
      <header className="space-y-1">
        <h1 className="type-page-title" id="new-product-title">新建产品</h1>
        <p className="text-text-secondary">创建产品身份后，将进入对应的产品详情。</p>
      </header>

      <FormProvider {...form}>
        <form
          className="space-y-5"
          noValidate
          onSubmit={form.handleSubmit(submit, () => {
            create.reset();
            setRequestId(undefined);
          })}
        >
          <ErrorSummary errors={summaryErrors} />
          <FormSection description="品牌与产品型号组合用于唯一识别产品。" title="产品身份">
            <FormField<NewProductFormValues, 'part_number'>
              description="填写产品的正式型号。"
              id={fieldIds.part_number}
              label="产品型号"
              name="part_number"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  aria-required={context['aria-required']}
                  autoComplete="off"
                  disabled={create.isPending}
                  id={context.inputId}
                  maxLength={160}
                />
              )}
            />
            <FormField<NewProductFormValues, 'brand'>
              description="填写产品所属品牌。"
              id={fieldIds.brand}
              label="品牌"
              name="brand"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  aria-required={context['aria-required']}
                  autoComplete="organization"
                  disabled={create.isPending}
                  id={context.inputId}
                  maxLength={160}
                />
              )}
            />
            <FormField<NewProductFormValues, 'category'>
              description="填写产品所属类别。"
              id={fieldIds.category}
              label="类别"
              name="category"
              required
              render={(context) => (
                <Input
                  {...context.field}
                  aria-describedby={context['aria-describedby']}
                  aria-invalid={context['aria-invalid']}
                  aria-required={context['aria-required']}
                  autoComplete="off"
                  disabled={create.isPending}
                  id={context.inputId}
                  maxLength={160}
                />
              )}
            />
          </FormSection>
          <FormActions>
            <Button disabled={create.isPending} onClick={onCancel} type="button" variant="outline">取消</Button>
            <Button disabled={create.isPending} type="submit">
              {create.isPending ? '创建中…' : '创建产品'}
            </Button>
          </FormActions>
        </form>
      </FormProvider>
      <DirtyGuard when={isDirty} />
    </section>
  );
}

export { NewProductPage };
export type { NewProductPageProps };
