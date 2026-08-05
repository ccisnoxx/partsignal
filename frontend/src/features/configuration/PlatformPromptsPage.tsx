/** 在同一工作台维护可复用平台 Prompt 模板与全局自然化 Prompt。 */
import {
  FileTextOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Input, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { ApiError, api, csrfHeader, ensureSuccess, errorMessage, unwrap } from '../../shared/api/client';
import {
  platformPromptQueryOptions,
  platformPromptsQueryOptions,
} from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PageHeader } from '../../shared/components/PageHeader';
import { PromptMarkdownEditor, type PromptSaveState } from './PromptMarkdownEditor';
import { PromptOutputPreview } from './PromptOutputPreview';

type PromptTab = 'platform' | 'humanization';

type EditorState = {
  identity: string;
  baselineName: string;
  name: string;
  baseline: string;
  draft: string;
  saveState: PromptSaveState;
};

type SaveVariables = {
  identity: string;
  mode: PromptTab;
  promptId?: string;
  name: string;
  templateMarkdown: string;
  expectedRevision: number | null;
};

const emptyEditor: EditorState = {
  identity: '',
  baselineName: '',
  name: '',
  baseline: '',
  draft: '',
  saveState: 'idle',
};

function formatTime(value: string | null | undefined): string {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value)) : '尚未配置';
}

