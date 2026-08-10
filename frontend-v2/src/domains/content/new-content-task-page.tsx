import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import {
  ErrorSummary,
  FormActions,
  FormSection,
  type ErrorSummaryItem,
} from '@/design-system/forms/form-layout';
import { Button, buttonVariants } from '@/design-system/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import type { components } from '@/shared/api/generated/schema';
import {
  contentKeys,
  contentTaskCreationOptionsQueryOptions,
  createContentTask,
  mapContentTaskCreateError,
} from './content.api';
import {
  newContentTaskFormSchema,
  resolveProductHandoff,
  toContentTaskCreate,
  type NewContentTaskField,
  type NewContentTaskFormValues,
  type NewContentTaskSearch,
} from './new-content-task.model';

type CreationOptions = components['schemas']['ContentTaskCreationOptions'];
type Confidentiality = components['schemas']['Confidentiality'];

type NewContentTaskPageProps = {
  csrfToken: string | null;
  onCancel: () => void;
  onCreated: (taskId: string) => void;
  onProductIdChange: (productId: string) => void;
  search: NewContentTaskSearch;
};

const emptyValues: NewContentTaskFormValues = {
  product_id: '',
  fact_version_id: '',
  platform_profile_id: '',
};

const fieldIds: Record<NewContentTaskField, string> = {
  product_id: 'new-content-task-product',
  fact_version_id: 'new-content-task-fact-version',
  platform_profile_id: 'new-content-task-platform',
};

const confidentialityLabels = {
  PUBLIC: '公开',
  INTERNAL: '内部',
  RESTRICTED: '受限',
} satisfies Record<Confidentiality, string>;

