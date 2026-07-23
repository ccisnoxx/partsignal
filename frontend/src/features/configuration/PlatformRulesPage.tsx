/** 平台规则工作台编排 URL、查询、版本命令与响应式四栏布局。 */
import { ArrowLeftOutlined, InfoCircleOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import {
  auditLogsQueryOptions,
  platformProfilesQueryOptions,
  platformProfileVersionImpactQueryOptions,
  platformProfileVersionsForProfileQueryOptions,
  platformProfileVersionsQueryOptions,
} from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfile, PlatformProfileListQuery, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError } from '../../shared/components/DeletionError';
import { PageHeader } from '../../shared/components/PageHeader';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { StatusTag } from '../../shared/components/StatusTag';
import {
  PlatformRuleDetail,
  ruleDifferenceCount,
  type RuleVersionSummary,
} from './PlatformRuleDetail';
import { PlatformRuleMetaPanel } from './PlatformRuleMetaPanel';

type CommandAction = 'ACTIVATE' | 'RETIRE';
type MobileStage = 'PLATFORMS' | 'VERSIONS' | 'DETAIL';

const versionDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

const emptyRules: Schema<'PlatformRules'> = {
  target_audience: '',
  title_min: 1,
  title_max: 1,
  body_min: 1,
  body_max: 1,
  tone: '',
  allow_external_links: false,
  allow_tables: false,
  allow_contact: false,
  prohibited_phrases: [],
  sections: [],
};

function previousVersion(
  version: RuleVersionSummary,
  versions: RuleVersionSummary[],
): RuleVersionSummary | undefined {
  return versions
    .filter((item) => item.version < version.version)
    .sort((left, right) => right.version - left.version)[0];
}

function versionChangeSummary(
  version: RuleVersionSummary,
  versions: RuleVersionSummary[],
): string {
  const baseline = previousVersion(version, versions);
  if (!baseline) return '首个版本';
  const count = ruleDifferenceCount(version.rules, baseline.rules);
  return count ? `${count} 项规则字段变化` : '无规则字段变化';
}

