import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { Button } from '@/design-system/primitives/button';
import { createSubject, updateSubject } from './catalog.api';
import { subjectTypeLabels, shouldBlockCatalogNavigation, type Subject } from './catalog.model';
import { CatalogSelect, CatalogTextField } from './catalog-controls';
import { CatalogFormFeedback, useCatalogFormCommand } from './catalog-form-command';
import { CatalogIdentityPicker } from './catalog-options';
import { subjectCreate, subjectFormSchema, subjectUpdate, subjectValues, type SubjectValues } from './catalog-form.model';

function CatalogSubjectForm({ subject, csrfToken, onSaved, onReload, onCancel, onDirtyChange }: {
  subject?: Subject; csrfToken: string | null; onSaved: (subject: Subject) => void;
  onReload?: () => Promise<Subject>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const form = useForm<SubjectValues>({ defaultValues: subjectValues(subject), resolver: zodResolver(subjectFormSchema) });
  const command = useCatalogFormCommand(form, subject, onSaved);
  const type = useWatch({ control: form.control, name: 'subject_type' });
  const parentKind = type === 'OWN_PRODUCT' ? 'OWN_BRAND' : type === 'COMPETITOR_PRODUCT' ? 'COMPETITOR_BRAND' : undefined;
  const dirty = form.formState.isDirty;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const allowed = !subject || subject.available_actions.includes('UPDATE');
  const busy = command.pending || command.refreshing || form.formState.isSubmitting;
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockCatalogNavigation(current, next)} when={dirty || command.pending} />
    <form aria-label={subject ? '编辑监测对象' : '新建监测对象'} className="space-y-4" onSubmit={form.handleSubmit(async (values) => {
      if (!allowed) return;
      await command.save(() => command.baseline
        ? updateSubject(command.baseline.id, subjectUpdate(values, command.baseline.revision), csrfToken)
        : createSubject(subjectCreate(values), csrfToken), (canonical) => form.reset(subjectValues(canonical)));
    })}>
      <fieldset className="min-w-0 space-y-4" disabled={busy}>
        {subject ? <p>类型：{subjectTypeLabels[type]}{subject.product && <span> · {subject.product.brand} {subject.product.part_number}（只读产品身份）</span>}</p> :
          <FormField id="catalog-subject_type" label="对象类型" name="subject_type" render={({ field, inputId, ...aria }) => (
            <CatalogSelect choices={Object.entries(subjectTypeLabels).map(([value, label]) => ({ value, label }))} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label="对象类型" onChange={(value) => { field.onChange(value); form.setValue('parent_subject_id', '', { shouldDirty: true }); }} value={field.value} />
          )} />}
        {type === 'OWN_PRODUCT' ? !subject && <FormField id="catalog-product_id" label="现有产品" name="product_id" required render={({ field, ...aria }) => (
          <CatalogIdentityPicker describedBy={aria['aria-describedby']} disabled={busy} invalid={aria['aria-invalid']} kind="product" label="现有产品" onChange={field.onChange} required value={field.value} />
        )} /> : <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <CatalogTextField label="规范名称" maxLength={240} name="canonical_name" required />
          <CatalogTextField label="显示名称" maxLength={240} name="display_name" required />
        </div>}
        {parentKind && <FormField id="catalog-parent_subject_id" label="父级品牌" name="parent_subject_id" render={({ field, ...aria }) => (
          <CatalogIdentityPicker currentLabel={subject?.parent?.display_name} describedBy={aria['aria-describedby']} disabled={busy} invalid={aria['aria-invalid']} key={parentKind} kind={parentKind} label="父级品牌" onChange={field.onChange} value={field.value} />
        )} />}
        <CatalogTextField description="仅描述监测用途；产品事实请在产品工作区维护。" label="监测说明" maxLength={4000} multiline name="description" />
      </fieldset>
      <CatalogFormFeedback conflict={command.conflict} error={command.error} fields={form.formState.errors} latest={command.baseline} onReload={onReload ? () => void command.reload(onReload) : undefined} refreshing={command.refreshing} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-text-muted" role="status">{busy ? '保存中…' : dirty ? '有未保存的修改' : '未修改或已保存'}</span>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭编辑</Button>
          {allowed && <Button disabled={busy || command.conflict || !csrfToken} type="submit">{subject ? '保存监测对象' : '创建监测对象'}</Button>}
        </div>
      </div>
    </form>
  </FormProvider>;
}
export { CatalogSubjectForm };