function NewContentTaskPage({
  csrfToken,
  onCancel,
  onCreated,
  onProductIdChange,
  search,
}: NewContentTaskPageProps) {
  const queryClient = useQueryClient();
  const handoff = useMemo(() => resolveProductHandoff(search), [search]);
  const requestedProductId = handoff.kind === 'valid' ? handoff.productId : undefined;
  const options = useQuery(contentTaskCreationOptionsQueryOptions(requestedProductId));
  const currentOptions = options.isPlaceholderData ? undefined : options.data;
  const [requestId, setRequestId] = useState<string>();
  const [createdTaskId, setCreatedTaskId] = useState<string>();
  const initialized = useRef(false);
  const idempotency = useRef<{ signature: string; key: string } | undefined>(undefined);
  const submitting = useRef(false);
  const form = useForm<NewContentTaskFormValues>({
    defaultValues: emptyValues,
    resolver: zodResolver(newContentTaskFormSchema),
  });
  const create = useMutation({
    mutationFn: ({ body, key }: {
      body: ReturnType<typeof toContentTaskCreate>;
      key: string;
    }) => createContentTask(body, csrfToken, key),
  });
  const isDirty = form.formState.isDirty;
  const selectedProductId = useWatch({ control: form.control, name: 'product_id' });

  useEffect(() => {
    if (!currentOptions) return;
    const requested = currentOptions.requested_product;
    const matchesHandoff = handoff.kind === 'valid'
      ? requested?.product_id === handoff.productId
      : requested === null;
    if (!matchesHandoff) return;
    const eligibleProductId = handoff.kind === 'valid'
      && requested?.eligibility === 'ELIGIBLE'
      ? handoff.productId
      : '';
    if (!initialized.current) {
      form.reset({ ...emptyValues, product_id: eligibleProductId });
      initialized.current = true;
    } else if (form.getValues('product_id') !== eligibleProductId) {
      form.reset(
        { ...form.getValues(), product_id: eligibleProductId, fact_version_id: '' },
        { keepDefaultValues: true, keepErrors: true },
      );
      form.clearErrors('fact_version_id');
    }
  }, [currentOptions, form, handoff]);

  useEffect(() => {
    if (!createdTaskId || isDirty) return;
    onCreated(createdTaskId);
  }, [createdTaskId, isDirty, onCreated]);

  const selectedProduct = currentOptions?.products.find(
    (product) => product.id === selectedProductId,
  );
  const productItems = currentOptions?.products.map((product) => ({
    value: product.id,
    label: `${product.brand} · ${product.part_number}`,
  })) ?? [];
  const factItems = selectedProduct?.approved_fact_versions.map((fact) => ({
    value: fact.id,
    label: `v${fact.version} · ${confidentialityLabels[fact.classification]}`,
  })) ?? [];
  const platformItems = currentOptions?.platforms.map((platform) => ({
    value: platform.id,
    label: platform.name,
  })) ?? [];

  async function submit(values: NewContentTaskFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    create.reset();
    const body = toContentTaskCreate(values);
    const signature = JSON.stringify(body);
    const key = idempotency.current?.signature === signature
      ? idempotency.current.key
      : crypto.randomUUID();
    idempotency.current = { signature, key };
    try {
      const task = await create.mutateAsync({ body, key });
      idempotency.current = undefined;
      form.reset(values);
      await queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
      setCreatedTaskId(task.id);
    } catch (error) {
      const mapped = mapContentTaskCreateError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as NewContentTaskField, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      if (mapped.code === 'IDEMPOTENCY_CONFLICT') idempotency.current = undefined;
      setRequestId(mapped.requestId);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    void form.handleSubmit(submit, () => {
      create.reset();
      setRequestId(undefined);
    })(event).finally(() => {
      submitting.current = false;
    });
  }

  const summaryErrors: ErrorSummaryItem[] = (
    Object.keys(fieldIds) as NewContentTaskField[]
  ).flatMap((field) => {
    const message = form.formState.errors[field]?.message;
    return message ? [{ id: field, fieldId: fieldIds[field], message }] : [];
  });
  const formMessage = form.formState.errors.root?.server?.message;
  if (formMessage) summaryErrors.push({ id: 'form', message: formMessage });
  if (requestId) summaryErrors.push({ id: 'request-id', message: `请求 ID：${requestId}` });

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="new-content-task-title">
      <header className="space-y-1">
        <h1 className="type-page-title" id="new-content-task-title">创建内容任务</h1>
        <p className="text-text-secondary">选择产品、已批准事实版本和目标平台。</p>
      </header>

      <HandoffStatus
        handoff={handoff}
        options={currentOptions}
      />

      {(options.isPending || options.isPlaceholderData) && (
        <div className="rounded-xl border border-border-subtle p-4 text-sm text-text-secondary" aria-busy="true">
          正在读取可选产品、事实版本和平台…
        </div>
      )}
      {options.isError && (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
          <p>{errorMessage(options.error)}</p>
          <Button onClick={() => void options.refetch()} type="button" variant="outline">重试</Button>
        </div>
      )}

      {currentOptions && (
        <>
          {currentOptions.products.length === 0 && (
            <div className="space-y-2 rounded-xl border border-border-subtle p-4" role="status">
              <p>当前没有同时满足“产品活动且存在非空已批准事实”的产品。</p>
              <a className={buttonVariants({ variant: 'outline' })} href="/products">查看产品与事实</a>
            </div>
          )}
          {currentOptions.platforms.length === 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4" role="status">
              当前没有活动的具体平台。请先由管理员在平台配置中启用至少一个平台。
            </div>
          )}

          <FormProvider {...form}>
            <form
              className="space-y-5"
              noValidate
              onSubmit={handleFormSubmit}
            >
              <ErrorSummary errors={summaryErrors} />
              <FormSection
                description="可选范围是当前快照；创建时服务端会在事务内重新校验。"
                title="任务上下文"
              >
                <FormField<NewContentTaskFormValues, 'product_id'>
                  description="只列出拥有非空已批准事实的活动产品。"
                  id={fieldIds.product_id}
                  label="产品"
                  name="product_id"
                  required
                  render={(context) => (
                    <TaskSelect
                      {...selectAria(context)}
                      disabled={create.isPending || productItems.length === 0}
                      id={context.inputId}
                      items={productItems}
                      onChange={(productId) => {
                        context.field.onChange(productId);
                        form.setValue('fact_version_id', '', {
                          shouldDirty: true,
                          shouldValidate: false,
                        });
                        form.clearErrors('fact_version_id');
                        onProductIdChange(productId);
                      }}
                      placeholder="选择产品"
                      value={context.field.value}
                    />
                  )}
                />
                <FormField<NewContentTaskFormValues, 'fact_version_id'>
                  description="更换产品后必须重新选择属于该产品的事实版本。"
                  id={fieldIds.fact_version_id}
                  label="已批准事实版本"
                  name="fact_version_id"
                  required
                  render={(context) => (
                    <TaskSelect
                      {...selectAria(context)}
                      disabled={create.isPending || !selectedProduct}
                      id={context.inputId}
                      items={factItems}
                      onChange={context.field.onChange}
                      placeholder={selectedProduct ? '选择事实版本' : '请先选择产品'}
                      value={context.field.value}
                    />
                  )}
                />
                <FormField<NewContentTaskFormValues, 'platform_profile_id'>
                  description="只列出可用于新任务的活动具体平台；Prompt 配置不影响本次创建。"
                  id={fieldIds.platform_profile_id}
                  label="目标平台"
                  name="platform_profile_id"
                  required
                  render={(context) => (
                    <TaskSelect
                      {...selectAria(context)}
                      disabled={create.isPending || platformItems.length === 0}
                      id={context.inputId}
                      items={platformItems}
                      onChange={context.field.onChange}
                      placeholder="选择目标平台"
                      value={context.field.value}
                    />
                  )}
                />
              </FormSection>
              <FormActions>
                <Button disabled={create.isPending} onClick={onCancel} type="button" variant="outline">
                  取消
                </Button>
                <Button disabled={create.isPending} type="submit">
                  {create.isPending ? '创建中…' : '创建'}
                </Button>
              </FormActions>
            </form>
          </FormProvider>
        </>
      )}
      <DirtyGuard when={isDirty} />
    </section>
  );
}