export function PlatformRulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editVersion, setEditVersion] = useState<RuleVersionSummary>();
  const [commandState, setCommandState] = useState<{ action: CommandAction; version: RuleVersionSummary }>();
  const [metaOpen, setMetaOpen] = useState(false);
  const [mobileStage, setMobileStage] = useState<MobileStage>('PLATFORMS');
  const [modal, modalContext] = Modal.useModal();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  const requestedProfileId = searchParams.get('platform_profile_id') ?? undefined;
  const requestedVersionId = searchParams.get('version_id') ?? undefined;
  const queryText = searchParams.get('q') ?? '';
  const profileQuery = useMemo<PlatformProfileListQuery>(() => ({
    ...(queryText ? { q: queryText } : {}),
  }), [queryText]);

  const profiles = useQuery(platformProfilesQueryOptions(profileQuery));
  const allVersions = useQuery(platformProfileVersionsQueryOptions());
  const profileItems = profiles.data?.items ?? [];
  const selectedProfile = profileItems.find((profile) => profile.id === requestedProfileId);
  const versions = useQuery(platformProfileVersionsForProfileQueryOptions(selectedProfile?.id));
  const versionItems = versions.data?.items ?? [];
  const selectedVersion = versionItems.find((version) => version.id === requestedVersionId);
  const impact = useQuery(platformProfileVersionImpactQueryOptions(selectedVersion?.id));
  const audit = useQuery(auditLogsQueryOptions('PlatformProfileVersion', selectedVersion?.id));
  const users = useQuery({
    queryKey: queryKeys.users.list({ page: 1, page_size: 100 }),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', { params: { query: { page: 1, page_size: 100 } } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });

  const updateUrl = (
    updates: Record<string, string | undefined>,
    options: { replace?: boolean } = {},
  ) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value); else next.delete(key);
    });
    setSearchParams(next, { replace: options.replace });
  };

  useEffect(() => {
    const firstProfile = profiles.data?.items[0];
    if (!firstProfile || requestedProfileId) return;
    const next = new URLSearchParams(searchParams);
    next.set('platform_profile_id', firstProfile.id);
    next.delete('version_id');
    setSearchParams(next, { replace: true });
  }, [profiles.data, requestedProfileId, searchParams, setSearchParams]);
  useEffect(() => {
    const firstVersion = versions.data?.items[0];
    if (!firstVersion || requestedVersionId) return;
    const fallback = versions.data?.items.find((version) => version.status === 'ACTIVE') ?? firstVersion;
    const next = new URLSearchParams(searchParams);
    next.set('version_id', fallback.id);
    setSearchParams(next, { replace: true });
  }, [requestedVersionId, searchParams, setSearchParams, versions.data]);

  const invalidateRules = async (version?: RuleVersionSummary) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.platformProfileVersions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.optionsAll }),
      ...(version ? [
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.detail(version.platform_profile_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfileVersions.impact(version.id) }),
      ] : []),
    ]);
  };

  const create = useMutation({
    mutationFn: async ({ platformProfileId, rules }: { platformProfileId: string; rules: Schema<'PlatformRules'> }) => unwrap(await api.POST('/api/v1/platform-profiles/{platform_profile_id}/versions', {
      params: { path: { platform_profile_id: platformProfileId }, header: csrfHeader() },
      body: { rules },
    })),
    onSuccess: async (created) => {
      setCreateOpen(false);
      updateUrl({ platform_profile_id: created.platform_profile_id, version_id: created.id });
      message.success('规则草稿已创建');
      await invalidateRules();
    },
  });
  const update = useMutation({
    mutationFn: async (rules: Schema<'PlatformRules'>) => {
      if (!editVersion) throw new Error('未选择平台规则草稿');
      return unwrap(await api.PATCH('/api/v1/platform-profile-versions/{platform_profile_version_id}', {
        params: { path: { platform_profile_version_id: editVersion.id }, header: csrfHeader() },
        body: { expected_revision: editVersion.revision, rules },
      }));
    },
    onSuccess: async () => {
      const changed = editVersion;
      setEditVersion(undefined);
      message.success('规则草稿已保存');
      await invalidateRules(changed);
    },
  });
  const command = useMutation({
    mutationFn: async ({ action, version, comment }: { action: CommandAction; version: RuleVersionSummary; comment: string }) => action === 'ACTIVATE'
      ? unwrap(await api.POST('/api/v1/platform-profile-versions/{platform_profile_version_id}/activate', {
        params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() },
        body: { expected_revision: version.revision, comment },
      }))
      : unwrap(await api.POST('/api/v1/platform-profile-versions/{platform_profile_version_id}/retire', {
        params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() },
        body: { expected_revision: version.revision, comment },
      })),
    onSuccess: async (_, variables) => {
      setCommandState(undefined);
      message.success(variables.action === 'ACTIVATE' ? '规则版本已激活' : '规则草稿已退役');
      await invalidateRules(variables.version);
    },
  });
  const remove = useMutation({
    mutationFn: async (version: RuleVersionSummary) => ensureSuccess(await api.DELETE('/api/v1/platform-profile-versions/{platform_profile_version_id}', {
      params: { path: { platform_profile_version_id: version.id }, header: csrfHeader() },
    })),
    onSuccess: async (_, version) => {
      if (requestedVersionId === version.id) updateUrl({ version_id: undefined }, { replace: true });
      message.success('规则版本已删除');
      await invalidateRules(version);
    },
  });

  const openCommand = (action: CommandAction, version: RuleVersionSummary) => {
    setCommandState({ action, version });
  };
  const confirmDelete = (version: RuleVersionSummary) => modal.confirm({
    title: `物理删除规则版本 V${version.version}？`,
    content: version.status === 'ACTIVE'
      ? '删除后所属平台将进入“无有效规则”状态。此操作不可恢复。'
      : '此操作不可恢复。若版本已被内容任务引用，服务端会拒绝删除。',
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => remove.mutateAsync(version),
  });
  const selectProfile = (profileId: string) => {
    updateUrl({ platform_profile_id: profileId, version_id: undefined });
    setMobileStage('VERSIONS');
  };
  const selectVersion = (versionId: string) => {
    updateUrl({ version_id: versionId });
    setMobileStage('DETAIL');
  };
  const submitSearch = (value: string) => {
    updateUrl({ q: value.trim() || undefined, platform_profile_id: undefined, version_id: undefined });
    setMobileStage('PLATFORMS');
  };
  const versionsByProfile = useMemo(() => {
    const counts = new Map<string, number>();
    allVersions.data?.items.forEach((version) => {
      counts.set(version.platform_profile_id, (counts.get(version.platform_profile_id) ?? 0) + 1);
    });
    return counts;
  }, [allVersions.data]);
  const usersById = useMemo(
    () => new Map(users.data?.items.map((user) => [user.id, user.display_name]) ?? []),
    [users.data],
  );
  const actorName = (actorId: string | null): string => {
    if (actorId === null) return '已删除用户';
    if (users.isLoading) return '正在加载用户';
    if (users.error) return '用户信息不可用';
    return usersById.get(actorId) ?? '已删除用户';
  };
  const selectedChangeSummary = selectedVersion
    ? versionChangeSummary(selectedVersion, versionItems)
    : '';
  const profileSelectionError = !!requestedProfileId && !!profiles.data && !selectedProfile;
  const versionSelectionError = !!requestedVersionId && !!versions.data && !selectedVersion;
  const mutationError = create.error ?? update.error ?? command.error;
  const metaPanel = selectedVersion ? (
    <PlatformRuleMetaPanel
      version={selectedVersion}
      creatorName={actorName(selectedVersion.created_by)}
      changeSummary={selectedChangeSummary}
      impact={impact.data}
      impactLoading={impact.isLoading}
      impactError={impact.error}
      retryImpact={() => void impact.refetch()}
      auditItems={audit.data?.items}
      auditLoading={audit.isLoading}
      auditError={audit.error}
      retryAudit={() => void audit.refetch()}
      actorName={actorName}
      onRetire={(version) => openCommand('RETIRE', version)}
      onDelete={confirmDelete}
    />
  ) : null;

  return (
    <div className="page-stack platform-rules-page">
      {modalContext}
      <PageHeader
        eyebrow="平台治理"
        title="平台规则"
        description="维护具体平台的内容规则及不可变规则版本，为内容生成、审核和发布提供唯一依据。"
        actions={<Button type="primary" icon={<PlusOutlined />} aria-haspopup="dialog" aria-expanded={createOpen} onClick={() => setCreateOpen(true)}>创建规则草稿</Button>}
      />
      {mutationError && <Alert role="alert" type="error" showIcon title={errorMessage(mutationError)} />}
      {remove.error && <DeletionError error={remove.error} />}
      {profiles.isLoading ? <QueryLoading label="正在加载平台规则工作台" /> : profiles.error ? (
        <QueryFailure error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : (
        <div className="platform-rules-workspace">
          <section className="platform-rule-platform-pane" hidden={isMobile && mobileStage !== 'PLATFORMS'} aria-label="平台列表">
            <nav className="platform-rule-platform-header" aria-label="平台管理入口"><Link to="/configuration/platforms">平台列表</Link></nav>
            <div className="platform-rule-platform-filters" role="search">
              <PlatformSearch key={queryText} initialValue={queryText} onSearch={submitSearch} />
            </div>
            <div className="platform-rule-platform-list">
              {profileItems.length ? profileItems.map((profile) => (
                <button key={profile.id} type="button" className={profile.id === selectedProfile?.id ? 'is-selected' : ''} aria-current={profile.id === selectedProfile?.id ? 'true' : undefined} onClick={() => selectProfile(profile.id)}>
                  <PlatformAvatar name={profile.name} logo={profile.logo} size={24} />
                  <span><strong>{profile.name}</strong><small>{allVersions.isLoading ? '正在统计版本' : allVersions.error ? '版本数不可用' : `${versionsByProfile.get(profile.id) ?? 0} 个版本`}</small></span>
                </button>
              )) : <NoData description="当前筛选下暂无平台" />}
            </div>
          </section>

          <section className="platform-rule-version-pane" hidden={isMobile && mobileStage !== 'VERSIONS'} aria-label="规则版本列表">
            <header>
              {isMobile && <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setMobileStage('PLATFORMS')}>平台</Button>}
              <strong>规则版本</strong>
              <Button type="text" icon={<PlusOutlined />} disabled={!selectedProfile} aria-label="为当前平台创建规则草稿" onClick={() => setCreateOpen(true)}>创建草稿</Button>
            </header>
            {profileSelectionError ? <Alert type="error" showIcon title="URL 中的平台不在当前筛选结果内，请重新选择平台。" /> : versions.isLoading ? <QueryLoading label="正在加载规则版本" /> : versions.error ? <QueryFailure error={versions.error} onRetry={() => void versions.refetch()} /> : versionItems.length ? (
              <div className="platform-rule-version-list">
                {versionItems.map((version) => (
                  <button key={version.id} type="button" className={version.id === selectedVersion?.id ? 'is-selected' : ''} aria-current={version.id === selectedVersion?.id ? 'true' : undefined} onClick={() => selectVersion(version.id)}>
                    <span className="platform-rule-version-title"><strong>V{version.version}</strong><StatusTag status={version.status} /></span>
                    <span className="platform-rule-version-meta"><small>{actorName(version.created_by)}</small><time dateTime={version.created_at}>{versionDateFormatter.format(new Date(version.created_at))}</time></span>
                    <span className="platform-rule-version-summary">{versionChangeSummary(version, versionItems)}</span>
                    <small>被 {version.reference_count} 个内容任务引用</small>
                  </button>
                ))}
              </div>
            ) : <NoData description={selectedProfile ? '该平台暂无规则版本' : '请先选择平台'} />}
            <footer>共 {versionItems.length} 个版本</footer>
          </section>

          <main className="platform-rule-main-pane" hidden={isMobile && mobileStage !== 'DETAIL'}>
            {isMobile && <Button className="platform-rule-mobile-back" type="text" icon={<ArrowLeftOutlined />} onClick={() => setMobileStage('VERSIONS')}>规则版本</Button>}
            {versionSelectionError ? <Alert type="error" showIcon title="URL 中的规则版本不存在或不属于当前平台，请重新选择版本。" /> : selectedProfile && selectedVersion ? (
              <>
                {!screens.xl && <Button className="platform-rule-meta-trigger" icon={<InfoCircleOutlined />} onClick={() => setMetaOpen(true)}>版本信息与影响</Button>}
                <PlatformRuleDetail
                  platformName={selectedProfile.name}
                  version={selectedVersion}
                  versions={versionItems}
                  onEdit={setEditVersion}
                  onActivate={(version) => openCommand('ACTIVATE', version)}
                  onRetire={(version) => openCommand('RETIRE', version)}
                  onDelete={confirmDelete}
                />
              </>
            ) : <NoData description="请选择规则版本查看详情" />}
          </main>
          {screens.xl && metaPanel}
        </div>
      )}

      <Drawer className="platform-rule-meta-drawer" title={selectedVersion ? `版本 V${selectedVersion.version} 信息` : '版本信息'} open={metaOpen && !screens.xl} onClose={() => setMetaOpen(false)} size="min(100vw, 420px)" destroyOnHidden>{metaPanel}</Drawer>
      <Modal title="新增规则草稿" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={760} destroyOnHidden>
        <RuleEditor profiles={profileItems} initialPlatformId={selectedProfile?.id} loading={create.isPending} submitLabel="创建草稿版本" onSubmit={(rules, platformProfileId) => platformProfileId && create.mutate({ platformProfileId, rules })} />
      </Modal>
      <Modal title={`编辑 ${selectedProfile?.name ?? ''} V${editVersion?.version ?? ''} 草稿`} open={!!editVersion} onCancel={() => setEditVersion(undefined)} footer={null} width={760} destroyOnHidden>
        {editVersion && <RuleEditor initial={editVersion.rules} loading={update.isPending} submitLabel="保存草稿" onSubmit={(rules) => update.mutate(rules)} />}
      </Modal>
      <Modal title={commandState?.action === 'ACTIVATE' ? `激活 V${commandState.version.version}` : `退役 V${commandState?.version.version ?? ''} 草稿`} open={!!commandState} onCancel={() => setCommandState(undefined)} footer={null} destroyOnHidden>
        {commandState && <Form<{ comment: string }> key={`${commandState.action}-${commandState.version.id}`} layout="vertical" onFinish={({ comment }) => command.mutate({ ...commandState, comment: comment.trim() })}>
          <Alert type="info" showIcon title={commandState.action === 'ACTIVATE' ? '激活后，当前 ACTIVE 版本会在同一事务中自动退役；新版本正文将冻结。' : '直接退役仅适用于从未激活的 DRAFT 草稿。'} />
          <Form.Item name="comment" label="操作说明" rules={[{ required: true, whitespace: true, message: '请填写操作说明' }]}><Input.TextArea autoFocus rows={4} maxLength={500} showCount /></Form.Item>
          <Button type="primary" htmlType="submit" loading={command.isPending}>{commandState.action === 'ACTIVATE' ? '确认激活' : '确认退役'}</Button>
        </Form>}
      </Modal>
    </div>
  );
}

