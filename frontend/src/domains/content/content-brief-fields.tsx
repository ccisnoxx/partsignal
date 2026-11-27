import { useFormContext } from 'react-hook-form';

import { FormField } from '@/design-system/forms/form-field';
import { FormSection } from '@/design-system/forms/form-layout';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import { intentLabels, intentValues, type IntentType } from '@/domains/geo/query-topic-list.model';
import type { NewContentTaskFormValues } from './new-content-task.model';

type ContentBriefFieldsProps = {
  disabled: boolean;
  approvedClaimsSummary?: string | null;
  onForbiddenEdited: () => void;
};

const intentItems = intentValues.map((value) => ({ value, label: intentLabels[value] }));

function ContentBriefFields({
  disabled,
  approvedClaimsSummary,
  onForbiddenEdited,
}: ContentBriefFieldsProps) {
  useFormContext<NewContentTaskFormValues>();
  return (
    <FormSection
      description="创建任务时一次性冻结为不可变 ContentBriefSnapshot，不因后续活动或事实变更而改写历史。"
      title="内容 Brief（创建即冻结）"
    >
      {approvedClaimsSummary && (
        <div className="rounded-lg border border-border-subtle bg-surface-muted/40 p-3 text-xs text-text-secondary">
          <p className="font-medium text-text-primary">所选事实版本可公开核心结论参考</p>
          <p className="mt-1 whitespace-pre-wrap">{approvedClaimsSummary}</p>
        </div>
      )}

      <FormField<NewContentTaskFormValues, 'target_question'>
        description="默认带出所选问题主题的标准问题，可按当前任务细化。"
        id="new-content-task-target-question"
        label="目标问题"
        name="target_question"
        required
        render={({ field, inputId, ...aria }) => (
          <Input
            {...field}
            {...aria}
            disabled={disabled}
            id={inputId}
            maxLength={500}
            placeholder="例如：TPS5430 有哪些国产替代型号与选型注意事项？"
          />
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <FormField<NewContentTaskFormValues, 'search_intent'>
          id="new-content-task-search-intent"
          label="搜索意图"
          name="search_intent"
          required
          render={({ field, inputId, ...aria }) => (
            <Select
              disabled={disabled}
              items={intentItems}
              onValueChange={(next) => next && field.onChange(next as IntentType)}
              value={field.value}
            >
              <SelectTrigger id={inputId} {...aria}>
                <SelectValue placeholder="选择搜索意图" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {intentItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormField<NewContentTaskFormValues, 'content_angle'>
          description="同一产品与问题在不同内容角度下可并存，避免内容同质化。"
          id="new-content-task-content-angle"
          label="内容角度"
          name="content_angle"
          required
          render={({ field, inputId, ...aria }) => (
            <Input
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              maxLength={160}
              placeholder="例如：国产替代选型指南 / 关键参数对比 / 应用排障"
            />
          )}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField<NewContentTaskFormValues, 'target_audience'>
          id="new-content-task-audience"
          label="目标受众"
          name="target_audience"
          render={({ field, inputId, ...aria }) => (
            <Input
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              maxLength={500}
              placeholder="例如：电源硬件工程师"
            />
          )}
        />
        <FormField<NewContentTaskFormValues, 'content_format'>
          id="new-content-task-format"
          label="内容形式"
          name="content_format"
          render={({ field, inputId, ...aria }) => (
            <Input
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              maxLength={80}
              placeholder="例如：技术选型问答 / 实操对比文章"
            />
          )}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField<NewContentTaskFormValues, 'must_answer_questions_text'>
          description="每行一条，最多 20 条。"
          id="new-content-task-must-answer"
          label="必须回答的问题"
          name="must_answer_questions_text"
          render={({ field, inputId, ...aria }) => (
            <Textarea
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              placeholder="每行输入一个核心子问题"
              rows={3}
            />
          )}
        />
        <FormField<NewContentTaskFormValues, 'required_fact_points_text'>
          description="每行一条，最多 20 条。"
          id="new-content-task-required-facts"
          label="必须覆盖的产品事实"
          name="required_fact_points_text"
          render={({ field, inputId, ...aria }) => (
            <Textarea
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              placeholder="每行输入一条来自已批准事实的关键要点"
              rows={3}
            />
          )}
        />
      </div>

      <FormField<NewContentTaskFormValues, 'forbidden_expressions_text'>
        description="选择已批准事实版本时自动按行预填其禁止表达规则；每行一条，最多 50 条。"
        id="new-content-task-forbidden"
        label="禁止表达"
        name="forbidden_expressions_text"
        render={({ field, inputId, ...aria }) => (
          <Textarea
            {...field}
            {...aria}
            disabled={disabled}
            id={inputId}
            onChange={(event) => {
              onForbiddenEdited();
              field.onChange(event);
            }}
            placeholder="每行输入一条禁止在公开内容中出现的表达"
            rows={3}
          />
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <FormField<NewContentTaskFormValues, 'target_keywords_text'>
          description="可用换行或逗号分隔，最多 30 个。"
          id="new-content-task-keywords"
          label="目标关键词"
          name="target_keywords_text"
          render={({ field, inputId, ...aria }) => (
            <Input
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              placeholder="例如：TPS5430, 国产替代, 降压芯片"
            />
          )}
        />
        <FormField<NewContentTaskFormValues, 'cta'>
          id="new-content-task-cta"
          label="行动号召（CTA）"
          name="cta"
          render={({ field, inputId, ...aria }) => (
            <Input
              {...field}
              {...aria}
              disabled={disabled}
              id={inputId}
              maxLength={500}
              placeholder="例如：联系官网技术支持获取样品与评估板资料"
            />
          )}
        />
      </div>

      <FormField<NewContentTaskFormValues, 'success_metrics_notes'>
        id="new-content-task-metrics-notes"
        label="成功指标备注"
        name="success_metrics_notes"
        render={({ field, inputId, ...aria }) => (
          <Input
            {...field}
            {...aria}
            disabled={disabled}
            id={inputId}
            maxLength={500}
            placeholder="例如：目标在 DeepSeek / ChatGPT 替代问题中获得稳定引用"
          />
        )}
      />
    </FormSection>
  );
}

export { ContentBriefFields };
export type { ContentBriefFieldsProps };
