/** 在同一工作台维护具体平台与全局自然化 Prompt 的唯一 Markdown 正文。 */
import { InfoCircleOutlined, SearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Card, Input, Pagination, Select, Space, Tabs } from 'antd';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { ApiError, api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import {
  platformProfileQueryOptions,
  platformProfilesQueryOptions,
  platformTypesQueryOptions,
} from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { PlatformProfileListQuery } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { PromptMarkdownEditor, type PromptSaveState } from './PromptMarkdownEditor';
import { PromptOutputPreview } from './PromptOutputPreview';

type PromptTab = 'platform' | 'humanization';

type SaveVariables = {
  identity: string;
  mode: PromptTab;
  platformProfileId?: string;
  templateMarkdown: string;
  expectedRevision: number | null;
};

type EditorState = {
  identity: string;
  baseline: string;
  draft: string;
  saveState: PromptSaveState;
  locallyDeleted: boolean;
};

const PAGE_SIZE = 10;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NOT_FOUND';
}

function formatTime(value: string | null | undefined): string {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value)) : '尚未配置';
}

export function PlatformPromptsPage() {
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: PromptTab = rawTab === 'humanization' ? 'humanization' : 'platform';
  const q = searchParams.get('q') ?? '';
  const deferredQ = useDeferredValue(q);
  const platformTypeId = searchParams.get('platform_type_id') ?? undefined;
  const page = positiveInteger(searchParams.get('page'), 1);
  const selectedId = searchParams.get('platform_profile_id') ?? undefined;
  const identity = tab === 'platform' ? `platform:${selectedId ?? ''}` : 'humanization';
  const [storedEditor, setStoredEditor] = useState<EditorState>({ identity: '', baseline: '', draft: '', saveState: 'idle', locallyDeleted: false });

  const platformQuery = useMemo<PlatformProfileListQuery>(() => ({
    page,
    page_size: PAGE_SIZE,
    ...(deferredQ ? { q: deferredQ } : {}),
    ...(platformTypeId ? { platform_type_id: platformTypeId } : {}),
  }), [deferredQ, page, platformTypeId]);
  const platforms = useQuery({ ...platformProfilesQueryOptions(platformQuery), enabled: tab === 'platform' });
  const platformTypes = useQuery({ ...platformTypesQueryOptions(), enabled: tab === 'platform' });
  const selectedProfile = useQuery({
    ...platformProfileQueryOptions(selectedId),
    enabled: tab === 'platform' && !!selectedId,
  });
  const prompt = useQuery({
    queryKey: queryKeys.platformProfiles.prompt(selectedId),
    queryFn: async () => unwrap(await api.GET('/api/v1/platform-profiles/{platform_profile_id}/prompt', {
      params: { path: { platform_profile_id: selectedId! } },
    })),
    enabled: tab === 'platform' && !!selectedId,
    staleTime: QUERY_STALE_TIME.configuration,
    retry: false,
  });
  const humanizationPrompt = useQuery({
    queryKey: queryKeys.contentHumanizationPrompt,
    queryFn: async () => {
      const result = await api.GET('/api/v1/content-humanization-prompt');
      if (result.response.status !== 204) return unwrap(result);
      // openapi-fetch 对 204 提前返回；显式消费空响应，避免 Chromium 将未读取的 fetch 记为 ERR_ABORTED。
      await result.response.text();
      return null;
    },
    enabled: tab === 'humanization',
    staleTime: QUERY_STALE_TIME.configuration,
    retry: false,
  });
  const users = useQuery({
    queryKey: queryKeys.users.list({ page: 1, page_size: 100 }),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', { params: { query: { page: 1, page_size: 100 } } })),
    staleTime: QUERY_STALE_TIME.configuration,
  });
  const userNames = useMemo(
    () => new Map(users.data?.items.map((user) => [user.id, user.display_name])),
    [users.data?.items],
  );
  const promptMissing = isNotFound(prompt.error);
  const humanizationMissing = humanizationPrompt.data === null;
  const remotePrompt = tab === 'platform' ? prompt.data : humanizationPrompt.data;
  const storedForIdentity = storedEditor.identity === identity ? storedEditor : undefined;
  const locallyDeleted = storedForIdentity?.locallyDeleted ?? false;
  const activePrompt = tab === 'platform' && locallyDeleted ? undefined : remotePrompt;
  const activeMissing = tab === 'platform' ? locallyDeleted || promptMissing : humanizationMissing;
  const promptLoading = tab === 'platform' ? prompt.isLoading : humanizationPrompt.isLoading;
  const promptError = tab === 'platform' ? prompt.error : humanizationPrompt.error;
  const remoteValue = activePrompt?.template_markdown ?? '';
  const editor = storedForIdentity ?? { identity, baseline: remoteValue, draft: remoteValue, saveState: 'idle' as const, locallyDeleted: false };
  const { baseline, draft, saveState } = editor;
  const dirty = draft !== baseline;

  const updateSearchParams = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };
  const confirmDiscard = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    modal.confirm({
      title: '放弃未保存的 Prompt 修改？',
      content: '离开后本地草稿不会被保存。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setStoredEditor({ identity: '', baseline: '', draft: '', saveState: 'idle', locallyDeleted: false });
        action();
      },
    });
  };

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (rawTab && rawTab !== 'platform' && rawTab !== 'humanization') {
      next.set('tab', 'platform');
      changed = true;
    }
    if (searchParams.get('page') !== String(page)) {
      next.set('page', String(page));
      changed = true;
    }
    if (searchParams.get('page_size') !== String(PAGE_SIZE)) {
      next.set('page_size', String(PAGE_SIZE));
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [page, rawTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (tab !== 'platform' || selectedId || !platforms.data?.items.length) return;
    const next = new URLSearchParams(searchParams);
    next.set('platform_profile_id', platforms.data.items[0]!.id);
    setSearchParams(next, { replace: true });
  }, [platforms.data, searchParams, selectedId, setSearchParams, tab]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const protectRouteLinks = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank') return;
      const target = new URL(anchor.href, window.location.href);
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
      event.preventDefault();
      modal.confirm({
        title: '放弃未保存的 Prompt 修改？',
        content: '确认后将离开当前页面，本地草稿不会被保存。',
        okText: '放弃并离开',
        cancelText: '继续编辑',
        okButtonProps: { danger: true },
        onOk: () => window.location.assign(target.href),
      });
    };
    document.addEventListener('click', protectRouteLinks, true);
    return () => document.removeEventListener('click', protectRouteLinks, true);
  }, [dirty, modal]);

  const savePrompt = useMutation({
    mutationFn: async (variables: SaveVariables) => {
      if (variables.mode === 'humanization') {
        return unwrap(await api.PUT('/api/v1/content-humanization-prompt', {
          params: { header: csrfHeader() },
          body: {
            template_markdown: variables.templateMarkdown,
            expected_revision: variables.expectedRevision,
          },
        }));
      }
      if (!variables.platformProfileId) throw new Error('未选择平台');
      return unwrap(await api.PUT('/api/v1/platform-profiles/{platform_profile_id}/prompt', {
        params: {
          path: { platform_profile_id: variables.platformProfileId },
          header: csrfHeader(),
        },
        body: {
          template_markdown: variables.templateMarkdown,
          expected_revision: variables.expectedRevision,
        },
      }));
    },
    onSuccess: async (saved, variables) => {
      if (variables.mode === 'humanization') {
        queryClient.setQueryData(queryKeys.contentHumanizationPrompt, saved);
      } else {
        queryClient.setQueryData(queryKeys.platformProfiles.prompt(variables.platformProfileId), saved);
      }
      if (variables.identity === identity) {
        setStoredEditor({
          identity,
          baseline: saved.template_markdown,
          draft: saved.template_markdown,
          saveState: 'saved',
          locallyDeleted: false,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.optionsAll }),
      ]);
      message.success('Prompt 已保存');
    },
    onError: (error) => setStoredEditor({
      ...editor,
      saveState: error instanceof ApiError && error.code === 'REVISION_CONFLICT' ? 'conflict' : 'error',
    }),
  });
  const removePrompt = useMutation({
    mutationFn: async () => {
      if (!selectedId || !activePrompt) throw new Error('当前平台 Prompt 未加载');
      ensureSuccess(await api.DELETE('/api/v1/platform-profiles/{platform_profile_id}/prompt', {
        params: {
          path: { platform_profile_id: selectedId },
          query: { expected_revision: activePrompt.revision },
          header: csrfHeader(),
        },
      }));
    },
    onSuccess: async () => {
      setStoredEditor({ identity, baseline: '', draft: '', saveState: 'idle', locallyDeleted: true });
      message.success('Prompt 已删除，平台仍保留');
      await Promise.all([
        prompt.refetch(),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
      ]);
    },
    onError: (error) => setStoredEditor({
      ...editor,
      saveState: error instanceof ApiError && error.code === 'REVISION_CONFLICT' ? 'conflict' : 'error',
    }),
  });

  const reloadCurrent = async () => {
    const result = tab === 'platform' ? await prompt.refetch() : await humanizationPrompt.refetch();
    if (result.error && (tab === 'humanization' || !isNotFound(result.error))) return;
    const currentValue = result.data?.template_markdown ?? '';
    setStoredEditor({ identity, baseline: currentValue, draft: currentValue, saveState: 'idle', locallyDeleted: false });
  };
  const submitCurrent = () => {
    setStoredEditor({ ...editor, saveState: 'saving' });
    savePrompt.mutate({
      identity,
      mode: tab,
      platformProfileId: selectedId,
      templateMarkdown: draft,
      expectedRevision: activePrompt?.revision ?? null,
    });
  };
  const handleDraftChange = (value: string) => {
    setStoredEditor({ ...editor, draft: value, saveState: value === baseline ? 'idle' : 'dirty' });
  };
  const changeTab = (nextTab: string) => confirmDiscard(() => updateSearchParams((next) => {
    next.set('tab', nextTab);
    if (nextTab === 'humanization') next.delete('platform_profile_id');
  }));
  const selectPlatform = (platformProfileId: string) => confirmDiscard(() => updateSearchParams((next) => {
    next.set('platform_profile_id', platformProfileId);
  }));
  const selected = selectedProfile.data?.profile;
  const selectedInPage = platforms.data?.items.some((platform) => platform.id === selectedId) ?? false;
  const outputLength = '由 Prompt 定义';
  const updatedBy = activePrompt?.updated_by ? userNames.get(activePrompt.updated_by) ?? activePrompt.updated_by.slice(0, 8) : '尚未配置';
  const editorUnavailable = tab === 'platform' && !selectedId;

  return <div className="page-stack prompt-management-page">
    <PageHeader
      eyebrow="配置中心 / Prompt 管理"
      title="Prompt 管理"
      description="平台 Prompt 会原样作为内容生成的 system message；全局自然化 Prompt 只用于自然化作业。"
    />
    <div className="prompt-management-topline">
      <Tabs
        activeKey={tab}
        onChange={changeTab}
        items={[
          { key: 'platform', label: '平台 Prompt' },
          { key: 'humanization', label: '全局自然化 Prompt' },
        ]}
      />
      <Alert
        id="prompt-safety-summary"
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        title="安全、输出格式、受众、角度和长度要求都由 Prompt 定义；删除平台 Prompt 后，新 AI 生成会直接失败。"
        action={<a href="#prompt-safety-boundaries">查看生成边界 →</a>}
      />
    </div>
    <div className={`prompt-management-workspace${tab === 'humanization' ? ' is-humanization' : ''}`}>
      {tab === 'platform' && <Card title="平台列表" className="prompt-platform-panel" size="small">
        <div className="prompt-platform-filters">
          <Input
            aria-label="搜索平台名称"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索平台名称"
            value={q}
            onChange={(event) => updateSearchParams((next) => {
              if (event.target.value) next.set('q', event.target.value); else next.delete('q');
              next.set('page', '1');
            }, true)}
          />
          <Select
            aria-label="筛选平台类型"
            allowClear
            placeholder="全部类型"
            loading={platformTypes.isLoading}
            value={platformTypeId}
            options={platformTypes.data?.items.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => updateSearchParams((next) => {
              if (value) next.set('platform_type_id', value); else next.delete('platform_type_id');
              next.set('page', '1');
            })}
          />
        </div>
        {platforms.isLoading ? <QueryLoading label="正在加载平台" /> : platforms.error ? <QueryFailure error={platforms.error} onRetry={() => void platforms.refetch()} /> : platforms.data?.items.length ? <>
          {selectedId && !selectedInPage && <Alert type="warning" showIcon title="当前平台不在本页筛选结果中，编辑区仍保留该 URL 指向的平台。" />}
          <div className="prompt-platform-list" role="listbox" aria-label="Prompt 平台列表">
            {platforms.data.items.map((platform) => <button
              key={platform.id}
              type="button"
              role="option"
              aria-selected={platform.id === selectedId}
              className={platform.id === selectedId ? 'is-selected' : ''}
              onClick={() => selectPlatform(platform.id)}
            >
              <PlatformAvatar name={platform.name} logo={platform.logo} size={24} />
              <span className="prompt-platform-copy">
                <strong>{platform.name}</strong>
                <small>{platform.platform_type?.name ?? '未归类'}</small>
              </span>
              <span className="prompt-platform-status">
                <b className={platform.prompt_configured ? 'is-configured' : 'is-missing'}>{platform.prompt_configured ? '已配置' : '未配置'}</b>
                <time>{formatTime(platform.prompt_updated_at)}</time>
              </span>
            </button>)}
          </div>
          <Pagination
            size="small"
            current={platforms.data.page}
            pageSize={PAGE_SIZE}
            total={platforms.data.total}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 个平台`}
            onChange={(nextPage) => updateSearchParams((next) => next.set('page', String(nextPage)))}
          />
        </> : <NoData description="当前筛选没有平台" />}
      </Card>}
      <Card className="prompt-editor-panel" size="small" title={tab === 'platform'
        ? selected ? `当前平台：${selected.name}` : '选择平台后编辑 Prompt'
        : '全局自然化 Prompt'}
        extra={activePrompt && <Space size={10} wrap className="prompt-editor-meta">
          <span>更新：{formatTime(activePrompt.updated_at)}</span>
          <span>更新人：{updatedBy}</span>
          <b>revision {activePrompt.revision}</b>
        </Space>}
      >
        {editorUnavailable ? <NoData description="请从平台列表选择一个平台" />
          : selectedProfile.error && tab === 'platform' ? <QueryFailure error={selectedProfile.error} onRetry={() => void selectedProfile.refetch()} />
            : promptLoading ? <QueryLoading label="正在加载 Prompt" />
              : promptError && !activeMissing ? <QueryFailure error={promptError} onRetry={() => void reloadCurrent()} />
                : <PromptMarkdownEditor
                  value={draft}
                  ariaLabel={tab === 'platform' ? 'Prompt Markdown' : '自然化 Prompt Markdown'}
                  configured={!!activePrompt}
                  disabled={savePrompt.isPending || removePrompt.isPending}
                  saveState={saveState}
                  error={savePrompt.error ?? removePrompt.error}
                  outputLength={outputLength}
                  canDelete={tab === 'platform' && !!activePrompt}
                  deleting={removePrompt.isPending}
                  onChange={handleDraftChange}
                  onSave={submitCurrent}
                  onDelete={() => removePrompt.mutate()}
                  onReload={() => void reloadCurrent()}
                />}
      </Card>
      <aside className="prompt-management-side">
        <PromptOutputPreview
          mode={tab}
          platformProfileId={selectedId}
          dirty={dirty}
          promptConfigured={!!activePrompt}
        />
        <Card id="prompt-safety-boundaries" title="生成边界" size="small" className="prompt-safety-panel">
          <ul>
            <li><SafetyCertificateOutlined /><span><strong>消息原样发送</strong><small>system 为平台 Prompt，user 为已批准事实 Markdown。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>要求集中维护</strong><small>安全、输出、受众、角度和长度规则都需写入平台 Prompt。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>错误直接失败</strong><small>Prompt 缺失或响应不符合严格文章 JSON 时不会创建内容版本。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>AI 只创建草稿</strong><small>输出必须通过人工审核后才能进入发布流程。</small></span></li>
          </ul>
        </Card>
      </aside>
    </div>
    {(savePrompt.error || removePrompt.error) && saveState !== 'conflict' && <Alert role="alert" type="error" showIcon title={errorMessage(savePrompt.error ?? removePrompt.error)} />}
  </div>;
}
