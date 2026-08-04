/** 管理具体平台身份、服务端集合筛选、配置状态与关联详情。 */
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  EllipsisOutlined,
  ExportOutlined,
  FileTextOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Dropdown,
  Form,
  Grid,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import {
  platformProfilesQueryOptions,
  platformPromptsQueryOptions,
  platformTypesQueryOptions,
} from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type {
  PlatformProfile,
  PlatformProfileExportQuery,
  PlatformProfileListQuery,
  Schema,
} from '../../shared/api/types';
import { NoData, QueryFailure } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { DirectUpload } from '../../shared/components/DirectUpload';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';
import { PlatformDetailPanel } from './PlatformDetailPanel';

type PlatformLogoSource = 'UNCHANGED' | 'NONE' | 'UPLOAD';
type PlatformBrandingFormValues = {
  name: string;
  platform_type_id: string;
  allowed_domains: string[];
  website_url?: string;
  platform_prompt_id?: string;
  logo_source: PlatformLogoSource;
  logo_file_id?: string;
};
type PlatformCreateFormValues = PlatformBrandingFormValues & { slug: string };
type PlatformUpdateFormValues = PlatformBrandingFormValues & { expected_revision: number };
const platformTaskLabels: Record<PlatformProfile['primary_task'], string> = {
  ENABLE_PLATFORM: '重新启用',
  CONFIGURE_GENERATION: '配置系统生成',
  VIEW_PLATFORM_OPERATION: '查看平台运营',
};

