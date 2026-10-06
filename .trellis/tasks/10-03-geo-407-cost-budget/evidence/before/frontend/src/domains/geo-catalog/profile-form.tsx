import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { FormSection } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { CatalogNotice, CatalogSelect } from './catalog-controls';
import { createProfile, surfacesKeys, updateProfile } from './surfaces.api';
import { loginLabels, modeLabels, webPolicyLabels, type Profile } from './surfaces.model';
import { shouldBlockSurfacesNavigation } from './surfaces-search.model';
import { SurfaceBooleanField, SurfaceChoiceField, SurfaceTextField } from './surfaces-controls';
import { SurfacesFormFeedback, useSurfacesFormCommand } from './surfaces-form-command';
import { modes, profileCreate, profileFormSchema, profileUpdate, profileValues, type ProfileValues } from './surfaces-form.model';

function ProfileForm({ profile, surfaceId, token, onSaved, onReload, onCancel, unavailable = false }: {
  profile?: Profile; surfaceId?: string; token: string | null; onSaved: (profile: Profile) => void; onReload?: () => Promise<Profile>; onCancel: () => void; unavailable?: boolean;
}) {
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileFormSchema), defaultValues: profileValues(profile, surfaceId) });
  const command = useSurfacesFormCommand(form, profile, (resource) => surfacesKeys.profile(resource.summary.id), onSaved);
  const mode = useWatch({ control: form.control, name: 'collection_mode' });
  const dirty = form.formState.isDirty;
  const busy = command.pending || command.refreshing || form.formState.isSubmitting;
  const allowed = !unavailable && (!profile || profile.available_actions.includes('UPDATE'));
  return <FormProvider {...form}>
    <DirtyGuard shouldBlockNavigation={({ current, next }) => shouldBlockSurfacesNavigation(current, next)} when={dirty || busy} />
    <form aria-label={profile ? '编辑采集配置' : '新建采集配置'} className="min-w-0 space-y-4" onSubmit={form.handleSubmit(async (values) => {
      if (!allowed) return;
      await command.save(() => command.baseline ? updateProfile(command.baseline.summary.id, profileUpdate(values, command.baseline.summary.revision), token) : createProfile(profileCreate(values), token), (canonical) => form.reset(profileValues(canonical)));
    })}>
      <CatalogNotice>{profile ? '实际配置修改会清除测试事实并停用；请保存后核对服务端启用条件。' : '新配置默认停用且未测试（UNTESTED）。保存不执行采集或连接测试。'}</CatalogNotice>
      <fieldset className="min-w-0 space-y-4" disabled={busy || !allowed}>
        {profile ? <p className="break-words text-sm">所属观测面：{profile.summary.engine_surface.name}（{profile.summary.engine_surface_id}） · 采集模式：{modeLabels[profile.summary.collection_mode]}。所属与模式不可修改。</p> : <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceTextField description="从观测面详情进入可预填 ID；也可输入现有观测面的 UUID。" label="所属观测面 ID" maxLength={36} name="engine_surface_id" required /><FormField id="surfaces-collection_mode" label="采集模式" name="collection_mode" render={({ field, inputId, ...aria }) => <CatalogSelect choices={modes.map((value) => ({ value, label: modeLabels[value] }))} describedBy={aria['aria-describedby']} id={inputId} invalid={aria['aria-invalid']} label="采集模式" onChange={(value) => { field.onChange(value); form.setValue('adapter_key', value === 'MANUAL' ? 'manual' : '', { shouldDirty: true }); form.setValue('login_state', value === 'API' ? 'NOT_APPLICABLE' : 'ANONYMOUS', { shouldDirty: true }); form.setValue('ai_channel_id', '', { shouldDirty: true }); form.setValue('ai_model_id', '', { shouldDirty: true }); }} value={field.value} />} /></div>}
        <SurfaceTextField label="采集配置名称" name="name" required />
        {mode === 'MANUAL' ? <p className="text-sm">适配器：manual（固定）</p> : <SurfaceTextField description="填写服务端登记的适配器。API 可使用 openai-compatible-chat 进行连接诊断；采集资格待后续批准。未知适配器会被服务端明确拒绝。" label="适配器标识" maxLength={100} name="adapter_key" required />}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceTextField label="语言标签" maxLength={16} name="language_code" required /><SurfaceTextField label="地区代码" maxLength={2} name="region_code" required /></div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceChoiceField choices={Object.entries(webPolicyLabels).map(([value, label]) => ({ value, label }))} label="搜索策略" name="web_search_policy" />{mode === 'API' ? <p className="self-center text-sm">登录状态：不适用</p> : <SurfaceChoiceField choices={(['ANONYMOUS', 'AUTHENTICATED'] as const).map((value) => ({ value, label: loginLabels[value] }))} label="登录状态" name="login_state" />}</div>
        <FormSection title="模式设置">
          {mode === 'API' ? <>
            <p className="text-sm text-text-secondary">渠道和模型须同时填写现有 UUID，或同时留空；模型所属关系及资格由服务端校验。此处不接收凭据。</p>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceTextField label="AI 渠道 ID" maxLength={36} name="ai_channel_id" /><SurfaceTextField label="AI 模型 ID" maxLength={36} name="ai_model_id" /><SurfaceTextField description="0 到 2；留空使用配置默认值。" label="温度" name="temperature" type="number" /><SurfaceTextField description="1 到 65536 的整数；可留空。" label="输出 token 上限" name="max_output_tokens" type="number" /></div>
          </> : <div className="grid min-w-0 gap-4 sm:grid-cols-2"><SurfaceBooleanField label="要求截图" name="require_screenshot" />{mode === 'BROWSER' && <SurfaceTextField description="10 到 600 秒。" label="回答超时秒数" name="answer_timeout_seconds" type="number" />}</div>}
        </FormSection>
      </fieldset>
      <SurfacesFormFeedback conflict={command.conflict} error={command.error} fields={form.formState.errors} name={command.baseline?.summary.name} onReload={onReload ? () => void command.reload(onReload) : undefined} refreshing={command.refreshing} revision={command.baseline?.summary.revision} />
      {!allowed && <CatalogNotice error>服务端当前不允许编辑此采集配置。输入已保留，可以关闭编辑或重新读取。</CatalogNotice>}
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-text-muted" role="status">{busy ? '保存中…' : dirty ? '有未保存的修改' : '未修改或已保存'}</span><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={onCancel} type="button" variant="outline">关闭编辑</Button><Button disabled={!allowed || busy || command.conflict || !token} type="submit">{profile ? '保存采集配置' : '创建采集配置'}</Button></div></div>
    </form>
  </FormProvider>;
}
export { ProfileForm };