function HandoffStatus({
  handoff,
  options,
}: {
  handoff: ReturnType<typeof resolveProductHandoff>;
  options?: CreationOptions;
}) {
  if (handoff.kind === 'none') return null;
  if (handoff.kind === 'invalid') {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-4" role="alert">
        {handoff.value
          ? `链接中的 productId“${handoff.value}”不是有效 UUID，未自动选择产品。`
          : '链接中的 productId 为空，未自动选择产品。'}
      </div>
    );
  }
  if (!options) return null;
  const requested = options.requested_product;
  if (!requested || requested.product_id !== handoff.productId) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
        服务端未返回链接产品的资格状态，请重试。
      </div>
    );
  }
  const identity = [requested.brand, requested.part_number].filter(Boolean).join(' · ');
  switch (requested.eligibility) {
    case 'ELIGIBLE':
      return (
        <div className="rounded-xl border border-success/30 bg-success/10 p-4" role="status">
          已根据链接预选产品：{identity}
        </div>
      );
    case 'NOT_FOUND':
      return <HandoffWarning>链接指定的产品不存在。未自动改选其他产品。</HandoffWarning>;
    case 'PRODUCT_INACTIVE':
      return <HandoffWarning>链接指定的产品“{identity}”已停用。您可以显式选择其他合格产品。</HandoffWarning>;
    case 'NO_APPROVED_FACTS':
      return (
        <HandoffWarning>
          链接指定的产品“{identity}”没有非空的已批准事实版本。{' '}
          <a className="underline underline-offset-2" href={`/products/${requested.product_id}/facts`}>
            进入产品事实
          </a>
        </HandoffWarning>
      );
    default:
      return assertNever(requested.eligibility);
  }
}

function HandoffWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 p-4" role="alert">
      {children}
    </div>
  );
}

type TaskSelectProps = {
  'aria-describedby'?: string;
  'aria-invalid': boolean;
  'aria-required'?: boolean;
  disabled: boolean;
  id: string;
  items: { label: string; value: string }[];
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

function TaskSelect({ disabled, id, items, onChange, placeholder, value, ...aria }: TaskSelectProps) {
  return (
    <Select
      disabled={disabled}
      items={items}
      onValueChange={(next) => next && onChange(next)}
      value={value || null}
    >
      <SelectTrigger className="w-full max-w-full" id={id} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function selectAria(context: {
  'aria-describedby'?: string;
  'aria-invalid': boolean;
  'aria-required'?: boolean;
}) {
  return {
    'aria-describedby': context['aria-describedby'],
    'aria-invalid': context['aria-invalid'],
    'aria-required': context['aria-required'],
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`新建内容任务收到未知状态：${value}`);
}

export { NewContentTaskPage };
export type { NewContentTaskPageProps };
