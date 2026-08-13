import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FormProvider, useForm, useWatch, type FieldPath } from 'react-hook-form';

import { RowActions } from '@/design-system/data-table/row-actions';
import { TableShell } from '@/design-system/data-table/table-shell';
import { DirtyGuard } from '@/design-system/forms/dirty-guard';
import { FormField } from '@/design-system/forms/form-field';
import { ErrorSummary, FormActions } from '@/design-system/forms/form-layout';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { Input } from '@/design-system/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs';
import { Textarea } from '@/design-system/primitives/textarea';
import { DetailSection } from '@/design-system/workspace/detail-section';
import type { components } from '@/shared/api/generated/schema';
import { sha256File, transferFile } from '@/shared/api/file-transfer';
import {
  abortPlatformLogoUpload,
  completePlatformLogoUpload,
  createPlatformAccount,
  createPlatformLogoCandidate,
  createPlatformLogoUploadIntent,
  deletePlatformAccount,
  platformAccountsQueryOptions,
  platformDetailQueryOptions,
  platformKeys,
  platformPromptOptionsQueryOptions,
  runPlatformCommand,
  setPlatformAccountEnabled,
  updatePlatformAccount,
  updatePlatformProfile,
} from './platform.api';
import {
  deletionBlockerLabel,
  platformStatusRegistry,
  readinessRegistry,
  resolvePlatformOverflowActions,
  resolvePlatformPrimaryAction,
  type PlatformCommand,
  type PlatformProfile,
} from './platform-list.model';
import {
  isPlatformRevisionConflict,
  mapPlatformAccountFormError,
  platformAccountFormSchema,
  platformAccountFormValues,
  platformDetailErrorKind,
  platformGenerationFormSchema,
  platformOverviewFormSchema,
  platformToGenerationValues,
  platformToOverviewValues,
  platformWorkspaceTabs,
  resolvePlatformAccountOverflowActions,
  resolvePlatformAccountPrimaryAction,
  toPlatformAccountCreate,
  toPlatformAccountUpdate,
  toPlatformGenerationUpdate,
  toPlatformOverviewUpdate,
  type PlatformAccountCommand,
  type PlatformAccountFormValues,
  type PlatformGenerationFormValues,
  type PlatformLogoChange,
  type PlatformOverviewFormValues,
  type PlatformProfileDetail,
  type PlatformWorkspaceTab,
} from './platform-workspace.model';

type PlatformAccount = components['schemas']['PlatformAccount'];
type PlatformLogoCandidate = components['schemas']['PlatformLogoCandidate'];
type PlatformMutationKind = 'identity' | 'status' | 'delete' | 'generation';
type PlatformAccountMutationKind = 'create' | 'update' | 'status' | 'delete';
const maximumPlatformLogoBytes = 2 * 1024 * 1024;

type PlatformWorkspacePageProps = {
  csrfToken: string | null;
  onConsumersChanged: (kind: PlatformMutationKind) => Promise<void>;
  onAccountConsumersChanged: (kind: PlatformAccountMutationKind) => Promise<void>;
  onDeleted: () => Promise<void> | void;
  onTabChange: (tab: PlatformWorkspaceTab) => Promise<void> | void;
  platformId: string;
  tab: PlatformWorkspaceTab;
};

