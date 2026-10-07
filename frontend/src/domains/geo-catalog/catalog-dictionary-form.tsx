import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { Button } from '@/design-system/primitives/button';
import { createAlias, updateAlias, createDomain } from './catalog.api';
import { aliasKindLabels, domainRelationLabels, shouldBlockCatalogNavigation, type Subject } from './catalog.model';
import { CatalogChoiceField, CatalogTextField } from './catalog-controls';
import { CatalogFormFeedback, useCatalogFormCommand } from './catalog-form-command';
import { aliasFormSchema, domainFormSchema, type AliasValues, type DomainValues } from './catalog-form.model';

type DictionaryFormProps = {
  subject: Subject; csrfToken: string | null; onSaved: (subject: Subject) => void;
  onReload: () => Promise<Subject>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
};
function CatalogAliasForm({ subject, alias, csrfToken, onSaved, onReload, onCancel, onDirtyChange }: DictionaryFormProps & { alias?: Subject['aliases'][number] }) {
  const form = useForm<AliasValues>({
    resolver: zodResolver(aliasFormSchema),
    defaultValues: { alias: alias?.alias ?? '', alias_kind: alias?.alias_kind ?? 'NAME', language_code: alias?.language_code ?? '', is_active: alias?.is_active === false ? 'false' : 'true' },
  });
  const command = useCatalogFormCommand(form, subject, onSaved);
  const dirty = form.formState.isDirty;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const allowed = alias
    ? subject.aliases.some((item) => item.id === alias.id && item.available_actions.includes('UPDATE'))
    : subject.available_actions.includes('CREATE_ALIAS');
  const busy = command.pending || command.refreshing || form.formState.isSubmitting;
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockCatalogNavigation(current, next)} when={dirty || command.pending} />
    <form aria-label={alias ? '编辑别名' : '新增别名'} className="space-y-4" onSubmit={form.handleSubmit(async (values) => {
      if (!allowed || !command.baseline) return;
      const body = { ...values, language_code: values.language_code || null, is_active: values.is_active === 'true', expected_revision: command.baseline.revision };
      await command.save(() => alias ? updateAlias(subject.id, alias.id, body, csrfToken) : createAlias(subject.id, body, csrfToken), () => form.reset(values));
    })}>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" disabled={busy}>
        <CatalogTextField label="别名文本" maxLength={240} name="alias" required />
        <CatalogChoiceField choices={Object.entries(aliasKindLabels).map(([value, label]) => ({ value, label }))} label="别名类型" name="alias_kind" />
        <CatalogTextField description="可留空；例如 zh-CN、en。" label="语言标签" maxLength={16} name="language_code" />
        <CatalogChoiceField choices={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]} label="别名状态" name="is_active" />
      </fieldset>
      <CatalogFormFeedback conflict={command.conflict} error={command.error} fields={form.formState.errors} latest={command.baseline} onReload={() => void command.reload(onReload)} refreshing={command.refreshing} />
      {command.baseline && alias && <p className="break-words text-sm text-text-secondary">当前服务端别名：{command.baseline.aliases.find((item) => item.id === alias.id)?.alias ?? '该别名已删除，请关闭编辑'}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭编辑</Button>
        {allowed && <Button disabled={busy || command.conflict || !csrfToken} type="submit">{busy ? '保存中…' : '保存别名'}</Button>}
      </div>
    </form>
  </FormProvider>;
}
function CatalogDomainForm({ subject, csrfToken, onSaved, onReload, onCancel, onDirtyChange }: DictionaryFormProps) {
  const form = useForm<DomainValues>({ resolver: zodResolver(domainFormSchema), defaultValues: { hostname: '', relation_type: 'OWNED' } });
  const command = useCatalogFormCommand(form, subject, onSaved);
  const dirty = form.formState.isDirty;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const busy = command.pending || command.refreshing || form.formState.isSubmitting;
  const allowed = subject.available_actions.includes('CREATE_DOMAIN');
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockCatalogNavigation(current, next)} when={dirty || command.pending} />
    <form aria-label="新增域名" className="space-y-4" onSubmit={form.handleSubmit(async (values) => {
      if (!allowed || !command.baseline) return;
      await command.save(() => createDomain(subject.id, { ...values, expected_revision: command.baseline!.revision }, csrfToken), () => form.reset({ hostname: '', relation_type: values.relation_type }));
    })}>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" disabled={busy}>
        <CatalogTextField description="仅精确主机名，如 example.com；支持 Unicode 输入，不验证网络所有权。" label="域名" maxLength={253} name="hostname" required />
        <CatalogChoiceField choices={Object.entries(domainRelationLabels).map(([value, label]) => ({ value, label }))} label="域名关系" name="relation_type" />
      </fieldset>
      <CatalogFormFeedback conflict={command.conflict} error={command.error} fields={form.formState.errors} latest={command.baseline} onReload={() => void command.reload(onReload)} refreshing={command.refreshing} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭编辑</Button>
        {allowed && <Button disabled={busy || command.conflict || !csrfToken} type="submit">{busy ? '保存中…' : '保存域名'}</Button>}
      </div>
    </form>
  </FormProvider>;
}
export { CatalogAliasForm, CatalogDomainForm };
