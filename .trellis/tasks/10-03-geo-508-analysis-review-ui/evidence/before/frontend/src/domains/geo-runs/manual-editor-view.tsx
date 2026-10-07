import { useFieldArray, useFormContext, useWatch, type FieldErrors } from 'react-hook-form';
import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { FormField } from '@/design-system/forms/form-field';
import { FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/primitives/select';
import { Textarea } from '@/design-system/primitives/textarea';
import type { ManualContext, ManualDraft, ManualValues } from './manual.model';
import { RunRequestError } from './runs.api';

// 表单控件、只读上下文和错误呈现归此模块；修订号与异步命令由编辑器拥有。
function ManualReadState({
  error,
  pending,
  fetching,
  onRetry,
  onClose,
}: {
  error: unknown;
  pending: boolean;
  fetching: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const inaccessible = error instanceof RunRequestError && [401, 403, 404].includes(error.status ?? 0);
  return (
    <section aria-label="人工录入" className="space-y-3">
      <h2 className="type-section-title">人工录入</h2>
      {pending ? (
        <p role="status">正在读取人工采集上下文…</p>
      ) : (
        <>
          <Notice error>{errorMessage(error)}</Notice>
          {inaccessible ? (
            <p className="text-sm">当前资源不可访问，请返回运行列表。</p>
          ) : (
            <Button disabled={fetching} onClick={onRetry} type="button" variant="outline">
              重新读取人工录入
            </Button>
          )}
        </>
      )}
      <Button onClick={onClose} type="button" variant="outline">
        返回运行详情
      </Button>
    </section>
  );
}
function ManualFields({ disabled }: { disabled: boolean }) {
  const { control } = useFormContext<ManualValues>();
  const format = useWatch({ control, name: 'answer_format' });
  const answer = useWatch({ control, name: 'answer_text' });
  return (
    <FormSection title="实际采集内容">
      <FormField<ManualValues, 'answer_text'>
        id="manual-answer_text"
        label="回答原文"
        name="answer_text"
        render={({ field, inputId, ...aria }) => (
          <Textarea
            {...field}
            aria-describedby={aria['aria-describedby']}
            aria-invalid={aria['aria-invalid']}
            id={inputId}
            rows={12}
          />
        )}
      />
      <ManualSelect
        choices={[
          ['TEXT', '纯文本'],
          ['MARKDOWN', 'Markdown'],
          ['HTML_TEXT', 'HTML 原始文本（不执行）'],
        ]}
        disabled={disabled}
        label="答案格式"
        name="answer_format"
      />
      {format === 'MARKDOWN' && <MarkdownPreview ariaLabel="回答 Markdown 安全预览" value={answer} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <ManualText label="来源产品" name="source_product" />
        <ManualText label="来源模型" name="source_model" />
        <ManualText label="来源版本" name="source_version" />
      </div>
      <ManualSelect
        choices={[
          ['UNKNOWN', '未知'],
          ['YES', '是'],
          ['NO', '否'],
        ]}
        disabled={disabled}
        label="实际观察到联网搜索"
        name="web_search_observed"
      />
      <ManualText
        description="请填写实际采集时间，必须显式包含时区。未知时保持空白；正式提交前需人工确认。"
        label="实际采集时间"
        name="collected_at"
        placeholder="2026-10-02T10:30:00+08:00"
      />
    </FormSection>
  );
}
function ManualText({
  name,
  label,
  description,
  placeholder,
}: {
  name: 'source_product' | 'source_model' | 'source_version' | 'collected_at';
  label: string;
  description?: string;
  placeholder?: string;
}) {
  return (
    <FormField<ManualValues, typeof name>
      description={description}
      id={`manual-${name}`}
      label={label}
      name={name}
      render={({ field, inputId, ...aria }) => (
        <Input
          {...field}
          aria-describedby={aria['aria-describedby']}
          aria-invalid={aria['aria-invalid']}
          id={inputId}
          placeholder={placeholder}
        />
      )}
    />
  );
}
function ManualSelect({
  name,
  label,
  choices,
  disabled,
}: {
  name: 'answer_format' | 'web_search_observed';
  label: string;
  choices: [string, string][];
  disabled: boolean;
}) {
  return (
    <FormField<ManualValues, typeof name>
      id={`manual-${name}`}
      label={label}
      name={name}
      render={({ field, inputId, ...aria }) => (
        <Select
          disabled={disabled}
          items={choices.map(([value, text]) => ({ value, label: text }))}
          onValueChange={(value) => {
            if (value !== null) field.onChange(value);
          }}
          value={field.value}
        >
          <SelectTrigger
            aria-describedby={aria['aria-describedby']}
            aria-invalid={aria['aria-invalid']}
            className="min-h-11 w-full sm:min-h-8"
            id={inputId}
            onBlur={field.onBlur}
            ref={field.ref}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}
function ScreenshotValue({ disabled }: { disabled: boolean }) {
  const { control, setValue, formState } = useFormContext<ManualValues>();
  const id = useWatch({ control, name: 'screenshot_file_id' });
  return (
    <div className="space-y-2">
      <p className="break-all text-sm">{id ? `已校验截图：${id}` : '尚未关联截图'}</p>
      {id && (
        <Button
          disabled={disabled}
          onClick={() => setValue('screenshot_file_id', null, { shouldDirty: true, shouldValidate: true })}
          type="button"
          variant="outline"
        >
          移除当前截图关联
        </Button>
      )}
      {formState.errors.screenshot_file_id && (
        <p className="text-sm text-danger" id="manual-screenshot_file_id-error" role="alert">
          {formState.errors.screenshot_file_id.message}
        </p>
      )}
    </div>
  );
}
function CitationFields() {
  const { control, getValues } = useFormContext<ManualValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'citations' });
  return (
    <FormSection description="填写原始引用与其实际位置。URL 规范化和重复引用合并由服务端完成。" title="引用">
      {fields.length === 0 && <p className="text-sm text-text-secondary">没有引用；不会根据回答猜测来源。</p>}
      {fields.map((citation, index) => (
        <div
          className="grid min-w-0 gap-3 border-b border-border-subtle pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_auto]"
          key={citation.id}
        >
          <FormField<ManualValues, `citations.${number}.original_url`>
            id={`manual-citations.${index}.original_url`}
            label={`引用 ${index + 1} URL`}
            name={`citations.${index}.original_url`}
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                aria-describedby={aria['aria-describedby']}
                aria-invalid={aria['aria-invalid']}
                id={inputId}
                type="url"
              />
            )}
          />
          <FormField<ManualValues, `citations.${number}.title`>
            id={`manual-citations.${index}.title`}
            label={`引用 ${index + 1} 标题`}
            name={`citations.${index}.title`}
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                aria-describedby={aria['aria-describedby']}
                aria-invalid={aria['aria-invalid']}
                id={inputId}
              />
            )}
          />
          <FormField<ManualValues, `citations.${number}.position`>
            id={`manual-citations.${index}.position`}
            label={`引用 ${index + 1} 位置`}
            name={`citations.${index}.position`}
            render={({ field, inputId, ...aria }) => (
              <Input
                {...field}
                aria-describedby={aria['aria-describedby']}
                aria-invalid={aria['aria-invalid']}
                id={inputId}
                max={1000}
                min={1}
                onChange={(event) =>
                  field.onChange(event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value))
                }
                type="number"
                value={Number.isNaN(field.value) ? '' : field.value}
              />
            )}
          />
          <Button
            aria-label={`删除引用 ${index + 1}`}
            className="sm:self-end"
            onClick={() => remove(index)}
            type="button"
            variant="outline"
          >
            删除引用
          </Button>
        </div>
      ))}
      <Button
        disabled={fields.length >= 1000}
        onClick={() => {
          const used = new Set(getValues('citations').map((citation) => citation.position));
          let position = 1;
          while (used.has(position) && position < 1000) position += 1;
          append({ original_url: '', title: '', position });
        }}
        type="button"
        variant="outline"
      >
        添加引用
      </Button>
    </FormSection>
  );
}
function FrozenInput({ context }: { context: ManualContext }) {
  const { prompt, profile } = context.input_snapshot;
  return (
    <section aria-label="冻结采集输入，只读" className="min-w-0 space-y-3 border-b border-border-subtle pb-4">
      <h3 className="font-medium">冻结问题与环境 · 只读</h3>
      <p className="whitespace-pre-wrap break-words text-sm">{prompt.canonical_question}</p>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{prompt.prompt_text}</pre>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt>采集配置</dt>
        <dd className="break-words">
          {profile.name} · {profile.surface.name}
        </dd>
        <dt>语言 / 地区</dt>
        <dd>
          {profile.language_code} / {profile.region_code}
        </dd>
        <dt>登录状态 / 搜索策略</dt>
        <dd>
          {profile.login_state} / {profile.web_search_policy}
        </dd>
      </dl>
    </section>
  );
}
function DraftComparison({ draft }: { draft?: ManualDraft | null }) {
  if (!draft) return <p className="text-sm">服务端尚无草稿。</p>;
  return (
    <div className="min-w-0 space-y-2 text-sm">
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans">{draft.answer_text}</pre>
      <dl>
        <dt>格式 / 采集时间</dt>
        <dd>
          {draft.answer_format} / {draft.collected_at ?? '未填写'}
        </dd>
        <dt>来源产品 / 模型 / 版本</dt>
        <dd>
          {draft.source_product ?? '未知'} / {draft.source_model ?? '未知'} / {draft.source_version ?? '未知'}
        </dd>
        <dt>联网搜索</dt>
        <dd>{draft.web_search_observed == null ? '未知' : draft.web_search_observed ? '是' : '否'}</dd>
        <dt>截图 / 原始证据</dt>
        <dd className="break-all">
          {draft.screenshot_file_id ?? '无'} / {draft.raw_payload_file_id ?? '无'}
        </dd>
      </dl>
      <ol className="space-y-1">
        {draft.citations?.map((citation) => (
          <li className="break-all" key={citation.position}>
            {citation.position}. {citation.title} · {citation.original_url}
          </li>
        ))}
      </ol>
    </div>
  );
}
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      className={`space-y-2 rounded-lg border p-3 text-sm ${error ? 'border-danger/30 text-danger' : 'border-border-default text-text-secondary'}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '无法读取或提交人工采集，请重新核对';
  return error instanceof RunRequestError && error.detail
    ? `${message} · 请求 ID：${error.detail.request_id}`
    : message;
}
function formIssues(errors: FieldErrors<ManualValues>) {
  const issues: { id: string; message: string; fieldId: string }[] = [];
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== 'object') return;
    if ('message' in value && typeof value.message === 'string')
      issues.push({ id: path, message: value.message, fieldId: `manual-${path}` });
    for (const [key, child] of Object.entries(value))
      if (!['ref', 'message', 'type', 'types'].includes(key)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(errors, '');
  return issues;
}
export {
  ManualFields,
  ManualReadState,
  ScreenshotValue,
  CitationFields,
  FrozenInput,
  DraftComparison,
  Notice,
  errorMessage,
  formIssues,
};