function RuleEditor({
  profiles,
  initialPlatformId,
  initial,
  loading,
  submitLabel,
  onSubmit,
}: {
  profiles?: PlatformProfile[];
  initialPlatformId?: string;
  initial?: Schema<'PlatformRules'>;
  loading: boolean;
  submitLabel: string;
  onSubmit: (rules: Schema<'PlatformRules'>, platformProfileId?: string) => void;
}) {
  return (
    <Form<{ platform_profile_id?: string; rules: Schema<'PlatformRules'> }>
      layout="vertical"
      initialValues={{ platform_profile_id: initialPlatformId, rules: initial ?? emptyRules }}
      scrollToFirstError
      onFinish={({ rules, platform_profile_id: platformProfileId }) => onSubmit(rules, platformProfileId)}
    >
      {profiles && <Form.Item name="platform_profile_id" label="所属平台" rules={[{ required: true, message: '请选择所属平台' }]}><Select showSearch optionFilterProp="label" options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} /></Form.Item>}
      <RulesFields />
      <Button type="primary" htmlType="submit" loading={loading}>{submitLabel}</Button>
    </Form>
  );
}

function PlatformSearch({
  initialValue,
  onSearch,
}: {
  initialValue: string;
  onSearch: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Input.Search
      aria-label="搜索平台名称"
      allowClear
      value={value}
      prefix={<SearchOutlined />}
      placeholder="搜索平台名称"
      onChange={(event) => setValue(event.target.value)}
      onSearch={onSearch}
    />
  );
}

