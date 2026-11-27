import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import {
  capturePrincipalContinuation,
  type PrincipalContinuation,
} from '@/app/auth/principal-epoch';
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
import { campaignKeys } from '@/domains/campaigns/campaign.api';
import type { components } from '@/shared/api/generated/schema';
import { ContentBriefFields } from './content-brief-fields';
import {
  contentKeys,
  contentTaskCreationOptionsQueryOptions,
  createContentTask,
  mapContentTaskCreateError,
} from './content.api';
import {
  newContentTaskFormSchema,
  resolveCampaignHandoff,
  resolveProductHandoff,
  splitContentRestrictions,
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
  onProductIdChange: (productId: string | undefined) => void;
  search: NewContentTaskSearch;
};

const NO_CAMPAIGN_VALUE = '__NONE__';

const emptyValues: NewContentTaskFormValues = {
  campaign_id: '',
  product_id: '',
  fact_version_id: '',
  platform_profile_id: '',
  query_topic_id: '',
  target_question: '',
  search_intent: 'PRODUCT',
  content_angle: '',
  target_audience: '',
  must_answer_questions_text: '',
  required_fact_points_text: '',
  forbidden_expressions_text: '',
  content_format: '',
  cta: '',
  target_keywords_text: '',
  success_metrics_notes: '',
};