function PlatformWorkspacePage({
  csrfToken,
  onAccountConsumersChanged,
  onConsumersChanged,
  onDeleted,
  onTabChange,
  platformId,
  tab,
}: PlatformWorkspacePageProps) {
  const queryClient = useQueryClient();
  const detail = useQuery(platformDetailQueryOptions(platformId));
  const [dirty, setDirty] = useState(false);
  const [blockerTarget, setBlockerTarget] = useState<HTMLElement | null>();
  const [enableTarget, setEnableTarget] = useState<HTMLElement | null>();

  async function invalidatePlatform(kind: PlatformMutationKind, profile?: PlatformProfile) {
    if (kind === 'delete') {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
        onConsumersChanged(kind),
      ]);
      queryClient.removeQueries({ queryKey: platformKeys.detail(platformId) });
      queryClient.removeQueries({ queryKey: platformKeys.accounts(platformId) });
      return;
    }
    if (profile) {
      queryClient.setQueryData<PlatformProfileDetail>(
        platformKeys.detail(platformId),
        (current) => current ? { ...current, profile } : current,
      );
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: platformKeys.detail(platformId) }),
      ...(kind === 'status'
        ? [queryClient.invalidateQueries({ queryKey: platformKeys.accounts(platformId) })]
        : []),
      ...(kind === 'generation'
        ? [queryClient.invalidateQueries({ queryKey: platformKeys.promptOptions() })]
        : []),
      onConsumersChanged(kind),
    ]);
  }

  const lifecycle = useMutation({
    mutationFn: ({ command, platform }: { command: PlatformCommand; platform: PlatformProfile }) => (
      runPlatformCommand(command, platform, csrfToken)
    ),
    onSuccess: async (profile, variables) => {
      if (variables.command === 'delete-platform') {
        await invalidatePlatform('delete');
        await onDeleted();
        return;
      }
      await invalidatePlatform('status', profile);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: platformKeys.detail(platformId) }),
      ]);
    },
  });

  if (detail.isPending) return <PlatformWorkspaceSkeleton platformId={platformId} />;
  if (!detail.data) {
    return <PlatformWorkspaceFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const profile = detail.data.profile;

  function handleCommand(command: string, focusReturn?: HTMLElement | null) {
    if (command === 'view-delete-conditions') {
      setBlockerTarget(focusReturn ?? document.activeElement as HTMLElement | null);
      return;
    }
    if (command === 'enable-platform') {
      setEnableTarget(focusReturn ?? document.activeElement as HTMLElement | null);
      return;
    }
    if (command === 'disable-platform' || command === 'delete-platform') {
      lifecycle.mutate({ command, platform: profile });
      return;
    }
    throw new Error(`Platform Workspace 收到未知页面命令：${command}`);
  }

  return (
    <article aria-labelledby="platform-workspace-title" className="min-w-0 space-y-4">
      <a
        className="inline-flex min-h-8 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="/settings/platforms?page=1&pageSize=20"
      >
        返回 Platform List
      </a>

      <PlatformWorkspaceHeader
        onCommand={handleCommand}
        pending={lifecycle.isPending}
        profile={profile}
      />

      {detail.error && (
        <Notice
          actionLabel="重试刷新"
          message={`刷新失败，已保留当前 Workspace：${errorMessage(detail.error)}`}
          onAction={() => void detail.refetch()}
        />
      )}
      {lifecycle.error && (
        <Notice
          actionLabel="关闭"
          message={errorMessage(lifecycle.error)}
          onAction={() => lifecycle.reset()}
        />
      )}

      <Tabs
        onValueChange={(value) => {
          if (!platformWorkspaceTabs.includes(value as PlatformWorkspaceTab)) {
            throw new Error(`Platform Workspace 收到未知 Tab：${value}`);
          }
          void onTabChange(value as PlatformWorkspaceTab);
        }}
        value={tab}
      >
        <TabsList aria-label="平台工作区区域" className="max-w-full overflow-x-auto" variant="line">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="accounts">发布账号</TabsTrigger>
          <TabsTrigger value="generation">生成配置</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-3" value="overview">
          <PlatformOverviewSection
            csrfToken={csrfToken}
            detail={detail.data}
            onDirtyChange={setDirty}
            onReload={async () => (await detail.refetch()).data}
            onUpdated={(canonical) => invalidatePlatform('identity', canonical)}
          />
        </TabsContent>
        <TabsContent className="pt-3" value="accounts">
          <PlatformAccountsSection
            active={tab === 'accounts'}
            csrfToken={csrfToken}
            onConsumersChanged={onAccountConsumersChanged}
            platformId={platformId}
          />
        </TabsContent>
        <TabsContent className="pt-3" value="generation">
          <PlatformGenerationSection
            active={tab === 'generation'}
            csrfToken={csrfToken}
            detail={detail.data}
            onDirtyChange={setDirty}
            onReload={async () => (await detail.refetch()).data}
            onUpdated={(canonical) => invalidatePlatform('generation', canonical)}
          />
        </TabsContent>
      </Tabs>

      <DirtyGuard when={dirty} />
      <DeletionBlockersDialog
        finalFocus={blockerTarget ?? null}
        onClose={() => setBlockerTarget(undefined)}
        open={blockerTarget !== undefined}
        profile={profile}
      />
      <EnablePlatformDialog
        finalFocus={enableTarget ?? null}
        onClose={() => setEnableTarget(undefined)}
        onConfirm={() => {
          lifecycle.mutate({ command: 'enable-platform', platform: profile });
          setEnableTarget(undefined);
        }}
        open={enableTarget !== undefined}
        profile={profile}
      />
    </article>
  );
}

function PlatformWorkspaceHeader({
  onCommand,
  pending,
  profile,
}: {
  onCommand: (command: string, focusReturn?: HTMLElement | null) => void;
  pending: boolean;
  profile: PlatformProfile;
}) {
  const status = platformStatusRegistry[profile.is_active ? 'ENABLED' : 'DISABLED'];
  const readiness = readinessRegistry[profile.readiness_status];
  return (
    <header className="grid min-w-0 gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
      <PlatformLogoImage logo={profile.logo} name={profile.name} />
      <div className="min-w-0 space-y-2">
        <p className="type-label text-text-muted">Platform Workspace</p>
        <h1 className="break-words type-page-title" id="platform-workspace-title">{profile.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.tone}>{status.label}</Badge>
          <Badge variant={readiness.tone}>{readiness.label}</Badge>
          <span className="text-sm text-text-secondary">{profile.platform_type?.name ?? '未归类'}</span>
          <span className="text-sm text-text-muted">
            {profile.enabled_platform_account_count}/{profile.platform_account_count} 个账号可用
          </span>
        </div>
      </div>
      <div className="min-w-0 md:min-w-56">
        {profile.primary_task === null
          && profile.available_actions.length === 0
          && profile.deletion === null ? (
            <p className="text-right text-sm text-text-muted">只读访问</p>
          ) : (
            <RowActions
              objectLabel={profile.name}
              onCommand={onCommand}
              overflow={resolvePlatformOverflowActions(profile, pending)}
              primary={resolvePlatformPrimaryAction(profile)}
            />
          )}
      </div>
    </header>
  );
}