function RulesFields() {
  return (
    <>
      <div className="platform-rule-form-grid">
        <Form.Item name={['rules', 'target_audience']} label="目标受众" rules={[{ required: true, whitespace: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name={['rules', 'tone']} label="语气" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name={['rules', 'title_min']} label="标题最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
        <Form.Item name={['rules', 'title_max']} label="标题最长" dependencies={[["rules", "title_min"]]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value >= getFieldValue(['rules', 'title_min']) ? Promise.resolve() : Promise.reject(new Error('标题最长不能小于最短值')) })]}><InputNumber min={1} /></Form.Item>
        <Form.Item name={['rules', 'body_min']} label="正文最短" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
        <Form.Item name={['rules', 'body_max']} label="正文最长" dependencies={[["rules", "body_min"]]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => !value || value >= getFieldValue(['rules', 'body_min']) ? Promise.resolve() : Promise.reject(new Error('正文最长不能小于最短值')) })]}><InputNumber min={1} /></Form.Item>
      </div>
      <Space wrap>
        <Form.Item name={['rules', 'allow_external_links']} valuePropName="checked"><Checkbox>允许外链</Checkbox></Form.Item>
        <Form.Item name={['rules', 'allow_tables']} valuePropName="checked"><Checkbox>允许表格</Checkbox></Form.Item>
        <Form.Item name={['rules', 'allow_contact']} valuePropName="checked"><Checkbox>允许联系方式</Checkbox></Form.Item>
      </Space>
      <Form.Item name={['rules', 'prohibited_phrases']} label="禁用表达"><Select mode="tags" tokenSeparators={['，', ',']} /></Form.Item>
      <Form.List name={['rules', 'sections']}>
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...field }) => (
              <Space key={key} align="start" className="platform-rule-section-field">
                <Form.Item {...field} name={[name, 'name']} label="栏目名称" rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item {...field} name={[name, 'url']} label="栏目 URL" rules={[{ required: true, type: 'url' }]}><Input type="url" /></Form.Item>
                <Button danger onClick={() => remove(name)}>删除</Button>
              </Space>
            ))}
            <Button onClick={() => add()} icon={<PlusOutlined />}>添加栏目</Button>
          </>
        )}
      </Form.List>
    </>
  );
}