export function PlatformPromptsPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: PromptTab = searchParams.get('tab') === 'humanization' ? 'humanization' : 'platform';
  const selectedId = searchParams.get('platform_prompt_id') ?? undefined;
  const creating = tab === 'platform' && searchParams.get('new') === '1';
  const identity = tab === 'humanization'
    ? 'humanization'
    : creating ? 'platform:new' : `platform:${selectedId ?? ''}`;
  const [storedEditor, setStoredEditor] = useState<EditorState>(emptyEditor);
  const [query, setQuery] = useState('');

  const prompts = useQuery({
    ...platformPromptsQueryOptions(),
    enabled: tab === 'platform',
  });
  const prompt = useQuery({
    ...platformPromptQueryOptions(selectedId),
    enabled: tab === 'platform' && !creating && !!selectedId,
  });
  const humanizationPrompt = useQuery({
    queryKey: queryKeys.contentHumanizationPrompt,
    queryFn: async () => {
      const result = await api.GET('/api/v1/content-humanization-prompt');
      if (result.response.status !== 204) return unwrap(result);
      await result.response.text();
      return null;
    },
    enabled: tab === 'humanization',
    staleTime: QUERY_STALE_TIME.configuration,
    retry: false,
  });
  const users = useQuery({
    queryKey: queryKeys.users.list({ page: 1, page_size: 100 }),
    queryFn: async () => unwrap(await api.GET('/api/v1/users', {
      params: { query: { page: 1, page_size: 100 } },
    })),
    staleTime: QUERY_STALE_TIME.configuration,
  });

  const remoteName = tab === 'platform' ? prompt.data?.name ?? '' : '';
  const remoteValue = tab === 'platform'
    ? prompt.data?.template_markdown ?? ''
    : humanizationPrompt.data?.template_markdown ?? '';
  const remoteRevision = tab === 'platform'
    ? prompt.data?.revision
    : humanizationPrompt.data?.revision;
  const remoteUpdatedAt = tab === 'platform'
    ? prompt.data?.updated_at
    : humanizationPrompt.data?.updated_at;
  const remoteUpdatedBy = tab === 'platform'
    ? prompt.data?.updated_by
    : humanizationPrompt.data?.updated_by;
  const configured = tab === 'platform' ? !!prompt.data : !!humanizationPrompt.data;
  const editor = storedEditor.identity === identity ? storedEditor : {
    identity,
    baselineName: remoteName,
    name: remoteName,
    baseline: remoteValue,
    draft: remoteValue,
    saveState: 'idle' as const,
  };
  const dirty = editor.name !== editor.baselineName || editor.draft !== editor.baseline;
  const userNames = useMemo(
    () => new Map(users.data?.items.map((user) => [user.id, user.display_name])),
    [users.data?.items],
  );
  const filteredPrompts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return (prompts.data?.items ?? []).filter(
      (item) => !normalized || item.name.toLocaleLowerCase('zh-CN').includes(normalized),
    );
  }, [prompts.data?.items, query]);

  const setView = (updates: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value); else next.delete(key);
    }
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
        setStoredEditor(emptyEditor);
        action();
      },
    });
  };

  useEffect(() => {
    if (tab !== 'platform' || creating || selectedId || !prompts.data?.items.length) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('platform_prompt_id', prompts.data.items[0]!.id);
      return next;
    }, { replace: true });
  }, [creating, prompts.data?.items, selectedId, setSearchParams, tab]);

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
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
      event.preventDefault();
      modal.confirm({
        title: '放弃未保存的 Prompt 修改？',
        content: '确认后将离开当前页面，本地草稿不会被保存。',
        okText: '放弃并离开',
        cancelText: '继续编辑',
        okButtonProps: { danger: true },
        onOk: () => {
          setStoredEditor(emptyEditor);
          navigate(`${target.pathname}${target.search}${target.hash}`);
        },
      });
    };
    document.addEventListener('click', protectRouteLinks, true);
    return () => document.removeEventListener('click', protectRouteLinks, true);
  }, [dirty, modal, navigate]);

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
      if (variables.promptId) {
        return unwrap(await api.PUT('/api/v1/platform-prompts/{platform_prompt_id}', {
          params: {
            path: { platform_prompt_id: variables.promptId },
            header: csrfHeader(),
          },
          body: {
            name: variables.name,
            template_markdown: variables.templateMarkdown,
            expected_revision: variables.expectedRevision!,
          },
        }));
      }
      return unwrap(await api.POST('/api/v1/platform-prompts', {
        params: { header: csrfHeader() },
        body: {
          name: variables.name,
          template_markdown: variables.templateMarkdown,
        },
      }));
    },
    onSuccess: async (saved, variables) => {
      if (variables.mode === 'humanization') {
        queryClient.setQueryData(queryKeys.contentHumanizationPrompt, saved);
        setStoredEditor({
          identity: 'humanization',
          baselineName: '',
          name: '',
          baseline: saved.template_markdown,
          draft: saved.template_markdown,
          saveState: 'saved',
        });
      } else {
        const platformSaved = saved as Schema<'PlatformPromptDetail'>;
        queryClient.setQueryData(queryKeys.platformPrompts.detail(platformSaved.id), platformSaved);
        setStoredEditor({
          identity: `platform:${platformSaved.id}`,
          baselineName: platformSaved.name,
          name: platformSaved.name,
          baseline: platformSaved.template_markdown,
          draft: platformSaved.template_markdown,
          saveState: 'saved',
        });
        setView({ platform_prompt_id: platformSaved.id, new: undefined }, true);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.platformPrompts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.optionsAll }),
      ]);
      message.success('Prompt 已保存');
    },
    onError: (error) => setStoredEditor({
      ...editor,
      saveState: error instanceof ApiError && error.code === 'REVISION_CONFLICT'
        ? 'conflict'
        : 'error',
    }),
  });
  const removePrompt = useMutation({
    mutationFn: async () => {
      const currentPrompt = prompt.data;
      if (!currentPrompt) throw new Error('当前 Prompt 未加载');
      ensureSuccess(await api.DELETE('/api/v1/platform-prompts/{platform_prompt_id}', {
        params: {
          path: { platform_prompt_id: currentPrompt.id },
          query: { expected_revision: currentPrompt.revision },
          header: csrfHeader(),
        },
      }));
      return currentPrompt.id;
    },
    onSuccess: async (removedId) => {
      queryClient.setQueryData<Schema<'PlatformPromptList'>>(
        queryKeys.platformPrompts.all,
        (current) => current
          ? { ...current, items: current.items.filter((item) => item.id !== removedId) }
          : current,
      );
      setStoredEditor(emptyEditor);
      setView({ platform_prompt_id: undefined }, true);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.platformPrompts.detail(removedId),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformPrompts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
        queryClient.invalidateQueries({ queryKey: ['platform-profile'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.optionsAll }),
      ]);
      message.success('Prompt 已删除，关联平台已自动解绑');
    },
  });

  const mutateEditor = (updates: Partial<EditorState>) => {
    const next = { ...editor, ...updates };
    setStoredEditor({
      ...next,
      saveState: next.name === next.baselineName && next.draft === next.baseline
        ? 'idle'
        : 'dirty',
    });
  };
  const reloadCurrent = async () => {
    if (creating) {
      setStoredEditor({ ...emptyEditor, identity: 'platform:new' });
      return;
    }
    const result = tab === 'platform'
      ? await prompt.refetch()
      : await humanizationPrompt.refetch();
    if (result.error) return;
    const currentName = tab === 'platform'
      ? (result.data as Schema<'PlatformPromptDetail'> | undefined)?.name ?? ''
      : '';
    const currentValue = result.data?.template_markdown ?? '';
    setStoredEditor({
      identity,
      baselineName: currentName,
      name: currentName,
      baseline: currentValue,
      draft: currentValue,
      saveState: 'idle',
    });
  };
  const performSave = () => {
    setStoredEditor({ ...editor, saveState: 'saving' });
    savePrompt.mutate({
      identity,
      mode: tab,
      promptId: selectedId,
      name: editor.name,
      templateMarkdown: editor.draft,
      expectedRevision: remoteRevision ?? null,
    });
  };
  const submitCurrent = () => {
    if (tab === 'platform' && !editor.name.trim()) return;
    const boundPlatforms = prompt.data?.bound_platforms ?? [];
    if (tab !== 'platform' || creating || boundPlatforms.length === 0) {
      performSave();
      return;
    }
    modal.confirm({
      title: `更新将影响 ${boundPlatforms.length} 个平台`,
      content: <Space wrap>{boundPlatforms.map((platform) => <Tag key={platform.id}>{platform.name}</Tag>)}</Space>,
      okText: '确认更新',
      cancelText: '取消',
      onOk: performSave,
    });
  };
  const changeTab = (nextTab: string) => confirmDiscard(() => {
    setStoredEditor(emptyEditor);
    setView({
      tab: nextTab,
      platform_prompt_id: undefined,
      new: undefined,
    });
  });
  const selectPrompt = (promptId: string) => confirmDiscard(() => {
    setStoredEditor(emptyEditor);
    setView({ platform_prompt_id: promptId, new: undefined });
  });
  const startCreate = () => confirmDiscard(() => {
    setStoredEditor({ ...emptyEditor, identity: 'platform:new' });
    setView({ platform_prompt_id: undefined, new: '1' });
  });

  const loading = tab === 'platform' ? prompt.isLoading : humanizationPrompt.isLoading;
  const error = tab === 'platform' ? prompt.error : humanizationPrompt.error;
  const updatedBy = remoteUpdatedBy
    ? userNames.get(remoteUpdatedBy) ?? remoteUpdatedBy.slice(0, 8)
    : '尚未配置';
  const platformPreviewId = prompt.data?.bound_platforms[0]?.id;
  const canSaveCurrent = creating
    || (tab === 'platform'
      ? !!prompt.data?.available_actions.includes('UPDATE')
      : !humanizationPrompt.data || humanizationPrompt.data.available_actions.includes('UPDATE'));

  return <div className="page-stack prompt-management-page">
    <PageHeader
      eyebrow="配置中心 / Prompt 管理"
      title="Prompt 管理"
      description="平台 Prompt 可被多个平台复用；平台当前绑定决定新 AI 生成使用哪一份模板。"
      actions={tab === 'platform' && <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>新建 Prompt</Button>}
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
        title="共享 Prompt 修改会影响全部绑定平台；历史生成快照保持不变。"
        action={<a href="#prompt-safety-boundaries">查看生成边界 →</a>}
      />
    </div>
    <div className={`prompt-management-workspace${tab === 'humanization' ? ' is-humanization' : ''}`}>
      {tab === 'platform' && <Card title="Prompt 模板" className="prompt-platform-panel" size="small">
        <div className="prompt-platform-filters">
          <Input
            aria-label="搜索 Prompt 名称"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 Prompt 名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button icon={<PlusOutlined />} onClick={startCreate}>新建</Button>
        </div>
        {prompts.isLoading ? <QueryLoading label="正在加载 Prompt" />
          : prompts.error ? <QueryFailure error={prompts.error} onRetry={() => void prompts.refetch()} />
            : filteredPrompts.length ? <div className="prompt-platform-list" role="listbox" aria-label="Prompt 模板列表">
              {filteredPrompts.map((item) => <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === selectedId}
                className={item.id === selectedId ? 'is-selected' : ''}
                onClick={() => selectPrompt(item.id)}
              >
                <FileTextOutlined />
                <span className="prompt-platform-copy">
                  <strong>{item.name}</strong>
                  <small>revision {item.revision}</small>
                </span>
                <span className="prompt-platform-status">
                  <b className={item.bound_platform_count ? 'is-configured' : 'is-missing'}>
                    {item.bound_platform_count} 个平台
                  </b>
                  <time>{formatTime(item.updated_at)}</time>
                </span>
              </button>)}
            </div> : <NoData description={query ? '没有匹配的 Prompt' : '暂无 Prompt 模板'} />}
      </Card>}
      <Card
        className="prompt-editor-panel"
        size="small"
        title={tab === 'humanization'
          ? '全局自然化 Prompt'
          : creating ? '新建 Prompt' : prompt.data?.name ?? '选择 Prompt 后编辑'}
        extra={configured && <Space size={10} wrap className="prompt-editor-meta">
          <span>更新：{formatTime(remoteUpdatedAt)}</span>
          <span>更新人：{updatedBy}</span>
          <b>revision {remoteRevision}</b>
        </Space>}
      >
        {!creating && tab === 'platform' && !selectedId ? <NoData description="请选择或新建 Prompt" />
          : loading ? <QueryLoading label="正在加载 Prompt" />
            : error ? <QueryFailure error={error} onRetry={() => void reloadCurrent()} />
              : <>
                {tab === 'platform' && <Input
                  aria-label="Prompt 名称"
                  placeholder="Prompt 名称"
                  maxLength={300}
                  value={editor.name}
                  disabled={savePrompt.isPending}
                  onChange={(event) => mutateEditor({ name: event.target.value })}
                />}
                {tab === 'platform' && prompt.data && <section
                  className={`prompt-binding-summary${prompt.data.bound_platform_count ? '' : ' is-empty'}`}
                  aria-label="Prompt 使用平台"
                >
                  <div className="prompt-binding-heading">
                    <Typography.Text strong>使用平台</Typography.Text>
                    <Typography.Text type="secondary">
                      {prompt.data.bound_platform_count ? `${prompt.data.bound_platform_count} 个` : '暂未绑定'}
                    </Typography.Text>
                  </div>
                  {prompt.data.bound_platforms.length
                    ? <Space size={[6, 6]} wrap>{prompt.data.bound_platforms.map((platform) => <Tag key={platform.id}>{platform.name}</Tag>)}</Space>
                    : <Typography.Text type="secondary">可直接删除此 Prompt。</Typography.Text>}
                </section>}
                <PromptMarkdownEditor
                  value={editor.draft}
                  ariaLabel={tab === 'platform' ? 'Prompt Markdown' : '自然化 Prompt Markdown'}
                  configured={configured}
                  disabled={!canSaveCurrent || savePrompt.isPending || removePrompt.isPending || (tab === 'platform' && !editor.name.trim())}
                  saveState={editor.saveState}
                  error={savePrompt.error ?? removePrompt.error}
                  outputLength="由 Prompt 定义"
                  canDelete={tab === 'platform' && !!prompt.data?.available_actions.includes('DELETE')}
                  deleting={removePrompt.isPending}
                  deleteDescription={prompt.data && <Space orientation="vertical" size={4}>
                    <span>将自动解绑 {prompt.data.bound_platform_count} 个平台：</span>
                    <span>{prompt.data.bound_platforms.length
                      ? prompt.data.bound_platforms.map((platform) => platform.name).join('、')
                      : '无关联平台'}</span>
                    <span>解绑后平台在重新绑定 Prompt 前不能发起新内容生成；历史快照保持不变。</span>
                  </Space>}
                  onChange={(draft) => mutateEditor({ draft })}
                  onSave={submitCurrent}
                  onDelete={() => removePrompt.mutate()}
                  onReload={() => void reloadCurrent()}
                />
              </>}
      </Card>
      <aside className="prompt-management-side">
        <PromptOutputPreview
          mode={tab}
          platformProfileId={platformPreviewId}
          dirty={dirty}
          promptConfigured={tab === 'humanization' ? !!humanizationPrompt.data : !!platformPreviewId}
        />
        <Card id="prompt-safety-boundaries" title="生成边界" size="small" className="prompt-safety-panel">
          <ul>
            <li><SafetyCertificateOutlined /><span><strong>消息原样发送</strong><small>system 为平台绑定 Prompt，user 为已批准事实 Markdown。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>共享影响透明</strong><small>保存前列出全部绑定平台，revision 冲突不会覆盖新值。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>删除自动解绑</strong><small>删除 Prompt 会原子解绑全部关联平台，历史快照保持不变。</small></span></li>
            <li><SafetyCertificateOutlined /><span><strong>AI 只创建草稿</strong><small>输出通过人工审核后才能进入发布流程。</small></span></li>
          </ul>
        </Card>
      </aside>
    </div>
    {(savePrompt.error || removePrompt.error) && editor.saveState !== 'conflict' && <Alert
      role="alert"
      type="error"
      showIcon
      title={errorMessage(savePrompt.error ?? removePrompt.error)}
    />}
    {!platformPreviewId && tab === 'platform' && prompt.data && <Typography.Text type="secondary">
      当前 Prompt 尚未绑定平台，绑定后可使用真实内容任务生成预览。
    </Typography.Text>}
  </div>;
}
