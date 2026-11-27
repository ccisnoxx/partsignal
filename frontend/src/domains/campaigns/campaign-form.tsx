import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { FormField } from '@/design-system/forms/form-field';
import {
  ErrorSummary,
  FormActions,
  FormSection,
  type ErrorSummaryItem,
} from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import { intentLabels } from '@/domains/geo/query-topic-list.model';
import {
  campaignFormSchema,
  workPriorityRegistry,
  workPriorityValues,
  type CampaignFormValues,
  type ContentCampaignDetail,
  type ContentCampaignOptions,
  type WorkPriority,
} from './campaign.model';

type CampaignFormProps = {
  currentCampaign?: ContentCampaignDetail;
  initialValues: CampaignFormValues;
  options: ContentCampaignOptions;
  pending: boolean;
  serverError?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: CampaignFormValues) => Promise<void> | void;
};

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function CampaignForm({
  currentCampaign,
  initialValues,
  options,
  pending,
  serverError,
  submitLabel,
  onCancel,
  onSubmit,
}: CampaignFormProps) {
  const form = useForm<CampaignFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(campaignFormSchema),
  });

  const selectedProducts = useWatch({ control: form.control, name: 'product_ids' });
  const selectedTopics = useWatch({ control: form.control, name: 'query_topic_ids' });
  const selectedPlatforms = useWatch({ control: form.control, name: 'platform_profile_ids' });
  const selectedPlans = useWatch({ control: form.control, name: 'monitoring_plan_ids' });

  const ownerItems = options.owners.map((owner) => ({
    value: owner.id,
    label: `${owner.display_name}（${owner.username}）`,
  }));
  if (
    currentCampaign
    && !ownerItems.some((item) => item.value === currentCampaign.owner.id)
  ) {
    ownerItems.unshift({
      value: currentCampaign.owner.id,
      label: `${currentCampaign.owner.display_name}（${currentCampaign.owner.username} · 已停用/历史保留）`,
    });
  }
  const priorityItems = workPriorityValues.map((value) => ({
    value,
    label: workPriorityRegistry[value].label,
  }));

  const productCheckboxItems: {
    id: string;
    label: string;
    badge: string;
    tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
  }[] = options.products.map((item) => ({
    id: item.id,
    label: `${item.brand} · ${item.part_number}`,
    badge: item.has_approved_fact ? '已有批准事实' : '待批准事实',
    tone: item.has_approved_fact ? 'success' : 'warning',
  }));
  for (const item of currentCampaign?.products ?? []) {
    if (!productCheckboxItems.some((existing) => existing.id === item.id)) {
      productCheckboxItems.push({
        id: item.id,
        label: `${item.brand} · ${item.part_number}`,
        badge: '已停用 · 历史保留（取消后不可重选）',
        tone: 'secondary',
      });
    }
  }

  const topicCheckboxItems: {
    id: string;
    label: string;
    badge: string;
    tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
  }[] = options.topics.map((item) => ({
    id: item.id,
    label: item.canonical_question,
    badge: intentLabels[item.intent_type],
    tone: 'outline',
  }));
  for (const item of currentCampaign?.topics ?? []) {
    if (!topicCheckboxItems.some((existing) => existing.id === item.id)) {
      topicCheckboxItems.push({
        id: item.id,
        label: item.canonical_question,
        badge: '已停用 · 历史保留（取消后不可重选）',
        tone: 'secondary',
      });
    }
  }

  const platformCheckboxItems: {
    id: string;
    label: string;
    badge: string;
    tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
  }[] = options.platforms.map((item) => ({
    id: item.id,
    label: item.name,
    badge: item.configuration_complete ? 'Prompt 已配置' : '无 Prompt',
    tone: item.configuration_complete ? 'info' : 'outline',
  }));
  for (const item of currentCampaign?.platforms ?? []) {
    if (!platformCheckboxItems.some((existing) => existing.id === item.id)) {
      platformCheckboxItems.push({
        id: item.id,
        label: item.name,
        badge: '已停用 · 历史保留（取消后不可重选）',
        tone: 'secondary',
      });
    }
  }

  const planCheckboxItems: {
    id: string;
    label: string;
    badge: string;
    tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info';
  }[] = options.monitoring_plans.map((item) => ({
    id: item.id,
    label: item.name,
    badge: item.status,
    tone: 'secondary',
  }));
  for (const item of currentCampaign?.monitoring_plans ?? []) {
    if (!planCheckboxItems.some((existing) => existing.id === item.id)) {
      planCheckboxItems.push({
        id: item.id,
        label: item.name,
        badge: '已归档 · 历史保留（取消后不可重选）',
        tone: 'secondary',
      });
    }
  }

  const summaryErrors: ErrorSummaryItem[] = Object.entries(form.formState.errors).flatMap(
    ([key, err]) => (err?.message ? [{ id: key, message: String(err.message) }] : []),
  );
  if (serverError) summaryErrors.push({ id: 'server', message: serverError });

  return (
    <FormProvider {...form}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <ErrorSummary errors={summaryErrors} />

        <FormSection description="定义一轮纯 GEO 内容运营活动的目标定位、负责人与排期。" title="基础策划信息">
          <FormField<CampaignFormValues, 'name'>
            id="campaign-name"
            label="活动名称"
            name="name"
            required
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                {...aria}
                disabled={pending}
                id={inputId}
                maxLength={200}
                placeholder="例如：TPS5430 国产替代 GEO 覆盖提升 Q4"
              />
            )}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField<CampaignFormValues, 'owner_id'>
              id="campaign-owner"
              label="活动负责人"
              name="owner_id"
              required
              render={({ field, inputId, ...aria }) => (
                <Select
                  disabled={pending || ownerItems.length === 0}
                  items={ownerItems}
                  onValueChange={(next) => next && field.onChange(next)}
                  value={field.value || null}
                >
                  <SelectTrigger id={inputId} {...aria}>
                    <SelectValue placeholder="选择负责人" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {ownerItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormField<CampaignFormValues, 'priority'>
              id="campaign-priority"
              label="优先级"
              name="priority"
              required
              render={({ field, inputId, ...aria }) => (
                <Select
                  disabled={pending}
                  items={priorityItems}
                  onValueChange={(next) => next && field.onChange(next as WorkPriority)}
                  value={field.value}
                >
                  <SelectTrigger id={inputId} {...aria}>
                    <SelectValue placeholder="选择优先级" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {priorityItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <FormField<CampaignFormValues, 'target_audience'>
            description="新建该活动下的内容任务时会自动预填至 Brief 受众字段。"
            id="campaign-audience"
            label="目标受众"
            name="target_audience"
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                {...aria}
                disabled={pending}
                id={inputId}
                maxLength={500}
                placeholder="例如：工业电源硬件工程师、采购与方案选型工程师"
              />
            )}
          />
          <FormField<CampaignFormValues, 'description'>
            id="campaign-description"
            label="活动背景与运营策略"
            name="description"
            render={({ field, inputId, ...aria }) => (
              <Textarea
                {...field}
                {...aria}
                disabled={pending}
                id={inputId}
                maxLength={4000}
                placeholder="说明活动目标、核心内容差异化方向与配合节奏"
                rows={3}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField<CampaignFormValues, 'start_date'>
              id="campaign-start-date"
              label="开始日期"
              name="start_date"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} type="date" />
              )}
            />
            <FormField<CampaignFormValues, 'end_date'>
              id="campaign-end-date"
              label="结束日期"
              name="end_date"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} type="date" />
              )}
            />
            <FormField<CampaignFormValues, 'budget_amount'>
              id="campaign-budget-amount"
              label="预算金额"
              name="budget_amount"
              render={({ field, inputId, ...aria }) => (
                <Input
                  {...field}
                  {...aria}
                  disabled={pending}
                  id={inputId}
                  inputMode="decimal"
                  placeholder="例如：15000.00"
                />
              )}
            />
            <FormField<CampaignFormValues, 'budget_currency'>
              id="campaign-budget-currency"
              label="预算币种"
              name="budget_currency"
              render={({ field, inputId, ...aria }) => (
                <Input
                  {...field}
                  {...aria}
                  disabled={pending}
                  id={inputId}
                  maxLength={3}
                  placeholder="CNY / USD"
                />
              )}
            />
          </div>
        </FormSection>

        <FormSection description="设置可量化跟踪的内容产出与 GEO 目标阈值（均可选）。" title="目标指标">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FormField<CampaignFormValues, 'target_content_count'>
              id="campaign-target-content-count"
              label="目标篇数"
              name="target_content_count"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} inputMode="numeric" placeholder="例如：12" />
              )}
            />
            <FormField<CampaignFormValues, 'target_discovery_pct'>
              id="campaign-target-discovery"
              label="目标发现率（%）"
              name="target_discovery_pct"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} inputMode="decimal" placeholder="0-100" />
              )}
            />
            <FormField<CampaignFormValues, 'target_mention_pct'>
              id="campaign-target-mention"
              label="目标提及率（%）"
              name="target_mention_pct"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} inputMode="decimal" placeholder="0-100" />
              )}
            />
            <FormField<CampaignFormValues, 'target_recommendation_pct'>
              id="campaign-target-recommendation"
              label="目标推荐率（%）"
              name="target_recommendation_pct"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} inputMode="decimal" placeholder="0-100" />
              )}
            />
            <FormField<CampaignFormValues, 'target_citation_pct'>
              id="campaign-target-citation"
              label="目标引用率（%）"
              name="target_citation_pct"
              render={({ field, inputId, ...aria }) => (
                <Input {...field} {...aria} disabled={pending} id={inputId} inputMode="decimal" placeholder="0-100" />
              )}
            />
          </div>
        </FormSection>

        <FormSection
          description="激活活动前至少需关联 1 个产品、1 个问题主题和 1 个目标平台；新建关联任务时服务端会严格校验归属范围。"
          title="活动关联范围"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <ScopeCheckboxGroup
              disabled={pending}
              emptyText="暂无活跃产品"
              items={productCheckboxItems}
              onToggle={(id) => form.setValue('product_ids', toggleId(selectedProducts, id), { shouldDirty: true })}
              selected={selectedProducts}
              title={`目标产品（已选 ${selectedProducts.length}）`}
            />
            <ScopeCheckboxGroup
              disabled={pending}
              emptyText="暂无活跃问题主题"
              items={topicCheckboxItems}
              onToggle={(id) => form.setValue('query_topic_ids', toggleId(selectedTopics, id), { shouldDirty: true })}
              selected={selectedTopics}
              title={`目标问题主题（已选 ${selectedTopics.length}）`}
            />
            <ScopeCheckboxGroup
              disabled={pending}
              emptyText="暂无活跃目标平台"
              items={platformCheckboxItems}
              onToggle={(id) => form.setValue('platform_profile_ids', toggleId(selectedPlatforms, id), { shouldDirty: true })}
              selected={selectedPlatforms}
              title={`目标平台（已选 ${selectedPlatforms.length}）`}
            />
            <ScopeCheckboxGroup
              disabled={pending}
              emptyText="暂无未归档 GEO 监测计划"
              items={planCheckboxItems}
              onToggle={(id) => form.setValue('monitoring_plan_ids', toggleId(selectedPlans, id), { shouldDirty: true })}
              selected={selectedPlans}
              title={`关联 GEO 监测计划（已选 ${selectedPlans.length}）`}
            />
          </div>
        </FormSection>

        <FormActions>
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">取消</Button>
          <Button disabled={pending} type="submit">{pending ? '保存中…' : submitLabel}</Button>
        </FormActions>
      </form>
    </FormProvider>
  );
}

function ScopeCheckboxGroup({
  disabled,
  emptyText,
  items,
  onToggle,
  selected,
  title,
}: {
  disabled: boolean;
  emptyText: string;
  items: { id: string; label: string; badge: string; tone: 'outline' | 'secondary' | 'success' | 'warning' | 'info' }[];
  onToggle: (id: string) => void;
  selected: string[];
  title: string;
}) {
  return (
    <fieldset className="space-y-2 rounded-xl border border-border-subtle p-3">
      <legend className="px-1 text-sm font-medium text-text-primary">{title}</legend>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyText}</p>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted">
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(item.id)}
                      type="checkbox"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <Badge variant={item.tone}>{item.badge}</Badge>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export { CampaignForm };
export type { CampaignFormProps };