const pageSizes = [10, 20, 50] as const;
const statusOptions: Array<{ value: Schema<'PlatformProfileStatus'>; label: string }> = [
  { value: 'ENABLED', label: '已启用' },
  { value: 'DISABLED', label: '已停用' },
];
const configurationOptions: Array<{ value: Schema<'PlatformConfigurationStatus'>; label: string }> = [
  { value: 'COMPLETE', label: '配置完整' },
  { value: 'INCOMPLETE', label: '配置不完整' },
];
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function positiveInteger(value: string | null, fallback: number) {
  if (value === null || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function isOptionValue<T extends string>(value: string | null, options: ReadonlyArray<{ value: T }>): value is T {
  return options.some((option) => option.value === value);
}

function platformLogoInput(values: PlatformBrandingFormValues): Schema<'PlatformLogoUploadInput'> | null | undefined {
  if (values.logo_source === 'UNCHANGED') return undefined;
  if (values.logo_source === 'NONE') return null;
  if (!values.logo_file_id) throw new Error('请先上传并校验 Logo 文件');
  return { source: 'UPLOAD', file_id: values.logo_file_id };
}

export function PlatformsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<PlatformProfile | null>(null);
  const [modal, modalContext] = Modal.useModal();
  const lastDetailTriggerId = useRef<string | null>(null);
  const screens = Grid.useBreakpoint();
  const { message } = App.useApp();
  const { focusReturnTargetProps, restoreFocus } = useFocusReturn();

  const rawStatus = searchParams.get('status');
  const rawConfigurationStatus = searchParams.get('configuration_status');
  const rawPage = searchParams.get('page');
  const rawPageSize = searchParams.get('page_size');
  const q = searchParams.get('q')?.trim() ?? '';
  const platformTypeId = searchParams.get('platform_type_id') ?? undefined;
  const selectedPlatformId = searchParams.get('platform') ?? undefined;
  const status = isOptionValue(rawStatus, statusOptions) ? rawStatus : undefined;
  const configurationStatus = isOptionValue(rawConfigurationStatus, configurationOptions) ? rawConfigurationStatus : undefined;
  const page = positiveInteger(rawPage, 1);
  const pageSize = pageSizes.includes(Number(rawPageSize) as typeof pageSizes[number])
    ? Number(rawPageSize) as typeof pageSizes[number]
    : 20;
  const invalidView = (rawStatus !== null && !status)
    || (rawConfigurationStatus !== null && !configurationStatus)
    || (rawPage !== null && positiveInteger(rawPage, 0) === 0)
    || (rawPageSize !== null && !pageSizes.includes(Number(rawPageSize) as typeof pageSizes[number]));

  useEffect(() => {
    if (!invalidView) return;
    const next = new URLSearchParams(searchParams);
    if (!isOptionValue(next.get('status'), statusOptions)) next.delete('status');
    if (!isOptionValue(next.get('configuration_status'), configurationOptions)) next.delete('configuration_status');
    if (next.has('page') && positiveInteger(next.get('page'), 0) === 0) next.delete('page');
    if (next.has('page_size') && !pageSizes.includes(Number(next.get('page_size')) as typeof pageSizes[number])) next.delete('page_size');
    setSearchParams(next, { replace: true });
  }, [invalidView, searchParams, setSearchParams]);

  const listQuery = useMemo<PlatformProfileListQuery>(() => ({
    page,
    page_size: pageSize,
    ...(q ? { q } : {}),
    ...(platformTypeId ? { platform_type_id: platformTypeId } : {}),
    ...(status ? { status } : {}),
    ...(configurationStatus ? { configuration_status: configurationStatus } : {}),
  }), [configurationStatus, page, pageSize, platformTypeId, q, status]);
  const exportQuery = useMemo<PlatformProfileExportQuery>(() => ({
    ...(q ? { q } : {}),
    ...(platformTypeId ? { platform_type_id: platformTypeId } : {}),
    ...(status ? { status } : {}),
    ...(configurationStatus ? { configuration_status: configurationStatus } : {}),
  }), [configurationStatus, platformTypeId, q, status]);

  const platforms = useQuery(platformProfilesQueryOptions(listQuery));
  const platformTypes = useQuery(platformTypesQueryOptions());
  const platformPrompts = useQuery(platformPromptsQueryOptions());

  const updateParams = (updates: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key); else next.set(key, value);
    }
    setSearchParams(next, { replace });
  };
  const updateFilter = (updates: Record<string, string | undefined>, replace = false) => updateParams({ ...updates, page: undefined }, replace);
  const openDetail = (platformId: string, trigger?: HTMLElement | null) => {
    lastDetailTriggerId.current = trigger ? platformId : null;
    updateParams({ platform: platformId });
  };
  const restoreDetailFocus = () => {
    if (!lastDetailTriggerId.current) return;
    document.querySelector<HTMLElement>(`[data-platform-view="${lastDetailTriggerId.current}"]`)?.focus({ preventScroll: true });
  };
  const closeDetail = () => {
    updateParams({ platform: undefined });
    if (screens.xl) requestAnimationFrame(restoreDetailFocus);
  };
  const invalidatePlatform = async (platformId?: string) => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.platformPrompts.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
    ];
    if (platformId) invalidations.push(queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.detail(platformId) }));
    await Promise.all(invalidations);
  };

  const create = useMutation({
    mutationFn: async (body: Schema<'PlatformProfileCreate'>) => unwrap(await api.POST('/api/v1/platform-profiles', { params: { header: csrfHeader() }, body })),
    onSuccess: async (created) => { setCreateOpen(false); message.success('平台已创建'); await invalidatePlatform(); openDetail(created.id); },
  });
  const updateProfile = useMutation({
    mutationFn: async (body: Schema<'PlatformProfileUpdate'>) => {
      if (!editProfile) throw new Error('未选择平台');
      return unwrap(await api.PATCH('/api/v1/platform-profiles/{platform_profile_id}', {
        params: { path: { platform_profile_id: editProfile.id }, header: csrfHeader() }, body,
      }));
    },
    onSuccess: async (saved) => { setEditProfile(null); message.success('平台身份与归类已保存'); await invalidatePlatform(saved.id); },
  });
  const toggleProfile = useMutation({
    mutationFn: async (profile: PlatformProfile) => {
      const path = profile.is_active
        ? '/api/v1/platform-profiles/{platform_profile_id}/disable' as const
        : '/api/v1/platform-profiles/{platform_profile_id}/enable' as const;
      return unwrap(await api.POST(path, {
        params: { path: { platform_profile_id: profile.id }, header: csrfHeader() },
        body: { expected_revision: profile.revision },
      }));
    },
    onSuccess: async (saved) => { message.success(saved.is_active ? '平台已启用' : '平台已停用'); await invalidatePlatform(saved.id); },
  });
  const removeProfile = useMutation({
    mutationFn: async (profile: PlatformProfile) => ensureSuccess(await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}', {
      params: { path: { platform_profile_id: profile.id }, header: csrfHeader() },
    })),
    onSuccess: async (_, profile) => {
      message.success('平台已删除');
      queryClient.removeQueries({ queryKey: queryKeys.platformProfiles.detail(profile.id) });
      if (selectedPlatformId === profile.id) closeDetail();
      await invalidatePlatform();
    },
  });
  const exportList = useMutation({
    mutationFn: async () => {
      const result = await api.GET('/api/v1/platform-profiles/export', { params: { query: exportQuery } });
      const csv = unwrap(result);
      const disposition = result.response.headers.get('Content-Disposition');
      const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : plainName ?? 'platform-profiles.csv';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => message.success('平台列表已导出'),
  });

  const platformItems = platforms.data?.items ?? [];
  const platformTypeOptions = platformTypes.data?.items.map((item) => ({ value: item.id, label: item.name })) ?? [];
  const platformPromptOptions = platformPrompts.data?.items.map((item) => ({ value: item.id, label: item.name })) ?? [];
  const queryError = platforms.error ?? platformTypes.error ?? platformPrompts.error;
  const mutationError = create.error ?? updateProfile.error ?? toggleProfile.error ?? exportList.error;
  const hasFilters = !!(q || platformTypeId || status || configurationStatus);

  const confirmDelete = (profile: PlatformProfile, afterClose?: () => void) => modal.confirm({
    title: `删除平台“${profile.name}”？`,
    content: '将删除平台配置；Prompt 模板不会随之删除。存在内容任务或平台账号引用时服务端会拒绝，既有历史不会被改写。此操作不可恢复。',
    okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
    onOk: () => removeProfile.mutateAsync(profile),
    afterClose,
  });
  const confirmToggle = (profile: PlatformProfile, afterClose?: () => void) => modal.confirm({
    title: `${profile.is_active ? '停用' : '启用'}平台“${profile.name}”？`,
    content: profile.is_active
      ? '停用后不能新建关联任务、账号或发布工作；既有配置和历史保持不变。'
      : '启用不会自动补齐 Prompt，配置完整性保持独立。',
    okText: profile.is_active ? '停用平台' : '启用平台', cancelText: '取消',
    okButtonProps: profile.is_active ? { danger: true } : undefined,
    onOk: () => toggleProfile.mutateAsync(profile),
    afterClose,
  });

  const rowMenu = (profile: PlatformProfile): MenuProps => {
    const items: NonNullable<MenuProps['items']> = [];
    if (profile.available_actions.includes('UPDATE')) items.push({ key: 'edit', label: '编辑平台' });
    if (profile.available_actions.includes('DISABLE')) items.push({ key: 'toggle', label: '停用平台', danger: true });
    if (profile.available_actions.includes('ENABLE') && profile.primary_task !== 'ENABLE_PLATFORM') items.push({ key: 'toggle', label: '启用平台' });
    if (profile.available_actions.includes('DELETE')) items.push({ key: 'delete', label: '删除平台', danger: true });
    return {
      items,
      onClick: ({ key }) => {
        if (key === 'edit') setEditProfile(profile);
        else if (key === 'toggle') confirmToggle(profile, restoreFocus);
        else if (key === 'delete') confirmDelete(profile, restoreFocus);
      },
    };
  };

  const summary = platforms.data?.summary;
  const metricItems = [
    { key: 'total', label: '平台总数', value: summary?.platform_total, tone: 'data', icon: <AppstoreOutlined /> },
    { key: 'enabled', label: '已启用平台', value: summary?.enabled_total, tone: 'success', icon: <CheckCircleOutlined /> },
    { key: 'prompt', label: '缺少 Prompt', value: summary?.missing_prompt_total, tone: 'warning', icon: <FileTextOutlined /> },
    { key: 'complete', label: '配置完整平台', value: summary?.configuration_complete_total, tone: 'success', icon: <SafetyCertificateOutlined /> },
  ] as const;

  const detail = selectedPlatformId ? <PlatformDetailPanel
    platformId={selectedPlatformId}
    onClose={closeDetail}
    onEdit={setEditProfile}
    onToggle={confirmToggle}
    onDelete={confirmDelete}
    toggleLoading={toggleProfile.isPending}
    deleteLoading={removeProfile.isPending}
  /> : null;

  return <div className="page-stack platform-management-page">
    {modalContext}
    <PageHeader
      eyebrow="平台治理"
      title="平台管理"
      description="管理具体内容平台、所属类型、官网、允许域名及配置完整性。"
      actions={<Button type="primary" icon={<PlusOutlined />} aria-haspopup="dialog" aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>新增平台</Button>}
    />
    {mutationError && <Alert role="alert" type="error" showIcon title={errorMessage(mutationError)} />}
    {removeProfile.error && <DeletionError error={removeProfile.error} />}

    <div className={`platform-management-workspace${selectedPlatformId && screens.xl ? ' has-detail' : ''}`}>
      <main className="platform-management-main">
        <section className="platform-metric-grid" aria-label="平台实时统计">
          {metricItems.map((item) => <MetricTile key={item.key} icon={item.icon} label={item.label} value={item.value ?? '—'} tone={item.tone} />)}
        </section>

        <Card className="platform-filter-panel">
          <div className="platform-filter-grid" role="search" aria-label="平台筛选">
            <label className="platform-filter-field">
              <span>关键词</span>
              <Input.Search
                key={q}
                allowClear
                defaultValue={q}
                maxLength={200}
                aria-label="搜索平台名称或类型"
                prefix={<SearchOutlined />}
                placeholder="搜索平台名称或类型"
                enterButton={false}
                onSearch={(value) => updateFilter({ q: value.trim() || undefined }, true)}
              />
            </label>
            <label className="platform-filter-field"><span>平台类型</span><Select allowClear aria-label="筛选平台类型" placeholder="全部类型" value={platformTypeId} options={platformTypeOptions} onChange={(value) => updateFilter({ platform_type_id: value })} /></label>
            <label className="platform-filter-field"><span>启用状态</span><Select allowClear aria-label="筛选平台状态" placeholder="全部状态" value={status} options={statusOptions} onChange={(value) => updateFilter({ status: value })} /></label>
            <label className="platform-filter-field"><span>配置完整性</span><Select allowClear aria-label="筛选配置完整性" placeholder="全部状态" value={configurationStatus} options={configurationOptions} onChange={(value) => updateFilter({ configuration_status: value })} /></label>
            <Button icon={<ReloadOutlined />} disabled={!hasFilters} onClick={() => updateFilter({ q: undefined, platform_type_id: undefined, status: undefined, configuration_status: undefined })}>重置</Button>
            <span className="platform-filter-spacer" />
            <Typography.Text type="secondary">共 {platforms.data?.total ?? '—'} 个平台</Typography.Text>
            <Button icon={<ExportOutlined />} loading={exportList.isPending} onClick={() => exportList.mutate()}>导出列表</Button>
          </div>
        </Card>

        <Card className="platform-table-panel">
          {queryError ? <QueryFailure error={queryError} onRetry={() => { void platforms.refetch(); void platformTypes.refetch(); void platformPrompts.refetch(); }} /> : <TableRegion label="平台列表">
            <Table<PlatformProfile>
              rowKey="id"
              loading={{ spinning: platforms.isLoading || platformTypes.isLoading || platformPrompts.isLoading, description: '正在加载平台列表' }}
              dataSource={platformItems}
              scroll={{ x: 900, y: 'calc(100dvh - 473px)' }}
              locale={{ emptyText: <NoData description={hasFilters ? '没有符合当前筛选条件的平台' : '暂无具体平台'} /> }}
              rowClassName={(profile) => profile.id === selectedPlatformId ? 'platform-row-selected' : ''}
              pagination={{
                current: page,
                pageSize,
                total: platforms.data?.total ?? 0,
                showSizeChanger: true,
                pageSizeOptions: [...pageSizes],
                showQuickJumper: true,
                responsive: true,
                onChange: (nextPage, nextPageSize) => updateParams({
                  page: nextPageSize !== pageSize || nextPage === 1 ? undefined : String(nextPage),
                  page_size: nextPageSize === 20 ? undefined : String(nextPageSize),
                }),
              }}
              columns={[
                { title: '平台名称', render: (_, profile) => <Tooltip title={profile.name} trigger={['hover', 'focus']}><div className="platform-identity-cell" tabIndex={0} aria-label={profile.name}><PlatformAvatar name={profile.name} logo={profile.logo} size={24} /><strong className="table-cell-ellipsis">{profile.name}</strong></div></Tooltip> },
                { title: '所属平台类型', width: 120, ellipsis: true, render: (_, profile) => <TableCellText text={profile.platform_type?.name ?? '未归类'} /> },
                { title: '官方网站', dataIndex: 'website_url', width: 110, render: (value: string | null) => value ? <Tooltip title={value} trigger={['hover', 'focus']}><a className="platform-table-link table-cell-ellipsis" href={value} target="_blank" rel="noreferrer">{value}</a></Tooltip> : '—' },
                { title: '允许域名（数量）', dataIndex: 'allowed_domains', width: 125, render: (items: string[]) => items.length ? <Tooltip title={items.join('、')} trigger={['hover', 'focus']}><span className="platform-table-link table-cell-ellipsis" tabIndex={0} aria-label={items.join('、')}>{items[0]}{items.length > 1 ? ` 等 ${items.length} 个` : ''}</span></Tooltip> : '—' },
                { title: '状态', width: 72, render: (_, profile) => <StatusTag compact status={profile.is_active ? 'ENABLED' : 'DISABLED'} /> },
                { title: '当前 Prompt', width: 160, ellipsis: true, render: (_, profile) => profile.platform_prompt ? <TableCellText text={profile.platform_prompt.name} /> : <StatusTag compact status="PROMPT_MISSING" /> },
                { title: '发布账号数量', dataIndex: 'platform_account_count', width: 86 },
                { title: '更新时间', dataIndex: 'updated_at', width: 124, render: (value: string | null) => value ? <time dateTime={value}>{dateTimeFormatter.format(new Date(value))}</time> : '—' },
                { title: '操作', fixed: 'right', width: 210, render: (_, profile) => <Space size={4}><Button data-platform-view={profile.id} type="primary" size="small" onClick={(event) => profile.primary_task === 'ENABLE_PLATFORM' ? confirmToggle(profile, restoreFocus) : openDetail(profile.id, event.currentTarget)}>{platformTaskLabels[profile.primary_task]}</Button>{rowMenu(profile).items?.length ? <Dropdown trigger={['click']} menu={rowMenu(profile)}><Tooltip title={`更多操作：${profile.name}`}><Button {...focusReturnTargetProps} type="text" size="small" aria-label={`更多操作：${profile.name}`} icon={<EllipsisOutlined />} loading={(toggleProfile.isPending || removeProfile.isPending) && (toggleProfile.variables?.id === profile.id || removeProfile.variables?.id === profile.id)} /></Tooltip></Dropdown> : null}</Space> },
              ]}
            />
          </TableRegion>}
        </Card>
      </main>
      {selectedPlatformId && screens.xl && detail}
    </div>

    <Drawer className="platform-detail-drawer" open={!!selectedPlatformId && !screens.xl} onClose={closeDetail} afterOpenChange={(open) => {
      if (!open) requestAnimationFrame(() => requestAnimationFrame(restoreDetailFocus));
    }} closable={false} size="min(100vw, 420px)">{detail}</Drawer>
    <Modal title="新增平台" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={640} destroyOnHidden><PlatformForm typeOptions={platformTypeOptions} promptOptions={platformPromptOptions} loading={create.isPending} onSubmit={(values) => create.mutate(values)} /></Modal>
    <Modal title={`编辑 ${editProfile?.name ?? ''} 的平台信息`} open={!!editProfile} onCancel={() => setEditProfile(null)} footer={null} width={640} destroyOnHidden>{editProfile && <PlatformIdentityForm profile={editProfile} typeOptions={platformTypeOptions} promptOptions={platformPromptOptions} loading={updateProfile.isPending} onSubmit={(values) => updateProfile.mutate(values)} />}</Modal>
  </div>;
}

