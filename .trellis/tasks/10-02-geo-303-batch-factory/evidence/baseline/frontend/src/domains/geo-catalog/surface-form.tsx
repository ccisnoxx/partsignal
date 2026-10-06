import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { CatalogNotice } from './catalog-controls';
import { createSurface, surfacesKeys, updateSurface } from './surfaces.api';
import { complianceLabels, kindLabels, type Surface } from './surfaces.model';
import { shouldBlockSurfacesNavigation } from './surfaces-search.model';
import { SurfaceBooleanField, SurfaceChoiceField, SurfaceTextField } from './surfaces-controls';
import { SurfacesFormFeedback, useSurfacesFormCommand } from './surfaces-form-command';
import { providerBrands, surfaceCreate, surfaceFormSchema, surfaceUpdate, surfaceValues, type SurfaceValues } from './surfaces-form.model';

function SurfaceForm({ surface, token, onSaved, onReload, onCancel, unavailable = false }: {
  surface?: Surface; token: string | null; onSaved: (surface: Surface) => void; onReload?: () => Promise<Surface>; onCancel: () => void; unavailable?: boolean;
}) {
  const form = useForm<SurfaceValues>({ resolver: zodResolver(surfaceFormSchema), defaultValues: surfaceValues(surface) });
  const command = useSurfacesFormCommand(form, surface, (resource) => surfacesKeys.surface(resource.summary.id), onSaved);
  const dirty = form.formState.isDirty;
  const busy = command.pending || command.refreshing || form.formState.isSubmitting;
  const allowed = !unavailable && (!surface || surface.available_actions.includes('UPDATE'));
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockSurfacesNavigation(current, next)} when={dirty || busy} />
    <form aria-label={surface ? '编辑观测面' : '新建观测面'} className="min-w-0 space-y-4" onSubmit={form.handleSubmit(async (values) => {
      if (!allowed) return;
      await command.save(() => command.baseline ? updateSurface(command.baseline.summary.id, surfaceUpdate(values, command.baseline.summary.revision), token) : createSurface(surfaceCreate(values), token), (canonical) => form.reset(surfaceValues(canonical)));
    })}>
      {!surface && <CatalogNotice>新观测面默认停用；启用只改变配置状态，不执行采集。</CatalogNotice>}
      <fieldset className="min-w-0 space-y-4" disabled={busy || !allowed}>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceTextField label="观测面名称" name="name" required /><SurfaceTextField label="观测面标识" maxLength={100} name="slug" required /></div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <SurfaceChoiceField choices={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))} label="观测面类型" name="surface_kind" />
          <SurfaceChoiceField choices={providerBrands.map((value) => ({ value, label: value }))} label="提供商" name="provider_brand" />
          <SurfaceChoiceField choices={Object.entries(complianceLabels).map(([value, label]) => ({ value, label }))} label="合规状态" name="compliance_status" />
        </div>
        <SurfaceTextField description="只填写公开网址，不包含凭据、查询参数或片段。" label="公开网站" maxLength={2083} name="website_url" />
        <FormSection description="这些能力只描述配置；回答正文始终支持，不代表实际运行结果。" title="观测能力">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"><SurfaceBooleanField label="引用" name="citations" /><SurfaceBooleanField label="搜索信号" name="web_search_signal" /><SurfaceBooleanField label="模型版本" name="model_version" /><SurfaceBooleanField label="使用量" name="usage" /><SurfaceBooleanField label="费用" name="cost" /></div>
        </FormSection>
      </fieldset>
      <SurfacesFormFeedback conflict={command.conflict} error={command.error} fields={form.formState.errors} name={command.baseline?.summary.name} onReload={onReload ? () => void command.reload(onReload) : undefined} refreshing={command.refreshing} revision={command.baseline?.summary.revision} />
      {!allowed && <CatalogNotice error>服务端当前不允许编辑此观测面。输入已保留，可以关闭编辑或重新读取。</CatalogNotice>}
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-text-muted" role="status">{busy ? '保存中…' : dirty ? '有未保存的修改' : '未修改或已保存'}</span><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭编辑</Button><Button disabled={!allowed || busy || command.conflict || !token} type="submit">{surface ? '保存观测面' : '创建观测面'}</Button></div></div>
    </form>
  </FormProvider>;
}
export { SurfaceForm };