function PlatformOverviewSection({
  csrfToken,
  detail,
  onDirtyChange,
  onReload,
  onUpdated,
}: {
  csrfToken: string | null;
  detail: PlatformProfileDetail;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => Promise<PlatformProfileDetail | undefined>;
  onUpdated: (profile: PlatformProfile) => Promise<void>;
}) {
  const canUpdate = detail.profile.available_actions.includes('UPDATE');
  const [logo, setLogo] = useState<PlatformLogoChange>();
  const [logoPreview, setLogoPreview] = useState<string>();
  const [candidate, setCandidate] = useState<PlatformLogoCandidate>();
  const form = useForm<PlatformOverviewFormValues>({
    defaultValues: platformToOverviewValues(detail.profile),
    resolver: zodResolver(platformOverviewFormSchema),
  });
  const update = useMutation({
    mutationFn: (values: PlatformOverviewFormValues) => updatePlatformProfile(
      detail.profile.id,
      toPlatformOverviewUpdate(values, detail.profile, logo),
      csrfToken,
    ),
  });
  const websiteUrl = useWatch({ control: form.control, name: 'websiteUrl' });
  const dirty = form.formState.isDirty || logo !== undefined;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) form.reset(platformToOverviewValues(detail.profile));
  }, [detail.profile, dirty, form]);
  useEffect(() => () => {
    if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  function reset(profile = detail.profile) {
    form.reset(platformToOverviewValues(profile));
    setLogo(undefined);
    setLogoPreview(undefined);
    setCandidate(undefined);
    update.reset();
  }

  async function submit(values: PlatformOverviewFormValues) {
    try {
      const canonical = await update.mutateAsync(values);
      reset(canonical);
      await onUpdated(canonical);
    } catch {
      // mutation.error 统一展示；revision 冲突必须保留当前表单和 Logo 选择。
    }
  }

  if (!canUpdate) {
    return <PlatformOverviewReadOnly detail={detail} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
      <FormProvider {...form}>
        <form className="space-y-0" noValidate onSubmit={form.handleSubmit(submit)}>
          <DetailSection title="平台身份" description="Slug 创建后保持只读；名称、类型和官网由服务端合同更新。">
            <ErrorSummary errors={update.error ? [{ id: 'server', message: errorMessage(update.error) }] : []} />
            {isPlatformRevisionConflict(update.error) && (
              <div className="mb-4">
                <Button
                  onClick={() => void onReload().then((fresh) => fresh && reset(fresh.profile))}
                  type="button"
                  variant="outline"
                >
                  重新加载服务端版本
                </Button>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField<PlatformOverviewFormValues, 'name'>
                id="platform-name"
                label="平台名称"
                name="name"
                required
                render={(context) => (
                  <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} maxLength={160} />
                )}
              />
              <div className="space-y-1.5">
                <label className="type-label block text-text-primary" htmlFor="platform-slug">Slug</label>
                <Input id="platform-slug" readOnly value={detail.profile.slug} />
                <p className="text-xs text-text-secondary">Slug 是稳定身份，当前合同不允许修改。</p>
              </div>
              <FormField<PlatformOverviewFormValues, 'platformTypeId'>
                id="platform-type"
                label="平台类型"
                name="platformTypeId"
                required
                render={(context) => (
                  <Select items={detail.platform_type_options.map((item) => ({ label: item.name, value: item.id }))} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                    <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue placeholder="请选择平台类型" /></SelectTrigger>
                    <SelectContent>{detail.platform_type_options.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              />
              <FormField<PlatformOverviewFormValues, 'websiteUrl'>
                id="platform-website-url"
                label="Website URL"
                name="websiteUrl"
                render={(context) => (
                  <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} inputMode="url" placeholder="https://example.com" />
                )}
              />
              <FormField<PlatformOverviewFormValues, 'allowedDomains'>
                className="sm:col-span-2"
                description="每行一个主机名，不包含协议、路径、端口或通配符；最终规范化由服务端负责。"
                id="platform-allowed-domains"
                label="Allowed Domains"
                name="allowedDomains"
                required
                render={(context) => (
                  <Textarea {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={update.isPending} id={context.inputId} rows={4} />
                )}
              />
            </div>
          </DetailSection>

          <DetailSection title="Logo" description="仅绑定已校验的 PLATFORM_LOGO 文件；替换和移除由服务端文件生命周期处理。">
            <PlatformLogoField
              candidate={candidate}
              csrfToken={csrfToken}
              disabled={update.isPending}
              logo={logo}
              onCandidate={setCandidate}
              onChange={(nextLogo, preview) => {
                setLogo(nextLogo);
                setLogoPreview(preview);
              }}
              preview={logoPreview ?? detail.profile.logo?.url}
              profile={detail.profile}
              websiteUrl={websiteUrl}
            />
          </DetailSection>

          <DetailSection title="业务摘要" description="摘要和 revision 来自同一次 Detail 快照。">
            <PlatformSummaryGrid detail={detail} />
          </DetailSection>

          <FormActions className="border-t border-border-subtle p-4">
            <Button disabled={update.isPending || !dirty} onClick={() => reset()} type="button" variant="outline">取消</Button>
            <Button disabled={update.isPending || !dirty} type="submit">{update.isPending ? '保存中…' : '保存概览'}</Button>
          </FormActions>
        </form>
      </FormProvider>
    </div>
  );
}

function PlatformOverviewReadOnly({ detail }: { detail: PlatformProfileDetail }) {
  const profile = detail.profile;
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-panel">
      <DetailSection title="平台身份" description="当前账号可读取平台事实，但没有管理动作。">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metadata label="名称" value={profile.name} />
          <Metadata label="Slug" mono value={profile.slug} />
          <Metadata label="类型" value={profile.platform_type?.name ?? '未归类'} />
          <Metadata label="Website URL" value={profile.website_url ? <a className="text-primary underline" href={profile.website_url}>{profile.website_url}</a> : '未配置'} />
          <Metadata label="Allowed Domains" value={profile.allowed_domains.join('、')} />
          <Metadata label="Logo" value={profile.logo ? profile.logo.source : '未配置'} />
        </dl>
      </DetailSection>
      <DetailSection title="业务摘要"><PlatformSummaryGrid detail={detail} /></DetailSection>
    </div>
  );
}

function PlatformLogoField({
  candidate,
  csrfToken,
  disabled,
  logo,
  onCandidate,
  onChange,
  preview,
  profile,
  websiteUrl,
}: {
  candidate?: PlatformLogoCandidate;
  csrfToken: string | null;
  disabled: boolean;
  logo: PlatformLogoChange;
  onCandidate: (candidate?: PlatformLogoCandidate) => void;
  onChange: (logo: PlatformLogoChange, preview?: string) => void;
  preview?: string;
  profile: PlatformProfile;
  websiteUrl: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'candidate'>('idle');
  const [error, setError] = useState<string>();

  async function upload(file: File) {
    if (file.type === 'image/svg+xml' || file.name.toLocaleLowerCase().endsWith('.svg')) {
      throw new Error('Logo 不接受 SVG，请使用 PNG、JPEG、WebP 或 ICO');
    }
    if (file.size > maximumPlatformLogoBytes) {
      throw new Error('Logo 不能超过 2 MiB');
    }
    setPhase('uploading');
    setError(undefined);
    const intent = await createPlatformLogoUploadIntent({
      access_level: 'PUBLIC',
      category: 'PLATFORM_LOGO',
      content_type: file.type || 'application/octet-stream',
      original_filename: file.name,
      sha256: await sha256File(file),
      size: file.size,
    }, csrfToken);
    try {
      await transferFile(file, intent);
      await completePlatformLogoUpload(intent.file.id, csrfToken);
    } catch (reason) {
      try {
        await abortPlatformLogoUpload(intent.file.id, csrfToken);
      } catch {
        // 原始上传错误更有诊断价值；未绑定文件由现有过期清理回收。
      }
      throw reason;
    }
    onCandidate(undefined);
    onChange({ source: 'UPLOAD', file_id: intent.file.id }, URL.createObjectURL(file));
    setPhase('idle');
  }

  async function importCandidate() {
    if (!websiteUrl.trim()) {
      setError('请先填写有效的 Website URL');
      return;
    }
    setPhase('candidate');
    setError(undefined);
    try {
      onCandidate(await createPlatformLogoCandidate(websiteUrl.trim(), csrfToken));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPhase('idle');
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
      {preview && logo !== null ? (
        <img alt={`${profile.name} Logo`} className="h-24 w-24 rounded-xl border border-border-subtle object-contain p-2" src={preview} />
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-border-default text-xs text-text-muted">无 Logo</div>
      )}
      <div className="min-w-0 space-y-3">
        <Input
          accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
          aria-label="上传平台 Logo"
          disabled={disabled || phase !== 'idle'}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            void upload(file).catch((reason: unknown) => {
              setPhase('idle');
              setError(errorMessage(reason));
            });
          }}
          type="file"
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled || phase !== 'idle'} onClick={() => void importCandidate()} size="sm" type="button" variant="outline">
            {phase === 'candidate' ? '正在导入…' : '从官网导入候选'}
          </Button>
          {(profile.logo || logo !== undefined) && logo !== null && (
            <Button disabled={disabled} onClick={() => { onCandidate(undefined); onChange(null); }} size="sm" type="button" variant="outline">移除 Logo</Button>
          )}
        </div>
        {phase === 'uploading' && <p aria-live="polite" className="text-sm text-text-secondary">正在上传并校验 Logo…</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {candidate && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle p-3">
            <img alt="官网 Logo 候选" className="h-16 w-16 rounded-lg object-contain" src={candidate.preview.url} />
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">候选已存入自有存储，确认后才会写入平台。</p>
              <div className="flex gap-2">
                <Button onClick={() => { onChange({ source: 'UPLOAD', file_id: candidate.file_id }, candidate.preview.url); onCandidate(undefined); }} size="sm" type="button">使用此候选</Button>
                <Button onClick={() => onCandidate(undefined)} size="sm" type="button" variant="outline">放弃候选</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type AccountEditorTarget = {
  account?: PlatformAccount;
  focusReturn: HTMLElement | null;
};

type AccountCommandTarget = {
  account: PlatformAccount;
  command: Exclude<PlatformAccountCommand, 'edit-account' | 'view-account-delete-conditions'>;
  focusReturn: HTMLElement | null;
};

type AccountBlockerTarget = {
  account: PlatformAccount;
  focusReturn: HTMLElement | null;
};

function PlatformAccountsSection({
  active,
  csrfToken,
  onConsumersChanged,
  platformId,
}: {
  active: boolean;
  csrfToken: string | null;
  onConsumersChanged: (kind: PlatformAccountMutationKind) => Promise<void>;
  platformId: string;
}) {
  const queryClient = useQueryClient();
  const accounts = useQuery(platformAccountsQueryOptions(platformId, active));
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [editor, setEditor] = useState<AccountEditorTarget>();
  const [commandTarget, setCommandTarget] = useState<AccountCommandTarget>();
  const [blockerTarget, setBlockerTarget] = useState<AccountBlockerTarget>();

  async function invalidateAccount(kind: PlatformAccountMutationKind) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: platformKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: platformKeys.detail(platformId) }),
      queryClient.invalidateQueries({ queryKey: platformKeys.accounts(platformId) }),
      onConsumersChanged(kind),
    ]);
  }

  async function reloadAccount(accountId: string) {
    await queryClient.invalidateQueries({ queryKey: platformKeys.detail(platformId) });
    const fresh = await accounts.refetch();
    return fresh.data?.items.find((account) => account.id === accountId);
  }

  function handleCommand(
    command: string,
    account: PlatformAccount,
    focusReturn?: HTMLElement | null,
  ) {
    const target = focusReturn ?? document.activeElement as HTMLElement | null;
    if (command === 'edit-account') {
      setEditor({ account, focusReturn: target });
      return;
    }
    if (command === 'view-account-delete-conditions') {
      setBlockerTarget({ account, focusReturn: target });
      return;
    }
    if (command === 'enable-account' || command === 'disable-account' || command === 'delete-account') {
      setCommandTarget({
        account,
        command,
        focusReturn: command === 'delete-account' ? createTrigger.current : target,
      });
      return;
    }
    throw new Error(`Platform Accounts 收到未知命令：${command}`);
  }

  const items = accounts.data?.items ?? [];
  return (
    <section aria-labelledby="platform-accounts-title" className="rounded-xl border border-border-subtle bg-surface-panel p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-section-title" id="platform-accounts-title">发布账号</h2>
          <p className="mt-1 text-sm text-text-muted">管理业务标签和内部账号标识；不保存凭据。</p>
        </div>
        <Button
          onClick={() => setEditor({ focusReturn: createTrigger.current })}
          ref={createTrigger}
          type="button"
        >
          创建发布账号
        </Button>
      </div>
      {accounts.isPending ? (
        <div aria-busy="true" className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : accounts.error ? (
        <Notice actionLabel="重试" message={errorMessage(accounts.error)} onAction={() => void accounts.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default p-6 text-center text-text-muted">当前平台没有发布账号，可从此处创建第一个账号。</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <TableShell regionLabel="当前平台发布账号">
              <thead>
                <tr>
                  <th data-column-role="primary" scope="col">业务标签</th>
                  <th data-column-role="metadata" scope="col">内部账号标识</th>
                  <th data-column-role="status" scope="col">状态</th>
                  <th data-column-role="actions" scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((account) => (
                  <tr key={account.id}>
                    <td data-column-role="primary">{account.label}</td>
                    <td className="break-all font-mono" data-column-role="metadata">{account.account_identifier}</td>
                    <td data-column-role="status"><PlatformAccountStatus account={account} /></td>
                    <td data-column-role="actions">
                      <PlatformAccountActions account={account} onCommand={handleCommand} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <ul className="space-y-3 sm:hidden">
            {items.map((account) => (
              <li className="min-w-0 rounded-lg border border-border-subtle p-3" key={account.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="break-words font-medium text-text-primary">{account.label}</p>
                  <PlatformAccountStatus account={account} />
                </div>
                <p className="mt-2 break-all font-mono text-sm text-text-secondary">{account.account_identifier}</p>
                {account.workflow_stage === 'PLATFORM_DISABLED' && (
                  <p className="mt-2 text-xs text-warning">平台已停用，账号当前不可用于新发布。</p>
                )}
                <div className="mt-2 border-t border-border-subtle pt-2">
                  <PlatformAccountActions account={account} onCommand={handleCommand} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editor && (
        <PlatformAccountEditorDialog
          csrfToken={csrfToken}
          onClose={() => setEditor(undefined)}
          onReload={reloadAccount}
          onSaved={async (kind) => {
            await invalidateAccount(kind);
            setEditor(undefined);
          }}
          platformId={platformId}
          target={editor}
        />
      )}
      {commandTarget && (
        <PlatformAccountCommandDialog
          csrfToken={csrfToken}
          onClose={() => setCommandTarget(undefined)}
          onReload={reloadAccount}
          onSaved={async (kind) => {
            await invalidateAccount(kind);
            setCommandTarget(undefined);
          }}
          target={commandTarget}
        />
      )}
      <PlatformAccountBlockersDialog
        onClose={() => setBlockerTarget(undefined)}
        target={blockerTarget}
      />
    </section>
  );
}

function PlatformAccountActions({
  account,
  onCommand,
}: {
  account: PlatformAccount;
  onCommand: (command: string, account: PlatformAccount, focusReturn?: HTMLElement | null) => void;
}) {
  return (
    <RowActions
      objectLabel={account.label}
      onCommand={(command, focusReturn) => onCommand(command, account, focusReturn)}
      overflow={resolvePlatformAccountOverflowActions(account)}
      primary={resolvePlatformAccountPrimaryAction(account)}
    />
  );
}

function PlatformAccountStatus({ account }: { account: PlatformAccount }) {
  return (
    <Badge variant={account.is_active ? 'success' : 'secondary'}>
      {account.is_active ? 'Enabled' : 'Disabled'}
    </Badge>
  );
}

function PlatformAccountEditorDialog({
  csrfToken,
  onClose,
  onReload,
  onSaved,
  platformId,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onReload: (accountId: string) => Promise<PlatformAccount | undefined>;
  onSaved: (kind: 'create' | 'update') => Promise<void>;
  platformId: string;
  target: AccountEditorTarget;
}) {
  const [account, setAccount] = useState(target.account);
  const [requestId, setRequestId] = useState<string>();
  const [reloadError, setReloadError] = useState<string>();
  const form = useForm<PlatformAccountFormValues>({
    defaultValues: platformAccountFormValues(account),
    resolver: zodResolver(platformAccountFormSchema),
  });
  const save = useMutation({
    mutationFn: (values: PlatformAccountFormValues) => account
      ? updatePlatformAccount(account.id, toPlatformAccountUpdate(values, account), csrfToken)
      : createPlatformAccount(toPlatformAccountCreate(values, platformId), csrfToken),
  });

  async function submit(values: PlatformAccountFormValues) {
    form.clearErrors();
    setRequestId(undefined);
    save.reset();
    try {
      await save.mutateAsync(values);
      await onSaved(account ? 'update' : 'create');
    } catch (error) {
      const mapped = mapPlatformAccountFormError(error);
      for (const [field, message] of Object.entries(mapped.fields)) {
        form.setError(field as FieldPath<PlatformAccountFormValues>, { type: 'server', message });
      }
      if (mapped.formMessage) {
        form.setError('root.server', { type: 'server', message: mapped.formMessage });
      }
      setRequestId(mapped.requestId);
    }
  }

  async function reloadCanonical() {
    if (!account) return;
    setReloadError(undefined);
    try {
      const fresh = await onReload(account.id);
      if (!fresh) throw new Error('该发布账号已不存在');
      setAccount(fresh);
      form.reset(platformAccountFormValues(fresh));
      form.clearErrors();
      save.reset();
      setRequestId(undefined);
    } catch (error) {
      setReloadError(errorMessage(error));
    }
  }

  const conflict = isPlatformRevisionConflict(save.error);
  const summary = platformAccountFormSummary(form.formState.errors, requestId);
  return (
    <Dialog onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" finalFocus={() => target.focusReturn} showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{account ? '编辑发布账号' : '创建发布账号'}</DialogTitle>
          <DialogDescription>只保存业务标签和内部账号标识，不填写 API key、密码或其他凭据。</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" id="platform-account-form" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={summary} />
            {conflict && account && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" role="alert">
                <p>该账号已被其他请求修改。当前输入已保留，不会自动重放。</p>
                <Button onClick={() => void reloadCanonical()} type="button" variant="outline">重新加载服务端版本</Button>
                {reloadError && <p className="text-sm text-destructive">{reloadError}</p>}
              </div>
            )}
            <FormField<PlatformAccountFormValues, 'label'>
              id="platform-account-label"
              label="业务标签"
              name="label"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={save.isPending} id={context.inputId} maxLength={160} />
              )}
            />
            <FormField<PlatformAccountFormValues, 'accountIdentifier'>
              description="同一平台内按去除首尾空格并忽略大小写保持唯一。"
              id="platform-account-identifier"
              label="内部账号标识"
              name="accountIdentifier"
              required
              render={(context) => (
                <Input {...context.field} aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} disabled={save.isPending} id={context.inputId} maxLength={200} />
              )}
            />
          </form>
        </FormProvider>
        <DialogFooter>
          <DialogClose disabled={save.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={save.isPending || conflict} form="platform-account-form" type="submit">
            {save.isPending ? '保存中…' : account ? '保存账号' : '创建账号'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function platformAccountFormSummary(
  errors: ReturnType<typeof useForm<PlatformAccountFormValues>>['formState']['errors'],
  requestId?: string,
) {
  const summary = [];
  if (errors.label?.message) summary.push({ id: 'label', fieldId: 'platform-account-label', message: errors.label.message });
  if (errors.accountIdentifier?.message) summary.push({ id: 'identifier', fieldId: 'platform-account-identifier', message: errors.accountIdentifier.message });
  if (errors.root?.server?.message) summary.push({ id: 'server', message: errors.root.server.message });
  if (requestId) summary.push({ id: 'request', message: `请求 ID：${requestId}` });
  return summary;
}

function PlatformAccountCommandDialog({
  csrfToken,
  onClose,
  onReload,
  onSaved,
  target,
}: {
  csrfToken: string | null;
  onClose: () => void;
  onReload: (accountId: string) => Promise<PlatformAccount | undefined>;
  onSaved: (kind: 'status' | 'delete') => Promise<void>;
  target: AccountCommandTarget;
}) {
  const [account, setAccount] = useState(target.account);
  const [reloadMessage, setReloadMessage] = useState<string>();
  const mutation = useMutation({
    mutationFn: async () => {
      if (target.command === 'enable-account') return setPlatformAccountEnabled(account, true, csrfToken);
      if (target.command === 'disable-account') return setPlatformAccountEnabled(account, false, csrfToken);
      if (target.command === 'delete-account') return deletePlatformAccount(account, csrfToken);
      throw new Error(`Platform Account Dialog 收到未知命令：${target.command}`);
    },
  });

  async function confirm() {
    try {
      await mutation.mutateAsync();
      await onSaved(target.command === 'delete-account' ? 'delete' : 'status');
    } catch {
      // mutation.error 统一展示；409 保持 Dialog 和本次确认上下文。
    }
  }

  async function reloadCanonical() {
    setReloadMessage(undefined);
    try {
      const fresh = await onReload(account.id);
      if (!fresh) {
        setReloadMessage('该发布账号已不存在。');
        return;
      }
      setAccount(fresh);
      mutation.reset();
      setReloadMessage(`已加载 revision ${fresh.revision}，请重新确认。`);
    } catch (error) {
      setReloadMessage(errorMessage(error));
    }
  }

  const conflict = isPlatformRevisionConflict(mutation.error);
  const deleting = target.command === 'delete-account';
  const enabling = target.command === 'enable-account';
  const title = deleting ? `删除发布账号“${account.label}”？` : `${enabling ? '启用' : '停用'}发布账号“${account.label}”？`;
  return (
    <Dialog onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }} open>
      <DialogContent finalFocus={() => target.focusReturn} showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {deleting
              ? '服务端会使用当前 revision 重新校验非终态 PublicationWork；删除后不可恢复。'
              : enabling
                ? '启用后仍需平台本身可用，账号才可用于新发布。'
                : '停用后该账号不能用于新发布，既有历史记录保持不变。'}
          </DialogDescription>
        </DialogHeader>
        {mutation.error && <p className="text-sm text-destructive" role="alert">{errorMessage(mutation.error)}</p>}
        {conflict && (
          <Button onClick={() => void reloadCanonical()} type="button" variant="outline">重新加载服务端版本</Button>
        )}
        {reloadMessage && <p className="text-sm text-text-secondary" role="status">{reloadMessage}</p>}
        <DialogFooter>
          <DialogClose disabled={mutation.isPending} render={<Button variant="outline" />}>取消</DialogClose>
          <Button
            disabled={mutation.isPending || conflict}
            onClick={() => void confirm()}
            type="button"
            variant={deleting ? 'destructive' : 'default'}
          >
            {mutation.isPending ? '处理中…' : deleting ? '确认删除' : enabling ? '确认启用' : '确认停用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformAccountBlockersDialog({
  onClose,
  target,
}: {
  onClose: () => void;
  target?: AccountBlockerTarget;
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <DialogContent finalFocus={() => target?.focusReturn ?? null}>
        <DialogHeader>
          <DialogTitle>发布账号暂时不能删除</DialogTitle>
          <DialogDescription>“{target?.account.label}”存在服务端投影的直接阻断；删除时仍会实时复核。</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5">
          {target?.account.deletion?.blockers.map((blocker) => (
            <li key={blocker.type}>{deletionBlockerLabel(blocker)}：{blocker.count}</li>
          ))}
        </ul>
        <DialogFooter><DialogClose render={<Button variant="outline" />}>关闭</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformGenerationSection({
  active,
  csrfToken,
  detail,
  onDirtyChange,
  onReload,
  onUpdated,
}: {
  active: boolean;
  csrfToken: string | null;
  detail: PlatformProfileDetail;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => Promise<PlatformProfileDetail | undefined>;
  onUpdated: (profile: PlatformProfile) => Promise<void>;
}) {
  const canUpdate = detail.profile.available_actions.includes('UPDATE');
  const prompts = useQuery(platformPromptOptionsQueryOptions(active && canUpdate));
  const form = useForm<PlatformGenerationFormValues>({
    defaultValues: platformToGenerationValues(detail.profile),
    resolver: zodResolver(platformGenerationFormSchema),
  });
  const update = useMutation({
    mutationFn: (values: PlatformGenerationFormValues) => updatePlatformProfile(
      detail.profile.id,
      toPlatformGenerationUpdate(values, detail.profile),
      csrfToken,
    ),
  });
  const dirty = form.formState.isDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) form.reset(platformToGenerationValues(detail.profile));
  }, [detail.profile, dirty, form]);

  function reset(profile = detail.profile) {
    form.reset(platformToGenerationValues(profile));
    update.reset();
  }

  async function submit(values: PlatformGenerationFormValues) {
    try {
      const canonical = await update.mutateAsync(values);
      reset(canonical);
      await onUpdated(canonical);
    } catch {
      // 409 与其他服务端错误均保留用户选择，由错误区提供显式恢复动作。
    }
  }

  return (
    <section aria-labelledby="platform-generation-title" className="rounded-xl border border-border-subtle bg-surface-panel p-4">
      <h2 className="type-section-title" id="platform-generation-title">生成配置</h2>
      <p className="mt-1 text-sm text-text-muted">仅管理当前平台与现有 Prompt 的绑定，不编辑 Prompt 正文。</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metadata label="当前 Prompt" value={detail.profile.platform_prompt?.name ?? '未绑定'} />
        <Metadata label="Prompt revision" mono value={String(detail.profile.platform_prompt?.revision ?? '—')} />
        <Metadata label="Prompt 更新时间" value={<PlatformTime value={detail.profile.platform_prompt?.updated_at ?? null} />} />
      </dl>

      {!canUpdate ? (
        <p className="mt-4 rounded-lg bg-surface-raised p-3 text-sm text-text-secondary">当前账号可读取绑定关系，但没有修改生成配置的服务端动作。</p>
      ) : prompts.isPending ? (
        <Skeleton className="mt-4 h-24" />
      ) : prompts.error ? (
        <div className="mt-4"><Notice actionLabel="重试" message={errorMessage(prompts.error)} onAction={() => void prompts.refetch()} /></div>
      ) : (
        <FormProvider {...form}>
          <form className="mt-4 space-y-4" noValidate onSubmit={form.handleSubmit(submit)}>
            <ErrorSummary errors={update.error ? [{ id: 'server', message: errorMessage(update.error) }] : []} />
            {isPlatformRevisionConflict(update.error) && (
              <Button onClick={() => void onReload().then((fresh) => fresh && reset(fresh.profile))} type="button" variant="outline">重新加载服务端版本</Button>
            )}
            <FormField<PlatformGenerationFormValues, 'promptId'>
              description="解除绑定会使平台缺少生成配置，并立即影响 readiness。"
              id="platform-prompt"
              label="绑定 Prompt"
              name="promptId"
              render={(context) => (
                <Select items={[{ label: '不绑定 Prompt', value: 'NONE' }, ...(prompts.data?.items ?? []).map((prompt) => ({ label: `${prompt.name} · r${prompt.revision}`, value: prompt.id }))]} onValueChange={(value) => value && context.field.onChange(value)} value={context.field.value}>
                  <SelectTrigger aria-describedby={context['aria-describedby']} aria-invalid={context['aria-invalid']} id={context.inputId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">不绑定 Prompt</SelectItem>
                    {prompts.data?.items.map((prompt) => <SelectItem key={prompt.id} value={prompt.id}>{prompt.name} · r{prompt.revision}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FormActions>
              <Button disabled={update.isPending || !dirty} onClick={() => reset()} type="button" variant="outline">取消</Button>
              <Button disabled={update.isPending || !dirty} type="submit">{update.isPending ? '保存中…' : '保存生成配置'}</Button>
            </FormActions>
          </form>
        </FormProvider>
      )}
    </section>
  );
}

function PlatformSummaryGrid({ detail }: { detail: PlatformProfileDetail }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metadata label="Readiness" value={readinessRegistry[detail.profile.readiness_status].label} />
      <Metadata label="发布账号" value={`${detail.account_summary.enabled}/${detail.account_summary.total} 个可用`} />
      <Metadata label="近 30 天业务引用" value={String(detail.reference_summary.recent_30_days)} />
      <Metadata label="全部业务引用" value={String(detail.reference_summary.all_time)} />
      <Metadata label="Prompt" value={detail.profile.platform_prompt?.name ?? '未绑定'} />
      <Metadata label="Revision" mono value={String(detail.profile.revision)} />
      <Metadata label="Updated time" value={<PlatformTime value={detail.profile.updated_at} />} />
      <Metadata label="摘要时点" value={<PlatformTime value={detail.reference_summary.as_of} />} />
    </dl>
  );
}

function PlatformLogoImage({ logo, name }: { logo: PlatformProfile['logo']; name: string }) {
  return logo ? (
    <img alt={`${name} Logo`} className="h-16 w-16 rounded-xl border border-border-subtle object-contain p-2" src={logo.url} />
  ) : (
    <div aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-raised font-semibold text-text-muted">{name.slice(0, 1)}</div>
  );
}

function PlatformWorkspaceSkeleton({ platformId }: { platformId: string }) {
  return (
    <article aria-busy="true" className="space-y-4">
      <header className="space-y-2">
        <p className="type-label text-text-muted">Platform Workspace</p>
        <h1 className="type-page-title">正在加载平台</h1>
        <p className="break-all font-mono text-sm text-text-secondary">{platformId}</p>
      </header>
      <Skeleton className="h-28" />
      <Skeleton className="h-80" />
    </article>
  );
}

function PlatformWorkspaceFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = platformDetailErrorKind(error);
  const content = {
    'not-found': ['未找到平台', '该平台不存在，或已被删除。'],
    forbidden: ['无法访问 Platform Workspace', '当前会话没有读取该平台工作区的权限。'],
    generic: ['Platform Workspace 加载失败', errorMessage(error)],
  }[kind];
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{content[0]}</h1>
      <p className="text-text-secondary">{content[1]}</p>
      <div className="flex flex-wrap gap-2">
        <a className="rounded-md border border-border-default px-3 py-2 text-sm font-medium" href="/settings/platforms?page=1&pageSize=20">返回 Platform List</a>
        {kind === 'generic' && <Button onClick={onRetry} type="button">重试</Button>}
      </div>
    </section>
  );
}

function DeletionBlockersDialog({
  finalFocus,
  onClose,
  open,
  profile,
}: {
  finalFocus: HTMLElement | null;
  onClose: () => void;
  open: boolean;
  profile: PlatformProfile;
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent finalFocus={{ current: finalFocus }}>
        <DialogHeader>
          <DialogTitle>平台暂时不能删除</DialogTitle>
          <DialogDescription>服务端返回的当前直接阻断如下；刷新 Workspace 可重新核实。</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5">
          {profile.deletion?.blockers.map((blocker) => <li key={blocker.type}>{deletionBlockerLabel(blocker)}：{blocker.count}</li>)}
        </ul>
        <DialogFooter><DialogClose render={<Button variant="outline" />}>关闭</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnablePlatformDialog({
  finalFocus,
  onClose,
  onConfirm,
  open,
  profile,
}: {
  finalFocus: HTMLElement | null;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  profile: PlatformProfile;
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent finalFocus={{ current: finalFocus }}>
        <DialogHeader>
          <DialogTitle>启用平台“{profile.name}”？</DialogTitle>
          <DialogDescription>启用不会自动补齐 Prompt 或发布账号。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={onConfirm} type="button">启用平台</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metadata({ label, mono = false, value }: { label: string; mono?: boolean; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function PlatformTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-text-muted">暂无</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="font-mono">{value}</span>;
  return <time dateTime={value}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</time>;
}

function Notice({ actionLabel, message, onAction }: { actionLabel: string; message: string; onAction: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <p className="text-sm text-text-primary">{message}</p>
      <Button onClick={onAction} size="sm" type="button" variant="outline">{actionLabel}</Button>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误';
}

export { PlatformWorkspacePage };
export type {
  PlatformAccountMutationKind,
  PlatformMutationKind,
  PlatformWorkspacePageProps,
};