function PlatformForm({ typeOptions, promptOptions, loading, onSubmit }: { typeOptions: Array<{ value: string; label: string }>; promptOptions: Array<{ value: string; label: string }>; loading: boolean; onSubmit: (value: Schema<'PlatformProfileCreate'>) => void }) {
  return <Form<PlatformCreateFormValues> layout="vertical" initialValues={{ logo_source: 'NONE' }} onFinish={(values) => {
    const logo = platformLogoInput(values);
    onSubmit({ name: values.name, slug: values.slug, platform_type_id: values.platform_type_id, platform_prompt_id: values.platform_prompt_id ?? null, allowed_domains: values.allowed_domains, website_url: values.website_url?.trim() || null, ...(logo === undefined ? {} : { logo }) });
  }}><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input autoFocus /></Form.Item><Form.Item name="slug" label="唯一标识（slug）" rules={[{ required: true, pattern: /^[a-z0-9-]+$/ }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item><Form.Item name="platform_prompt_id" label="当前 Prompt"><Select allowClear showSearch optionFilterProp="label" placeholder="可暂不绑定，之后仍可手动录入内容" options={promptOptions} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><PlatformBrandingFields editing={false} currentLogo={null} /><Button type="primary" htmlType="submit" loading={loading}>创建平台</Button></Form>;
}

function PlatformIdentityForm({ profile, typeOptions, promptOptions, loading, onSubmit }: { profile: PlatformProfile; typeOptions: Array<{ value: string; label: string }>; promptOptions: Array<{ value: string; label: string }>; loading: boolean; onSubmit: (value: Schema<'PlatformProfileUpdate'>) => void }) {
  return <Form<PlatformUpdateFormValues> layout="vertical" initialValues={{ expected_revision: profile.revision, name: profile.name, allowed_domains: profile.allowed_domains, platform_type_id: profile.platform_type_id ?? undefined, platform_prompt_id: profile.platform_prompt?.id, website_url: profile.website_url ?? undefined, logo_source: 'UNCHANGED' }} onFinish={(values) => {
    const logo = platformLogoInput(values);
    onSubmit({ expected_revision: values.expected_revision, name: values.name, platform_type_id: values.platform_type_id, platform_prompt_id: values.platform_prompt_id ?? null, allowed_domains: values.allowed_domains, website_url: values.website_url?.trim() || null, ...(logo === undefined ? {} : { logo }) });
  }}><Form.Item name="expected_revision" hidden><InputNumber /></Form.Item><Form.Item name="name" label="平台名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="platform_type_id" label="平台类型" rules={[{ required: true }]}><Select options={typeOptions} /></Form.Item><Form.Item name="platform_prompt_id" label="当前 Prompt"><Select allowClear showSearch optionFilterProp="label" placeholder="未绑定时系统 AI 生成不可用" options={promptOptions} /></Form.Item><Form.Item name="allowed_domains" label="允许域名" rules={[{ required: true }]}><Select mode="tags" /></Form.Item><PlatformBrandingFields editing currentLogo={profile.logo} /><Button type="primary" htmlType="submit" loading={loading}>保存平台</Button></Form>;
}

function PlatformBrandingFields({ editing, currentLogo }: { editing: boolean; currentLogo: PlatformProfile['logo'] }) {
  const form = Form.useFormInstance<PlatformBrandingFormValues>();
  const logoSource = Form.useWatch('logo_source', form);
  const logoFileId = Form.useWatch('logo_file_id', form);
  const [candidate, setCandidate] = useState<Schema<'PlatformLogoCandidate'>>();
  const discover = useMutation({
    mutationFn: async (websiteUrl: string) => unwrap(await api.POST('/api/v1/platform-logo-candidates', {
      params: { header: csrfHeader() },
      body: { website_url: websiteUrl },
    })),
    onSuccess: setCandidate,
  });
  const discoverFromWebsite = async () => {
    const websiteUrl = form.getFieldValue('website_url')?.trim();
    if (!websiteUrl) {
      form.setFields([{ name: 'website_url', errors: ['请先填写官方网站'] }]);
      return;
    }
    try {
      await form.validateFields(['website_url']);
      setCandidate(undefined);
      discover.mutate(websiteUrl);
    } catch {
      return;
    }
  };
  return <div className="platform-branding-fields">
    <Form.Item name="website_url" label="官方网站" rules={[{ type: 'url', message: '请输入完整的 http(s) URL' }]}><Input type="url" placeholder="https://platform.example.com" onChange={() => {
      setCandidate(undefined);
      discover.reset();
    }} /></Form.Item>
    {currentLogo?.source === 'EXTERNAL' && <Alert type="info" showIcon title="旧外链 Logo（只读）" description="保存其他字段时会继续保留；请选择官网发现、手工上传或清空后才退出旧外链。" />}
    <Form.Item label="官网 Logo">
      <Button icon={<GlobalOutlined />} loading={discover.isPending} onClick={() => void discoverFromWebsite()}>从官网发现 Logo</Button>
      {discover.error && <Alert role="alert" type="error" showIcon title={errorMessage(discover.error)} />}
      {candidate && <Space orientation="vertical" className="platform-logo-candidate">
        <Image src={candidate.preview.url} alt="官网 Logo 候选" width={72} height={72} preview={false} />
        <Typography.Text type="secondary">Icon Horse 已选定这一张候选；请人工确认品牌是否正确。</Typography.Text>
        <Space wrap>
          <Button type="primary" onClick={() => {
            form.setFieldValue('logo_source', 'UPLOAD');
            form.setFieldValue('logo_file_id', candidate.file_id);
            setCandidate(undefined);
          }}>使用此 Logo</Button>
          <Button onClick={() => setCandidate(undefined)}>取消</Button>
        </Space>
      </Space>}
    </Form.Item>
    <Form.Item name="logo_source" label="Logo 操作" rules={[{ required: true }]}><Select onChange={() => form.setFieldValue('logo_file_id', undefined)} options={[
      ...(editing ? [{ value: 'UNCHANGED', label: '保持当前 Logo' }] : []),
      { value: 'NONE', label: '清空 Logo' },
      { value: 'UPLOAD', label: '手工上传 Logo' },
    ]} /></Form.Item>
    <Form.Item name="logo_file_id" hidden><Input /></Form.Item>
    {logoSource === 'UPLOAD' && <Form.Item label="Logo 文件" required><DirectUpload category="PLATFORM_LOGO" accessLevel="PUBLIC" accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico" onUploaded={(file) => form.setFieldValue('logo_file_id', file.id)} />{logoFileId && <Typography.Text type="success">已校验 Logo 文件，可继续保存平台。</Typography.Text>}<Typography.Paragraph type="secondary" className="platform-logo-help">支持 PNG、JPEG、WebP、ICO，最大 2 MiB；不接受 SVG。</Typography.Paragraph></Form.Item>}
  </div>;
}