const fieldIds: Partial<Record<NewContentTaskField, string>> = {
  campaign_id: 'new-content-task-campaign',
  product_id: 'new-content-task-product',
  fact_version_id: 'new-content-task-fact-version',
  platform_profile_id: 'new-content-task-platform',
  query_topic_id: 'new-content-task-topic',
  target_question: 'new-content-task-target-question',
  search_intent: 'new-content-task-search-intent',
  content_angle: 'new-content-task-content-angle',
  target_audience: 'new-content-task-audience',
  must_answer_questions_text: 'new-content-task-must-answer',
  required_fact_points_text: 'new-content-task-required-facts',
  forbidden_expressions_text: 'new-content-task-forbidden',
  content_format: 'new-content-task-format',
  cta: 'new-content-task-cta',
  target_keywords_text: 'new-content-task-keywords',
  success_metrics_notes: 'new-content-task-metrics-notes',
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
  const campaignHandoff = useMemo(() => resolveCampaignHandoff(search), [search]);
  const requestedProductId = handoff.kind === 'valid' ? handoff.productId : undefined;
  const requestedCampaignId = campaignHandoff.kind === 'valid'
    ? campaignHandoff.campaignId
    : undefined;
  const options = useQuery(
    contentTaskCreationOptionsQueryOptions(requestedProductId, requestedCampaignId),
  );
  const currentOptions = options.isPlaceholderData ? undefined : options.data;
  const [requestId, setRequestId] = useState<string>();
  const [createdTask, setCreatedTask] = useState<{
    id: string;
    continuation: PrincipalContinuation;
  }>();
  const initialized = useRef(false);
  const forbiddenCustomized = useRef(false);
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
  const selectedCampaignId = useWatch({ control: form.control, name: 'campaign_id' });
  const selectedProductId = useWatch({ control: form.control, name: 'product_id' });
  const selectedFactId = useWatch({ control: form.control, name: 'fact_version_id' });

  useEffect(() => {
    if (!createdTask || isDirty || !createdTask.continuation.isCurrent()) return;
    onCreated(createdTask.id);
  }, [createdTask, isDirty, onCreated]);

  const selectedCampaign = currentOptions?.campaigns.find(
    (item) => item.id === selectedCampaignId,
  );

  useEffect(() => {
    if (!currentOptions) return;
    const requested = currentOptions.requested_product;
    const matchesHandoff = handoff.kind === 'valid'
      ? requested?.product_id === handoff.productId
      : requested === null;
    const reqCamp = currentOptions.requested_campaign;
    const matchesCampaignHandoff = campaignHandoff.kind === 'valid'
      ? reqCamp?.campaign_id === campaignHandoff.campaignId
      : reqCamp === null;
    if (!matchesHandoff || !matchesCampaignHandoff) return;
    const eligibleProductId = handoff.kind === 'valid'
      && requested?.eligibility === 'ELIGIBLE'
      ? handoff.productId
      : '';
    const eligibleCampaignId = campaignHandoff.kind === 'valid'
      && reqCamp?.eligibility === 'ELIGIBLE'
      ? campaignHandoff.campaignId
      : '';
    const matchedCampaign = eligibleCampaignId
      ? currentOptions.campaigns.find((item) => item.id === eligibleCampaignId)
      : undefined;
    const compatibleProductId = eligibleProductId
      && (!matchedCampaign || matchedCampaign.product_ids.includes(eligibleProductId))
      ? eligibleProductId
      : '';
    if (!initialized.current) {
      form.reset({
        ...emptyValues,
        campaign_id: eligibleCampaignId,
        product_id: compatibleProductId,
        target_audience: matchedCampaign?.target_audience ?? '',
      });
      initialized.current = true;
    } else if (
      eligibleProductId
      && form.getValues('product_id') !== eligibleProductId
      && (!selectedCampaign || selectedCampaign.product_ids.includes(eligibleProductId))
    ) {
      form.reset(
        { ...form.getValues(), product_id: eligibleProductId, fact_version_id: '' },
        { keepDefaultValues: true, keepErrors: true },
      );
      form.clearErrors('fact_version_id');
    }
  }, [campaignHandoff, currentOptions, form, handoff, selectedCampaign]);
  const scopedProducts = useMemo(() => {
    const all = currentOptions?.products ?? [];
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.product_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [currentOptions?.products, selectedCampaign]);
  const scopedTopics = useMemo(() => {
    const all = currentOptions?.topics ?? [];
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.query_topic_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [currentOptions?.topics, selectedCampaign]);
  const scopedPlatforms = useMemo(() => {
    const all = currentOptions?.platforms ?? [];
    if (!selectedCampaign) return all;
    const allowed = new Set(selectedCampaign.platform_profile_ids);
    return all.filter((item) => allowed.has(item.id));
  }, [currentOptions?.platforms, selectedCampaign]);

  const selectedProduct = scopedProducts.find(
    (product) => product.id === selectedProductId,
  );
  const selectedFact = selectedProduct?.approved_fact_versions.find(
    (fact) => fact.id === selectedFactId,
  );

  const campaignItems = [
    { value: NO_CAMPAIGN_VALUE, label: '不关联内容活动（独立任务）' },
    ...(currentOptions?.campaigns ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];
  const productItems = scopedProducts.map((product) => ({
    value: product.id,
    label: `${product.brand} · ${product.part_number}`,
  }));
  const factItems = selectedProduct?.approved_fact_versions.map((fact) => ({
    value: fact.id,
    label: `v${fact.version} · ${confidentialityLabels[fact.classification]}`,
  })) ?? [];
  const topicItems = scopedTopics.map((topic) => ({
    value: topic.id,
    label: topic.canonical_question,
  }));
  const platformItems = scopedPlatforms.map((platform) => ({
    value: platform.id,
    label: platform.name,
  }));

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
    const continuation = capturePrincipalContinuation(queryClient);
    try {
      const task = await create.mutateAsync({ body, key });
      if (!continuation.isCurrent()) return;
      idempotency.current = undefined;
      form.reset(values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
        ...(body.campaign_id
          ? [queryClient.invalidateQueries({ queryKey: campaignKeys.all() })]
          : []),
      ]);
      if (!continuation.isCurrent()) return;
      setCreatedTask({ id: task.id, continuation });
    } catch (error) {
      if (!continuation.isCurrent()) return;
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
        <p className="text-text-secondary">
          选择可选活动、产品与已批准事实、目标问题主题、目标平台，并冻结本次任务的内容 Brief。
        </p>
      </header>

      <HandoffStatus
        campaignHandoff={campaignHandoff}
        handoff={handoff}
        options={currentOptions}
      />

      {(options.isPending || options.isPlaceholderData) && (
        <div className="rounded-xl border border-border-subtle p-4 text-sm text-text-secondary" aria-busy="true">
          正在读取可选活动、产品、事实版本、问题主题和平台…
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
          {currentOptions.topics.length === 0 && (
            <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-4" role="status">
              <p>当前没有活跃的问题主题。请先创建或启用至少一个目标问题主题。</p>
              <a className={buttonVariants({ variant: 'outline' })} href="/geo/topics">管理问题主题</a>
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
                description="可选范围是当前快照；创建时服务端会在事务内重新校验活动归属与资源活跃状态。"
                title="任务上下文"
              >
                <FormField<NewContentTaskFormValues, 'campaign_id'>
                  description="可选。绑定活动后，下方产品、问题主题与平台将自动限定在该活动范围内。"
                  id={fieldIds.campaign_id}
                  label="所属内容活动"
                  name="campaign_id"
                  render={(context) => (
                    <TaskSelect
                      {...selectAria(context)}
                      disabled={create.isPending}
                      id={context.inputId}
                      items={campaignItems}
                      onChange={(next) => {
                        const resolved = next === NO_CAMPAIGN_VALUE ? '' : next;
                        context.field.onChange(resolved);
                        const camp = currentOptions.campaigns.find((item) => item.id === resolved);
                        if (camp) {
                          if (!camp.product_ids.includes(form.getValues('product_id'))) {
                            form.setValue('product_id', '', { shouldDirty: true });
                            form.setValue('fact_version_id', '', { shouldDirty: true });
                            if (search.productId) onProductIdChange(undefined);
                          }
                          if (!camp.query_topic_ids.includes(form.getValues('query_topic_id'))) {
                            form.setValue('query_topic_id', '', { shouldDirty: true });
                          }
                          if (!camp.platform_profile_ids.includes(form.getValues('platform_profile_id'))) {
                            form.setValue('platform_profile_id', '', { shouldDirty: true });
                          }
                          if (camp.target_audience && !form.getValues('target_audience').trim()) {
                            form.setValue('target_audience', camp.target_audience, { shouldDirty: true });
                          }
                        }
                      }}
                      placeholder="不关联内容活动"
                      value={context.field.value || NO_CAMPAIGN_VALUE}
                    />
                  )}
                />
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
                  description="更换产品后必须重新选择属于该产品的事实版本；选择后会自动带出禁止表达预填。"
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
                      onChange={(factId) => {
                        context.field.onChange(factId);
                        const chosen = selectedProduct?.approved_fact_versions.find(
                          (fact) => fact.id === factId,
                        );
                        if (chosen && !forbiddenCustomized.current) {
                          form.setValue(
                            'forbidden_expressions_text',
                            splitContentRestrictions(chosen.content_restrictions),
                            { shouldDirty: true },
                          );
                        }
                      }}
                      placeholder={selectedProduct ? '选择事实版本' : '请先选择产品'}
                      value={context.field.value}
                    />
                  )}
                />
                <FormField<NewContentTaskFormValues, 'query_topic_id'>
                  description="新建普通内容任务必须绑定活跃目标问题主题；选择后自动填充目标问题与搜索意图。"
                  id={fieldIds.query_topic_id}
                  label="目标问题主题"
                  name="query_topic_id"
                  required
                  render={(context) => (
                    <TaskSelect
                      {...selectAria(context)}
                      disabled={create.isPending || topicItems.length === 0}
                      id={context.inputId}
                      items={topicItems}
                      onChange={(topicId) => {
                        context.field.onChange(topicId);
                        const chosen = scopedTopics.find((item) => item.id === topicId);
                        if (chosen) {
                          form.setValue('target_question', chosen.canonical_question, {
                            shouldDirty: true,
                          });
                          form.setValue('search_intent', chosen.intent_type, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      placeholder="选择目标问题主题"
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
              <ContentBriefFields
                approvedClaimsSummary={selectedFact?.approved_claims_summary}
                disabled={create.isPending}
                onForbiddenEdited={() => { forbiddenCustomized.current = true; }}
              />
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
  campaignHandoff,
  handoff,
  options,
}: {
  campaignHandoff: ReturnType<typeof resolveCampaignHandoff>;
  handoff: ReturnType<typeof resolveProductHandoff>;
  options?: CreationOptions;
}) {
  const notices: React.ReactNode[] = [];

  if (campaignHandoff.kind === 'invalid') {
    notices.push(
      <HandoffWarning key="campaign-invalid">
        {campaignHandoff.value
          ? `链接中的 campaignId“${campaignHandoff.value}”不是有效 UUID，未自动关联活动。`
          : '链接中的 campaignId 为空，未自动关联活动。'}
      </HandoffWarning>,
    );
  } else if (campaignHandoff.kind === 'valid' && options) {
    const reqCamp = options.requested_campaign;
    if (!reqCamp || reqCamp.campaign_id !== campaignHandoff.campaignId) {
      notices.push(
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
          key="campaign-missing"
          role="alert"
        >
          服务端未返回链接活动的资格状态，请重试。
        </div>,
      );
    } else if (reqCamp.eligibility === 'ELIGIBLE') {
      notices.push(
        <div
          className="rounded-xl border border-success/30 bg-success/10 p-4"
          key="campaign-eligible"
          role="status"
        >
          已根据链接预选内容活动：{reqCamp.name ?? reqCamp.campaign_id}
        </div>,
      );
    } else if (reqCamp.eligibility === 'NOT_FOUND') {
      notices.push(
        <HandoffWarning key="campaign-not-found">
          链接指定的内容活动不存在。未自动关联活动。
        </HandoffWarning>,
      );
    } else if (reqCamp.eligibility === 'CAMPAIGN_NOT_ELIGIBLE') {
      notices.push(
        <HandoffWarning key="campaign-not-eligible">
          链接指定的内容活动“{reqCamp.name ?? reqCamp.campaign_id}”当前状态不可新建关联任务（仅草稿或进行中活动允许）。
        </HandoffWarning>,
      );
    }
  }

  if (handoff.kind === 'invalid') {
    notices.push(
      <HandoffWarning key="product-invalid">
        {handoff.value
          ? `链接中的 productId“${handoff.value}”不是有效 UUID，未自动选择产品。`
          : '链接中的 productId 为空，未自动选择产品。'}
      </HandoffWarning>,
    );
  } else if (handoff.kind === 'valid' && options) {
    const requested = options.requested_product;
    if (!requested || requested.product_id !== handoff.productId) {
      notices.push(
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
          key="product-missing"
          role="alert"
        >
          服务端未返回链接产品的资格状态，请重试。
        </div>,
      );
    } else {
      const identity = [requested.brand, requested.part_number].filter(Boolean).join(' · ');
      switch (requested.eligibility) {
        case 'ELIGIBLE':
          notices.push(
            <div
              className="rounded-xl border border-success/30 bg-success/10 p-4"
              key="product-eligible"
              role="status"
            >
              已根据链接预选产品：{identity}
            </div>,
          );
          break;
        case 'NOT_FOUND':
          notices.push(
            <HandoffWarning key="product-not-found">
              链接指定的产品不存在。未自动改选其他产品。
            </HandoffWarning>,
          );
          break;
        case 'PRODUCT_INACTIVE':
          notices.push(
            <HandoffWarning key="product-inactive">
              链接指定的产品“{identity}”已停用。您可以显式选择其他合格产品。
            </HandoffWarning>,
          );
          break;
        case 'NO_APPROVED_FACTS':
          notices.push(
            <HandoffWarning key="product-no-facts">
              链接指定的产品“{identity}”没有非空的已批准事实版本。{' '}
              <a className="underline underline-offset-2" href={`/products/${requested.product_id}/facts`}>
                进入产品事实
              </a>
            </HandoffWarning>,
          );
          break;
        default:
          return assertNever(requested.eligibility);
      }
    }
  }

  if (notices.length === 0) return null;
  return <div className="space-y-2">{notices}</div>;
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
