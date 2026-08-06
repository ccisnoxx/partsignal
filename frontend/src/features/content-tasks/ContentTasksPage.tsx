/** 内容任务页：任务只锁定产品、事实版本和平台，首稿可由 AI 或人工创建。 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QUERY_STALE_TIME, queryClient } from '../../app/queryClient';
import { ApiError, api, csrfHeader, ensureSuccess, errorMessage, newIdempotencyKey, unwrap } from '../../shared/api/client';
import { platformProfilesQueryOptions, productsQueryOptions } from '../../shared/api/queryOptions';
import { queryKeys } from '../../shared/api/queryKeys';
import type { ContentTaskListItem, ContentTaskListQuery, ContentVersion, Schema } from '../../shared/api/types';
import { NoData, QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { DeletionError, DeletionGuidanceModal, type DeletionBlocker, type DeletionReferenceLink } from '../../shared/components/DeletionError';
import { MetricTile } from '../../shared/components/MetricTile';
import { PageHeader } from '../../shared/components/PageHeader';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { StatusTag } from '../../shared/components/StatusTag';
import { TableCellText } from '../../shared/components/TableCellText';
import { TableRegion } from '../../shared/components/TableRegion';
import { CONTENT_TAG_ERROR, contentTagRules, isContentTagsValidationError } from '../../shared/contentValidation';
import { useActiveSection } from '../../shared/hooks/useActiveSection';
import { useFocusReturn } from '../../shared/hooks/useFocusReturn';
import { renderSanitizedMarkdown } from '../../shared/markdown';

const taskSectionIds = ['task-context', 'task-entry', 'task-versions'];
const taskPageSize = 10;
type TaskStatus = Schema<'ContentTaskStatus'>;
type TaskStatusFilter = 'ALL' | TaskStatus;
type TaskArchiveStatus = NonNullable<ContentTaskListQuery['archive_status']>;
type TaskLifecycleAction = 'ARCHIVE' | 'RESTORE';
type TaskMenuAction = 'CANCEL' | 'DELETE' | 'ARCHIVE' | 'RESTORE' | 'PERMANENT_DELETE';
const taskStatusOptions: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'OPEN', label: '进行中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
];
const taskMenuLabels: Record<TaskMenuAction, string> = {
  CANCEL: '取消任务',
  DELETE: '删除任务',
  ARCHIVE: '归档任务',
  RESTORE: '恢复任务',
  PERMANENT_DELETE: '永久删除',
};
const taskDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const taskPrimaryLabels: Record<ContentTaskListItem['primary_task'], string> = {
  CREATE_FIRST_DRAFT: '创建首稿',
  VIEW_GENERATION_PROGRESS: '查看生成进度',
  HANDLE_GENERATION_FAILURE: '处理生成失败',
  EDIT_AND_SUBMIT_REVIEW: '编辑并提交审核',
  REVIEW_CONTENT: '审核处理',
  REVISE_CONTENT: '根据意见修订',
  START_PUBLICATION: '开始发布',
  CONTINUE_PUBLICATION: '继续发布',
  VIEW_FULL_LINEAGE: '查看完整链路',
  VIEW_CANCELLATION: '查看取消记录',
};

const generationTaskLabels: Record<Schema<'GenerationJob'>['primary_task'], string> = {
  VIEW_EXECUTION_PROGRESS: '查看执行进度',
  VIEW_GENERATED_CONTENT: '查看生成内容',
  HANDLE_FAILURE: '处理失败',
  VIEW_FAILURE: '查看失败原因',
};

const contentTaskLabels: Record<ContentVersion['primary_task'], string> = {
  EDIT_AND_SUBMIT_REVIEW: '编辑并提交审核',
  REVIEW_CONTENT: '审核处理',
  CREATE_REVISION: '创建修订版本',
  START_PUBLICATION: '开始发布',
  CONTINUE_PUBLICATION: '继续发布',
  VIEW_PUBLICATION_RESULT: '查看发布成果',
  VIEW_VERSION_HISTORY: '查看历史版本',
};

function taskPrimaryHref(row: ContentTaskListItem) {
  if (row.primary_task === 'START_PUBLICATION') return '/publications';
  if (row.primary_task === 'CONTINUE_PUBLICATION') return `/publications?content_task_id=${row.id}`;
  return `/tasks/${row.id}`;
}

function contentPrimaryHref(row: ContentVersion, platformProfileId?: string | null) {
  if (row.primary_task === 'START_PUBLICATION') {
    const profileQuery = platformProfileId ? `&platform_profile_id=${platformProfileId}` : '';
    return `/publications?content_version_id=${row.id}${profileQuery}`;
  }
  if (row.primary_task === 'CONTINUE_PUBLICATION' || row.primary_task === 'VIEW_PUBLICATION_RESULT') {
    return `/publications?content_task_id=${row.task_id}`;
  }
  return `/content/${row.id}`;
}

function isTaskStatus(value: string): value is TaskStatus {
  return taskStatusOptions.some((option) => option.value === value);
}

function isTaskArchiveStatus(value: string): value is TaskArchiveStatus {
  return value === 'ACTIVE' || value === 'ARCHIVED';
}

function isTaskMenuAction(value: string): value is TaskMenuAction {
  return value in taskMenuLabels;
}

function taskDeletionLink(taskId: string, issueId?: string | null) {
  return (blocker: DeletionBlocker): DeletionReferenceLink | undefined => {
    if (blocker.type === 'PROTECTED_CONTENT_VERSION') return { href: `/tasks/${taskId}#task-versions`, label: '查看历史' };
    if (blocker.type === 'PUBLICATION_WORK') return { href: `/publications?content_task_id=${taskId}`, label: '查看历史' };
    if (blocker.type === 'PUBLISHED_CONTENT_ISSUE' && issueId) return { href: `/publications?kind=issue&selected=${issueId}`, label: '查看历史' };
    if (blocker.type === 'GEO_OPTIMIZATION_SOURCE') return { href: `/tasks/${taskId}`, label: '查看历史' };
    return undefined;
  };
}

function removeContentTaskFromListCache(taskId: string) {
  queryClient.setQueriesData<Schema<'ContentTaskList'>>(
    { queryKey: queryKeys.contentTasks.all },
    (current) => current
      ? { ...current, items: current.items.filter((item) => item.id !== taskId) }
      : current,
  );
}

function PermanentDeleteTaskModal({
  taskId,
  onClose,
  onDeleted,
}: {
  taskId?: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const { message } = App.useApp();
  const [confirmation, setConfirmation] = useState('');
  const deletionPreview = useQuery({
    queryKey: ['content-task-permanent-deletion-preview', taskId],
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/permanent-deletion-preview', {
      params: { path: { content_task_id: taskId! } },
    })),
    enabled: !!taskId,
    staleTime: 0,
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!taskId || !deletionPreview.data) throw new Error('永久删除预览尚未加载');
      return ensureSuccess(await api.POST('/api/v1/content-tasks/{content_task_id}/permanent-delete', {
        params: { path: { content_task_id: taskId }, header: csrfHeader() },
        body: {
          expected_revision: deletionPreview.data.revision,
          confirmation_text: confirmation,
        },
      }));
    },
    onSuccess: async () => {
      const deletedTaskId = taskId!;
      setConfirmation('');
      message.success('内容任务及其内部历史已永久删除');
      removeContentTaskFromListCache(deletedTaskId);
      await onDeleted();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(deletedTaskId), refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.publications.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.geo.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platformProfiles.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs }),
      ]);
    },
  });
  const counts = deletionPreview.data?.counts;

  return <Modal
    title="永久删除内容任务"
    open={!!taskId}
    onCancel={() => {
      if (!remove.isPending) {
        setConfirmation('');
        onClose();
      }
    }}
    onOk={() => remove.mutate()}
    okText="永久删除"
    cancelText="取消"
    confirmLoading={remove.isPending}
    okButtonProps={{ danger: true, disabled: confirmation !== '永久删除' || !deletionPreview.data }}
    width={720}
    destroyOnHidden
  >
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="error"
        showIcon
        title="此操作不可恢复"
        description="只删除 PartSignal 内部任务、内容、发布与独占 GEO 历史；不会检查或删除外部页面。"
      />
      {deletionPreview.isLoading && <QueryLoading label="正在计算永久删除范围" />}
      {deletionPreview.error && <QueryFailure error={deletionPreview.error} onRetry={() => void deletionPreview.refetch()} />}
      {counts && <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
        { label: '内容版本 / 审核', children: `${counts.content_versions} / ${counts.content_review_records}` },
        { label: '生成作业', children: counts.generation_jobs },
        { label: '发布工作 / 事件', children: `${counts.publication_works} / ${counts.publication_events}` },
        { label: '核验 / 文章', children: `${counts.publication_verifications} / ${counts.published_articles}` },
        { label: '发布后问题', children: counts.published_content_issues },
        { label: 'GEO 文章关系', children: counts.geo_article_relations },
        { label: '独占 GEO 更正链', children: counts.exclusive_geo_observation_chains },
        { label: '附件关系', children: counts.attachment_relations },
      ]} />}
      {!!deletionPreview.data?.external_urls.length && <div>
        <Typography.Text strong>外部页面（不会删除）</Typography.Text>
        <ul>{deletionPreview.data.external_urls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
      </div>}
      <Form.Item label={<>输入 <Typography.Text code>永久删除</Typography.Text> 继续</>} required>
        <Input
          aria-label="永久删除确认文本"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </Form.Item>
      {remove.error && <Alert role="alert" type="error" showIcon title={errorMessage(remove.error)} />}
    </Space>
  </Modal>;
}

export function ContentTasksPage() {
  const { taskId } = useParams();
  return taskId ? <TaskDetail key={taskId} taskId={taskId} /> : <TaskList />;
}

function TaskList() {
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProductId = searchParams.get('product_id') ?? undefined;
  const requestedFactId = searchParams.get('fact_version_id') ?? undefined;
  const [open, setOpen] = useState(!!requestedProductId);
  const [cancelTarget, setCancelTarget] = useState<ContentTaskListItem>();
  const [deletionTarget, setDeletionTarget] = useState<ContentTaskListItem>();
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<ContentTaskListItem>();
  const cancelTriggerRef = useRef<HTMLElement>(null);
  const { rememberFocusTarget, restoreFocus } = useFocusReturn();
  const rawPage = searchParams.get('page');
  const rawStatus = searchParams.get('status');
  const rawArchiveStatus = searchParams.get('archive_status');
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const keyword = searchParams.get('q') ?? '';
  const status: TaskStatusFilter = rawStatus && isTaskStatus(rawStatus) ? rawStatus : 'ALL';
  const archiveStatus: TaskArchiveStatus = rawArchiveStatus && isTaskArchiveStatus(rawArchiveStatus)
    ? rawArchiveStatus
    : 'ACTIVE';
  const platformProfileId = searchParams.get('platform_profile_id') ?? undefined;
  const filterProductId = searchParams.get('filter_product_id') ?? undefined;
  const filterFactVersionId = searchParams.get('filter_fact_version_id') ?? undefined;
  useEffect(() => {
    if (!cancelTarget) cancelTriggerRef.current?.focus({ preventScroll: true });
  }, [cancelTarget]);
  const taskListQuery: ContentTaskListQuery = {
    archive_status: archiveStatus,
    ...(platformProfileId ? { platform_profile_id: platformProfileId } : {}),
    ...(filterProductId ? { filter_product_id: filterProductId } : {}),
    ...(filterFactVersionId ? { filter_fact_version_id: filterFactVersionId } : {}),
  };
  const tasks = useQuery({
    queryKey: queryKeys.contentTasks.list(taskListQuery),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks', { params: { query: taskListQuery } })),
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const items = tasks.data?.items ?? [];
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  const filteredTasks = items.filter((task) => {
    const matchesKeyword = !normalizedKeyword || [
      task.product.brand,
      task.product.part_number,
      task.platform.name,
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedKeyword));
    return matchesKeyword && (status === 'ALL' || task.status === status);
  });
  const statusCounts = Object.fromEntries(taskStatusOptions.map((option) => [
    option.value,
    items.filter((task) => task.status === option.value).length,
  ])) as Record<TaskStatus, number>;
  const maxPage = Math.max(1, Math.ceil(filteredTasks.length / taskPageSize));
  const cancelTask = useMutation({
    mutationFn: async ({ task, comment }: { task: ContentTaskListItem; comment: string }) =>
      unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/cancel', {
        params: { path: { content_task_id: task.id }, header: csrfHeader() },
        body: { expected_revision: task.revision, comment },
      })),
    onSuccess: async () => {
      setCancelTarget(undefined);
      message.success('内容任务已取消');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all });
    },
  });
  const deleteTask = useMutation({
    mutationFn: async (task: ContentTaskListItem) =>
      ensureSuccess(await api.DELETE('/api/v1/content-tasks/{content_task_id}', {
        params: { path: { content_task_id: task.id }, header: csrfHeader() },
      })),
    onSuccess: async () => {
      message.success('内容任务已删除');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all });
    },
  });
  const lifecycleTask = useMutation({
    mutationFn: async ({ task, action }: { task: ContentTaskListItem; action: TaskLifecycleAction }) => {
      const params = {
        path: { content_task_id: task.id },
        header: csrfHeader(),
      };
      const body = { expected_revision: task.revision };
      return action === 'ARCHIVE'
        ? unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/archive', { params, body }))
        : unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/restore', { params, body }));
    },
    onSuccess: async (_, { action }) => {
      message.success(action === 'ARCHIVE' ? '内容任务已归档' : '内容任务已恢复');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all });
    },
  });
  const confirmDeleteTask = (target: ContentTaskListItem) => modal.confirm({
    title: '删除内容任务？',
    content: '将同时删除该任务的内容版本、审核记录、生成作业和未成功发布历史。成功文章或 GEO 关系需要先归档；操作不可恢复。',
    okText: '确认删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: () => deleteTask.mutateAsync(target),
    afterClose: restoreFocus,
  });
  const confirmLifecycleTask = (target: ContentTaskListItem, action: TaskLifecycleAction) => modal.confirm({
    title: action === 'ARCHIVE' ? '归档内容任务？' : '恢复内容任务？',
    content: action === 'ARCHIVE'
      ? '归档后任务会从当前列表隐藏，发布、GEO 和外部页面均保持不变。'
      : '恢复只让任务重新出现在当前列表，不会把业务状态改回进行中。',
    okText: action === 'ARCHIVE' ? '确认归档' : '确认恢复',
    cancelText: '取消',
    onOk: () => lifecycleTask.mutateAsync({ task: target, action }),
    afterClose: restoreFocus,
  });

  useEffect(() => {
    if ((rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) || (rawStatus !== null && !isTaskStatus(rawStatus)) || (rawArchiveStatus !== null && !isTaskArchiveStatus(rawArchiveStatus)) || (tasks.data && page > maxPage)) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      if (rawStatus !== null && !isTaskStatus(rawStatus)) next.delete('status');
      if (rawArchiveStatus !== null && !isTaskArchiveStatus(rawArchiveStatus)) next.delete('archive_status');
      setSearchParams(next, { replace: true });
    }
  }, [maxPage, page, rawArchiveStatus, rawPage, rawStatus, searchParams, setSearchParams, tasks.data]);

  const setFilter = (key: 'q' | 'status' | 'archive_status' | 'platform_profile_id' | 'filter_product_id' | 'filter_fact_version_id', value?: string, replace = false) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete('page');
    setSearchParams(next, { replace });
  };
  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'status', 'page', 'filter_product_id', 'filter_fact_version_id'].forEach((key) => next.delete(key));
    setSearchParams(next);
  };

  return <div className="page-stack tasks-workbench">
    <PageHeader
      eyebrow="内容工作流"
      title="内容任务台"
      description="每个任务只锁定产品、已批准事实版本和目标平台；AI 模型在每次生成时选择。"
      actions={<Button aria-label="新建内容任务" aria-haspopup="dialog" aria-expanded={open} className="tasks-primary-action" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建内容任务</Button>}
    />

    <Card className="tasks-glass-panel tasks-filter-panel" variant="borderless">
      {platformProfileId && <Tag className="tasks-platform-filter" closable onClose={() => setFilter('platform_profile_id')}>当前平台：{items[0]?.platform.name ?? platformProfileId}</Tag>}
      {filterProductId && <Tag closable onClose={() => setFilter('filter_product_id')}>引用产品：{items[0]?.product.part_number ?? filterProductId}</Tag>}
      {filterFactVersionId && <Tag closable onClose={() => setFilter('filter_fact_version_id')}>引用事实版本：{filterFactVersionId.slice(0, 8)}</Tag>}
      <div className="tasks-filter-grid" role="search" aria-label="内容任务筛选">
        <Input
          allowClear
          aria-label="搜索内容任务"
          type="search"
          prefix={<SearchOutlined />}
          placeholder="搜索产品或平台"
          value={keyword}
          onChange={(event) => setFilter('q', event.target.value, true)}
        />
        <Button aria-label="重置筛选" icon={<ReloadOutlined />} disabled={!keyword && status === 'ALL' && !filterProductId && !filterFactVersionId} onClick={resetFilters}>重置筛选</Button>
      </div>
      <Tabs
        activeKey={archiveStatus}
        onChange={(value) => setFilter('archive_status', value === 'ACTIVE' ? undefined : value)}
        items={[
          { key: 'ACTIVE', label: '当前任务' },
          { key: 'ARCHIVED', label: '已归档' },
        ]}
      />
      <Tabs
        className="tasks-status-tabs"
        activeKey={status}
        onChange={(value) => setFilter('status', value === 'ALL' ? undefined : value)}
        items={[
          { key: 'ALL', label: <span>全部 <b>{items.length}</b></span> },
          ...taskStatusOptions.map((option) => ({ key: option.value, label: <span>{option.label} <b>{statusCounts[option.value]}</b></span> })),
        ]}
      />
    </Card>

    <section className="tasks-metric-grid" aria-label="内容任务摘要">
      <MetricTile icon={<UnorderedListOutlined />} label="全部任务" value={tasks.data ? items.length : '—'} meta="当前列表全部记录" />
      <MetricTile icon={<ClockCircleOutlined />} label="进行中任务" value={tasks.data ? statusCounts.OPEN : '—'} meta="状态 OPEN" tone="data" />
      <MetricTile icon={<CheckCircleOutlined />} label="已完成任务" value={tasks.data ? statusCounts.COMPLETED : '—'} meta="状态 COMPLETED" tone="success" />
      <MetricTile icon={<CloseCircleOutlined />} label="已取消任务" value={tasks.data ? statusCounts.CANCELLED : '—'} meta="状态 CANCELLED" />
    </section>

    <Card
      className="tasks-glass-panel tasks-table-panel"
      title="任务列表"
      extra={<Typography.Text className="tasks-table-summary">显示 {filteredTasks.length} / {items.length} 条</Typography.Text>}
    >
      {tasks.error ? <QueryFailure error={tasks.error} onRetry={() => void tasks.refetch()} /> : <div aria-busy={tasks.isLoading}>
        {(cancelTask.error || deleteTask.error || lifecycleTask.error) && <DeletionError error={cancelTask.error ?? deleteTask.error ?? lifecycleTask.error} resolveLink={deleteTask.variables ? taskDeletionLink(deleteTask.variables.id, deleteTask.variables.source_published_content_issue_id) : undefined} />}
        <TableRegion label="内容任务列表">
          <Table<ContentTaskListItem>
            rowKey="id"
            loading={{ spinning: tasks.isLoading, description: '正在加载内容任务列表' }}
            dataSource={filteredTasks}
            pagination={{
              current: page,
              pageSize: taskPageSize,
              showSizeChanger: false,
              showTotal: (total, range) => `${range[0]}–${range[1]} / 共 ${total} 条`,
              onChange: setPage,
            }}
            locale={{ emptyText: <NoData description={items.length ? '没有符合当前筛选条件的任务' : '暂无内容任务'} /> }}
            rowClassName={(row) => row.latest_generation_status === 'FAILED' ? 'task-row-generation-failed' : ''}
            scroll={{ x: 980 }}
            columns={[
              {
                title: '产品',
                render: (_, row) => {
                  const productName = `${row.product.brand} ${row.product.part_number}`;
                  return <div className="task-title-cell"><Tooltip title={productName} trigger={['hover', 'focus']}><strong className="table-cell-ellipsis" tabIndex={0} aria-label={productName}>{row.product.brand} <span className="data-code">{row.product.part_number}</span></strong></Tooltip><span>事实版本 <span className="data-code">{row.fact_version_id.slice(0, 8)}</span></span></div>;
                },
              },
              {
                title: '目标平台',
                width: 190,
                render: (_, row) => <div className="task-platform-cell"><PlatformAvatar name={row.platform.name} logo={row.platform.logo} /><Tooltip title={row.platform.name} trigger={['hover', 'focus']}>{row.platform.website_url ? <a className="table-cell-ellipsis" href={row.platform.website_url} target="_blank" rel="noreferrer" aria-label={row.platform.name}>{row.platform.name}</a> : <span className="table-cell-ellipsis" tabIndex={0} aria-label={row.platform.name}>{row.platform.name}</span>}</Tooltip></div>,
              },
              { title: '任务状态', dataIndex: 'status', width: 118, render: (value: TaskStatus) => <StatusTag status={value} /> },
              { title: 'AI 生成状态', dataIndex: 'latest_generation_status', width: 132, render: (value: Schema<'GenerationJobStatus'> | null) => value ? <StatusTag status={value} /> : <Tag className="status-tag status-tag-neutral">尚未生成</Tag> },
              { title: '创建时间', dataIndex: 'created_at', width: 170, render: (value: string) => <time dateTime={value}>{taskDateFormatter.format(new Date(value))}</time> },
              {
                title: '操作',
                key: 'actions',
                width: 160,
                fixed: 'right',
                render: (_, row) => {
                  const secondaryActions = row.available_actions.filter(isTaskMenuAction);
                  const hasDeletionConditions = !row.available_actions.includes('DELETE') && !!row.deletion?.blockers.length;
                  const moreButton = (
                    <Button
                      type="text"
                      icon={<MoreOutlined />}
                      aria-label={`更多操作：${row.product.brand} ${row.product.part_number}`}
                      disabled={secondaryActions.length === 0 && !hasDeletionConditions}
                      loading={(deleteTask.isPending && deleteTask.variables?.id === row.id) || (lifecycleTask.isPending && lifecycleTask.variables?.task.id === row.id)}
                      onFocus={(event) => {
                        cancelTriggerRef.current = event.currentTarget;
                        rememberFocusTarget(event.currentTarget);
                      }}
                      onPointerDown={(event) => {
                        cancelTriggerRef.current = event.currentTarget;
                        rememberFocusTarget(event.currentTarget);
                      }}
                    />
                  );
                  return <Space size={2}>
                    <Link className="task-row-action" aria-label={`${taskPrimaryLabels[row.primary_task]}：${row.product.brand} ${row.product.part_number}`} to={taskPrimaryHref(row)}>{taskPrimaryLabels[row.primary_task]} <RightOutlined /></Link>
                    {(secondaryActions.length || hasDeletionConditions) ? <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          ...secondaryActions.map((action) => ({
                            key: action,
                            label: taskMenuLabels[action],
                            danger: action === 'CANCEL' || action === 'DELETE' || action === 'PERMANENT_DELETE',
                            onClick: () => {
                              if (action === 'CANCEL') {
                                cancelTriggerRef.current?.focus({ preventScroll: true });
                                setCancelTarget(row);
                              } else if (action === 'DELETE') {
                                confirmDeleteTask(row);
                              } else if (action === 'PERMANENT_DELETE') {
                                setPermanentDeleteTarget(row);
                              } else {
                                confirmLifecycleTask(row, action);
                              }
                            },
                          })),
                          ...(hasDeletionConditions ? [{ key: 'conditions', label: '查看删除条件', onClick: () => setDeletionTarget(row) }] : []),
                        ],
                      }}
                    >{moreButton}</Dropdown> : (
                      <Tooltip title="服务端当前未返回可执行操作；可能存在进行中作业或当前账号无权操作。">
                        <span tabIndex={0} aria-label="当前任务没有可执行操作">{moreButton}</span>
                      </Tooltip>
                    )}
                  </Space>;
                },
              },
            ]}
          />
        </TableRegion>
      </div>}
    </Card>
    <DeletionGuidanceModal open={!!deletionTarget} resourceLabel="内容任务" blockers={deletionTarget?.deletion?.blockers ?? []} refreshing={tasks.isFetching} resolveLink={deletionTarget ? taskDeletionLink(deletionTarget.id, deletionTarget.source_published_content_issue_id) : () => undefined} onClose={() => setDeletionTarget(undefined)} onRefresh={async () => { await tasks.refetch(); setDeletionTarget(undefined); }} />
    <PermanentDeleteTaskModal
      taskId={permanentDeleteTarget?.id}
      onClose={() => setPermanentDeleteTarget(undefined)}
      onDeleted={() => setPermanentDeleteTarget(undefined)}
    />
    <TaskCreateModal
      open={open}
      initialProductId={requestedProductId}
      initialFactVersionId={requestedFactId}
      onClose={() => {
        setOpen(false);
        if (requestedProductId || requestedFactId) {
          const next = new URLSearchParams(searchParams);
          next.delete('product_id');
          next.delete('fact_version_id');
          setSearchParams(next, { replace: true });
        }
      }}
    />
    <Modal
      key={cancelTarget?.id}
      title="取消任务"
      open={!!cancelTarget}
      onCancel={() => setCancelTarget(undefined)}
      footer={null}
      destroyOnHidden
    >
      <Form<{ comment: string }>
        layout="vertical"
        initialValues={{ comment: '' }}
        onFinish={({ comment }) => cancelTarget && cancelTask.mutate({ task: cancelTarget, comment })}
      >
        <Form.Item name="comment" label="说明"><Input.TextArea /></Form.Item>
        <Space>
          <Button onClick={() => setCancelTarget(undefined)}>暂不取消</Button>
          <Button type="primary" htmlType="submit" loading={cancelTask.isPending}>确认取消</Button>
        </Space>
      </Form>
    </Modal>
  </div>;
}

function TaskCreateModal({
  open,
  initialProductId,
  initialFactVersionId,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialProductId?: string;
  initialFactVersionId?: string;
  onClose: () => void;
  onCreated?: (created: Schema<'ContentTask'>, factIsPublic: boolean) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Schema<'ContentTaskCreate'>>();
  const productId = Form.useWatch('product_id', form);
  const idempotencyKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    idempotencyKey.current = open ? newIdempotencyKey() : undefined;
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        product_id: initialProductId,
        fact_version_id: initialFactVersionId,
      });
    }
  }, [form, initialFactVersionId, initialProductId, open]);
  const products = useQuery({ ...productsQueryOptions(), enabled: open });
  const platforms = useQuery({ ...platformProfilesQueryOptions(), enabled: open });
  const facts = useQuery({
    queryKey: queryKeys.products.factVersions(productId),
    queryFn: async () => unwrap(await api.GET('/api/v1/products/{product_id}/fact-versions', { params: { path: { product_id: productId! } } })),
    enabled: open && !!productId,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const create = useMutation({
    mutationFn: async ({ body, key }: { body: Schema<'ContentTaskCreate'>; key: string }) => unwrap(await api.POST(
      '/api/v1/content-tasks',
      { params: { header: { ...csrfHeader(), 'Idempotency-Key': key } }, body },
    )),
    onSuccess: async (created, { body }) => {
      const selectedFact = facts.data?.items.find((item) => item.id === body.fact_version_id);
      idempotencyKey.current = undefined;
      onClose();
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all });
      await onCreated?.(created, selectedFact?.classification === 'PUBLIC');
    },
  });
  const dependencyError = products.error ?? platforms.error ?? facts.error;
  const dependenciesLoading = products.isLoading || platforms.isLoading || (!!productId && facts.isLoading);

  return <Modal title="创建内容任务" open={open} onCancel={() => {
    idempotencyKey.current = undefined;
    onClose();
  }} footer={null} width={680} destroyOnHidden>
    {create.error && <Alert role="alert" className="form-alert" type="error" title={errorMessage(create.error)} />}
    {dependencyError && <QueryFailure error={dependencyError} onRetry={() => { void products.refetch(); void platforms.refetch(); if (productId) void facts.refetch(); }} />}
    {dependenciesLoading && <QueryLoading label="正在加载任务前置数据" />}
    <Form<Schema<'ContentTaskCreate'>>
      form={form}
      layout="vertical"
      disabled={!!dependencyError || dependenciesLoading}
      scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
      onFinish={(body) => {
        idempotencyKey.current ??= newIdempotencyKey();
        create.mutate({ body, key: idempotencyKey.current });
      }}
    >
      <Form.Item name="product_id" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
        <Select showSearch optionFilterProp="label" onChange={() => {
          form.setFieldValue('fact_version_id', undefined);
        }} options={products.data?.items.map((item) => ({ value: item.id, label: `${item.brand} ${item.part_number}` }))} />
      </Form.Item>
      <Form.Item name="fact_version_id" label="已批准事实版本" rules={[{ required: true, message: '请选择已批准事实版本' }]}>
        <Select disabled={!productId} options={facts.data?.items.filter((item) => item.status === 'APPROVED').map((item) => ({
          value: item.id,
          label: `V${item.version} · ${item.classification} · ${item.change_summary}`,
        }))} />
      </Form.Item>
      <Form.Item name="platform_profile_id" label="目标平台" rules={[{ required: true, message: '请选择目标平台' }]}>
        <Select
          placeholder="显示全部已启用平台；缺少 Prompt 仍可手动录入首稿"
          options={platforms.data?.items.filter((item) => item.is_active).map((item) => ({ value: item.id, label: item.name }))}
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={create.isPending}>创建任务</Button>
    </Form>
  </Modal>;
}

function TaskDetail({ taskId }: { taskId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const aiOpenRequested = typeof location.state === 'object'
    && location.state !== null
    && 'openAiGeneration' in location.state
    && location.state.openAiGeneration === true;
  const { message, modal } = App.useApp();
  const activeSection = useActiveSection(taskSectionIds);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [autoAiOpen, setAutoAiOpen] = useState(aiOpenRequested);
  const [aiOpen, setAiOpen] = useState(false);
  const [modelId, setModelId] = useState<string>();
  const [humanizeSource, setHumanizeSource] = useState<ContentVersion>();
  const [humanizeModelId, setHumanizeModelId] = useState<string>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [retryTarget, setRetryTarget] = useState<Schema<'GenerationJob'>>();
  const task = useQuery({
    queryKey: queryKeys.contentTasks.detail(taskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}', { params: { path: { content_task_id: taskId } } })),
    staleTime: QUERY_STALE_TIME.detail,
    retry: (failureCount, error) => !(error instanceof ApiError && error.code === 'NOT_FOUND') && failureCount < 1,
  });
  const taskReady = !!task.data && !task.isFetching;
  const taskList = useQuery({
    queryKey: queryKeys.contentTasks.list({ archive_status: 'ALL' }),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks', {
      params: { query: { archive_status: 'ALL' } },
    })),
    enabled: taskReady,
    staleTime: QUERY_STALE_TIME.businessList,
  });
  const fact = useQuery({
    queryKey: queryKeys.products.factVersion(task.data?.fact_version_id),
    queryFn: async () => unwrap(await api.GET('/api/v1/fact-versions/{fact_version_id}', { params: { path: { fact_version_id: task.data!.fact_version_id } } })),
    enabled: taskReady,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const versions = useQuery({
    queryKey: queryKeys.contentTasks.versions(taskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/content-versions', { params: { path: { content_task_id: taskId } } })),
    enabled: taskReady,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const jobs = useQuery({
    queryKey: queryKeys.contentTasks.jobs(taskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-jobs', { params: { path: { content_task_id: taskId } } })),
    enabled: taskReady,
    staleTime: QUERY_STALE_TIME.workbench,
    refetchInterval: (query) => query.state.data?.items.some((job) => ['PENDING', 'RUNNING'].includes(job.status)) ? 2000 : false,
  });
  const generationDialogOpen = aiOpen
    || (autoAiOpen && !!task.data?.available_actions.includes('CREATE_GENERATION_JOB'));
  const options = useQuery({
    queryKey: queryKeys.contentTasks.options(taskId),
    queryFn: async () => unwrap(await api.GET('/api/v1/content-tasks/{content_task_id}/generation-options', { params: { path: { content_task_id: taskId } } })),
    enabled: taskReady && (generationDialogOpen || !!humanizeSource),
    staleTime: 0,
    retry: false,
  });
  const createJob = useMutation({
    mutationFn: async () => {
      if (!modelId || !options.data) throw new Error('请确认 Prompt 并选择模型');
      return unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/generation-jobs', {
        params: { path: { content_task_id: taskId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
        body: {
          ai_model_id: modelId,
          platform_prompt_id: options.data.platform_prompt.id,
          platform_prompt_revision: options.data.platform_prompt.revision,
        },
      }));
    },
    onSuccess: async () => {
      setAutoAiOpen(false);
      setAiOpen(false);
      setModelId(undefined);
      message.success('生成作业已创建');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) });
    },
  });
  const createHumanizationJob = useMutation({
    mutationFn: async () => {
      if (!humanizeSource || !humanizeModelId) throw new Error('请选择自然化来源和模型');
      return unwrap(await api.POST('/api/v1/content-versions/{content_version_id}/humanization-jobs', {
        params: { path: { content_version_id: humanizeSource.id }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
        body: { ai_model_id: humanizeModelId },
      }));
    },
    onSuccess: async () => {
      setHumanizeSource(undefined);
      setHumanizeModelId(undefined);
      message.success('自然化作业已创建');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) }),
      ]);
    },
  });
  const retryJob = useMutation({
    mutationFn: async (jobId: string) => unwrap(await api.POST('/api/v1/generation-jobs/{generation_job_id}/retry', {
      params: { path: { generation_job_id: jobId }, header: { ...csrfHeader(), 'Idempotency-Key': newIdempotencyKey() } },
    })),
    onSuccess: async () => {
      setRetryTarget(undefined);
      message.success('已提交原快照重试');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.jobs(taskId) });
    },
  });
  const taskCommand = useMutation({
    mutationFn: async (body: Schema<'CommandRequest'>) => unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/cancel', {
      params: { path: { content_task_id: taskId }, header: csrfHeader() },
      body,
    })),
    onSuccess: async () => {
      setCancelOpen(false);
      message.success('内容任务已取消');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
      ]);
    },
  });
  const deleteTask = useMutation({
    mutationFn: async () => ensureSuccess(await api.DELETE('/api/v1/content-tasks/{content_task_id}', {
      params: { path: { content_task_id: taskId }, header: csrfHeader() },
    })),
    onSuccess: async () => {
      message.success('内容任务已删除');
      removeContentTaskFromListCache(taskId);
      navigate('/tasks', { replace: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId), refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
      ]);
    },
  });
  const lifecycleTask = useMutation({
    mutationFn: async ({ action, revision }: { action: TaskLifecycleAction; revision: number }) => {
      const params = { path: { content_task_id: taskId }, header: csrfHeader() };
      const body = { expected_revision: revision };
      return action === 'ARCHIVE'
        ? unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/archive', { params, body }))
        : unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/restore', { params, body }));
    },
    onSuccess: async (_, { action }) => {
      message.success(action === 'ARCHIVE' ? '内容任务已归档' : '内容任务已恢复');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.detail(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.all }),
      ]);
    },
  });
  const latestJob = jobs.data?.items[0];
  const jobDetailId = selectedJobId ?? latestJob?.id;
  const jobDetail = useQuery({
    queryKey: queryKeys.generationJob(jobDetailId),
    queryFn: async () => unwrap(await api.GET('/api/v1/generation-jobs/{generation_job_id}', { params: { path: { generation_job_id: jobDetailId! } } })),
    enabled: taskReady && !!jobDetailId,
    staleTime: QUERY_STALE_TIME.detail,
  });
  const succeededJobs = jobs.data?.items.filter((job) => job.status === 'SUCCEEDED').map((job) => job.id).join(',');
  useEffect(() => {
    if (succeededJobs) void queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) });
  }, [succeededJobs, taskId]);

  useEffect(() => {
    if (!autoAiOpen) return;
    // 新任务的弹窗意图仅在当前详情实例生效；清除路由状态后，刷新不会重复打开。
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [autoAiOpen, location.hash, location.pathname, location.search, navigate]);

  if (task.isLoading) return <QueryLoading label="正在加载内容任务" />;
  if (task.error instanceof ApiError && task.error.code === 'NOT_FOUND') {
    return <div className="page-stack"><PageHeader title="内容任务" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} /><NoData description="内容任务不存在或已删除" action={<Button onClick={() => navigate('/tasks', { replace: true })}>返回任务列表</Button>} /></div>;
  }
  if (task.error || !task.data) {
    return <div className="page-stack"><Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button><PageHeader title="内容任务" breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]} /><QueryFailure error={task.error ?? new Error('内容任务不存在')} onRetry={() => void task.refetch()} /></div>;
  }

  const summary = taskList.data?.items.find((item) => item.id === taskId);
  const mutationError = createJob.error ?? createHumanizationJob.error ?? retryJob.error ?? taskCommand.error ?? lifecycleTask.error;
  const isOpen = task.data.status === 'OPEN';
  const factIsPublic = fact.data?.classification === 'PUBLIC';
  const canGenerate = task.data.available_actions.includes('CREATE_GENERATION_JOB');
  const canCreateManualVersion = task.data.available_actions.includes('CREATE_MANUAL_VERSION');
  const replacementRequired = !canGenerate;
  const generationBlockReason = !isOpen
    ? '当前任务已结束，历史任务保持只读，不能新增 AI 草稿。请创建新任务后继续。'
    : fact.error
      ? '事实版本加载失败，暂时无法确认是否允许发送给第三方模型。'
      : fact.data && !factIsPublic
        ? `事实分级为 ${fact.data.classification}，不能发送给第三方模型。请创建新任务并选择 PUBLIC 事实版本。`
        : !canGenerate
          ? '服务端当前未开放 AI 生成，可能需要恢复产品、平台或 Prompt 配置。'
          : undefined;
  const promptChanged = createJob.error instanceof ApiError
    && createJob.error.code === 'PLATFORM_PROMPT_CHANGED';

  return <div className="page-stack">
    <Button type="link" onClick={() => navigate('/tasks')}>← 返回任务列表</Button>
    <PageHeader
      eyebrow={`任务 / ${taskId.slice(0, 8)}`}
      title={summary ? `${summary.product.brand} ${summary.product.part_number}` : '内容任务详情'}
      description={summary
        ? `目标平台：${summary.platform.name}`
        : task.data.platform_profile_id
          ? `平台 ${task.data.platform_profile_id.slice(0, 8)}`
          : '历史平台配置已删除'}
      breadcrumbs={[{ title: <Link to="/tasks">内容任务</Link> }, { title: '任务详情' }]}
      actions={<>
        <StatusTag status={task.data.status} />
        {task.data.available_actions.includes('CANCEL') && <Button danger onClick={() => setCancelOpen(true)}>取消任务</Button>}
        {task.data.available_actions.includes('DELETE') && <Button danger loading={deleteTask.isPending} onClick={() => modal.confirm({
          title: '删除内容任务？',
          content: '将同时删除该任务的内容版本、审核记录、生成作业和未成功发布历史。成功文章或 GEO 关系需要先归档；操作不可恢复。',
          okText: '确认删除',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => deleteTask.mutate(),
        })}>删除任务</Button>}
        {task.data.available_actions.includes('ARCHIVE') && <Button loading={lifecycleTask.isPending} onClick={() => modal.confirm({
          title: '归档内容任务？',
          content: '归档后任务会从当前列表隐藏，发布、GEO 和外部页面均保持不变。',
          okText: '确认归档',
          cancelText: '取消',
          onOk: () => lifecycleTask.mutateAsync({ action: 'ARCHIVE', revision: task.data.revision }),
        })}>归档任务</Button>}
        {task.data.available_actions.includes('RESTORE') && <Button loading={lifecycleTask.isPending} onClick={() => modal.confirm({
          title: '恢复内容任务？',
          content: '恢复只让任务重新出现在当前列表，不会把业务状态改回进行中。',
          okText: '确认恢复',
          cancelText: '取消',
          onOk: () => lifecycleTask.mutateAsync({ action: 'RESTORE', revision: task.data.revision }),
        })}>恢复任务</Button>}
        {task.data.available_actions.includes('PERMANENT_DELETE') && <Button danger onClick={() => setPermanentDeleteOpen(true)}>永久删除</Button>}
        {!task.data.available_actions.includes('DELETE') && !!task.data.deletion?.blockers.length && <Button onClick={() => setDeletionOpen(true)}>查看删除条件</Button>}
      </>}
    />
    {task.data.available_actions.length === 0 && (
      <Alert
        type="info"
        showIcon
        title="当前任务为只读状态"
        description={task.data.status === 'OPEN'
          ? '服务端当前未返回取消操作，通常表示存在进行中的发布流程；详情暂时保持只读。'
          : task.data.status === 'CANCELLED'
            ? '当前任务仍有进行中作业或当前账号无删除权限。'
            : '任务已完成，具备权限的人员可归档后继续处理。'}
      />
    )}
    {mutationError && <Alert type="error" title={errorMessage(mutationError)} />}
    {deleteTask.error && <DeletionError error={deleteTask.error} resolveLink={taskDeletionLink(taskId, task.data.source_published_content_issue_id)} />}
    <nav className="form-section-nav" aria-label="内容任务章节">
      <a href="#task-context" aria-current={activeSection === 'task-context' ? 'location' : undefined}>任务上下文</a>
      <a href="#task-entry" aria-current={activeSection === 'task-entry' ? 'location' : undefined}>首稿入口</a>
      <a href="#task-versions" aria-current={activeSection === 'task-versions' ? 'location' : undefined}>内容版本</a>
    </nav>

    <Card id="task-context" title="01 / 锁定上下文" className="workspace-panel workspace-section">
      {(taskList.error || fact.error) && <QueryFailure error={taskList.error ?? fact.error} onRetry={() => { void taskList.refetch(); void fact.refetch(); }} />}
      <Descriptions column={{ xs: 1, md: 2 }} items={[
        { label: '产品', children: summary ? `${summary.product.brand} ${summary.product.part_number}` : <span className="data-code">{task.data.product_id}</span> },
        { label: '冻结事实版本', children: fact.data ? <Space><span>V{fact.data.version}</span><StatusTag status={fact.data.classification} /></Space> : <span className="data-code">{task.data.fact_version_id}</span> },
        { label: '目标平台', children: summary?.platform.name ?? (task.data.platform_profile_id ? <span className="data-code">{task.data.platform_profile_id}</span> : '历史平台配置已删除') },
        { label: '任务创建时间', children: <time dateTime={task.data.created_at}>{taskDateFormatter.format(new Date(task.data.created_at))}</time> },
      ]} />
    </Card>

    <section id="task-entry" className="task-stage-grid workspace-section">
      <Card title="02A / 系统 AI 生成" className="workspace-panel">
        {generationBlockReason
          ? <Alert type={fact.error && isOpen ? 'error' : 'warning'} showIcon title="当前不能生成 AI 草稿" description={generationBlockReason} />
          : <Alert type="info" showIcon title="打开弹窗后确认平台当前 Prompt，再选择已启用模型创建草稿。" />}
        <Typography.Paragraph>模型只接收已确认的 Prompt 和冻结事实 Markdown；手工录入不受 Prompt 配置影响。</Typography.Paragraph>
        {replacementRequired
          ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setReplacementOpen(true)}>新建内容任务</Button>
          : <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={fact.isLoading}
              disabled={!canGenerate}
              onClick={() => {
                setModelId(undefined);
                createJob.reset();
                setAiOpen(true);
              }}
            >生成 AI 草稿</Button>}
      </Card>
      <Card title="02B / 手动录入" className="workspace-panel">
        <Alert type="info" showIcon title="可直接粘贴人工撰写或外部模型生成的 Markdown；不会创建 AI 作业。" />
        <Typography.Paragraph>手动首稿与 AI 草稿进入同一内容版本、审核和人工发布流程。</Typography.Paragraph>
        <Button type="primary" disabled={!canCreateManualVersion} onClick={() => setManualOpen(true)}>录入首个人工草稿</Button>
      </Card>
    </section>

    <Card title="AI 作业" className="workspace-panel">
      {jobs.isLoading ? <QueryLoading label="正在加载 AI 作业" />
        : jobs.error || !jobs.data ? <QueryFailure error={jobs.error ?? new Error('AI 作业列表不存在')} onRetry={() => void jobs.refetch()} />
          : jobs.data.items.length ? <TableRegion label="AI 作业列表"><Table
            rowKey="id"
            dataSource={jobs.data.items}
            scroll={{ x: 970 }}
            pagination={false}
            columns={[
              { title: '类型', dataIndex: 'job_type', width: 100, render: (value) => value === 'HUMANIZE' ? '自然化' : '原始生成' },
              { title: '源版本', dataIndex: 'source_content_version_id', width: 100, render: (value) => value ? <Link to={`/content/${value}`}>{value.slice(0, 8)}</Link> : '—' },
              { title: '状态', dataIndex: 'status', width: 110, render: (value) => <StatusTag status={value} /> },
              { title: '结果', dataIndex: 'content_version_id', width: 110, render: (value) => value ? <Link to={`/content/${value}`}>打开草稿</Link> : '—' },
              { title: '失败原因', dataIndex: 'error_summary', width: 220, ellipsis: true, render: (value) => value ? <TableCellText text={value} /> : '—' },
              { title: '耗时 / Token', width: 160, render: (_, row) => `${row.response_duration_ms ?? '—'} ms / ${row.total_tokens ?? '—'}` },
              { title: '操作', width: 170, fixed: 'right', render: (_, row) => <Button size="small" type="primary" loading={retryJob.isPending && retryTarget?.id === row.id} onClick={() => {
                if (row.primary_task === 'VIEW_GENERATED_CONTENT' && row.content_version_id) navigate(`/content/${row.content_version_id}`);
                else if (row.primary_task === 'HANDLE_FAILURE' && row.available_actions.includes('RETRY')) setRetryTarget(row);
                else setSelectedJobId(row.id);
              }}>{generationTaskLabels[row.primary_task]}</Button> },
            ]}
          /></TableRegion> : <Typography.Text type="secondary">尚无 AI 作业。</Typography.Text>}
      {jobDetail.isLoading && <QueryLoading label="正在加载最新作业追溯" />}
      {jobDetail.error && <QueryFailure error={jobDetail.error} onRetry={() => void jobDetail.refetch()} />}
    </Card>
    {jobDetail.data && <Card title="作业追溯快照">
      <Descriptions column={1} items={[
        { label: '契约版本', children: <span className="data-code">{jobDetail.data.input_snapshot.contract_version}</span> },
        { label: '渠道 / 模型', children: `${String(jobDetail.data.input_snapshot.channel.name)} / ${String(jobDetail.data.input_snapshot.model.model_id)}` },
        { label: '请求参数', children: <pre>{JSON.stringify(jobDetail.data.input_snapshot.model.request_parameters, null, 2)}</pre> },
      ]} />
    </Card>}

    <Card id="task-versions" title="03 / 内容版本" className="workspace-section">
      {versions.isLoading ? <QueryLoading label="正在加载内容版本" />
        : versions.error || !versions.data ? <QueryFailure error={versions.error ?? new Error('内容版本列表不存在')} onRetry={() => void versions.refetch()} />
          : versions.data.items.length ? <TableRegion label="内容版本列表"><Table<ContentVersion>
            rowKey="id"
            dataSource={versions.data.items}
            scroll={{ x: 880 }}
            columns={[
              { title: '版本', dataIndex: 'version', width: 80, render: (value, row) => <Link className="data-code" to={`/content/${row.id}`}>V{value}</Link> },
              { title: '标题', dataIndex: 'title', ellipsis: true, render: (value) => <TableCellText text={value} /> },
              { title: '来源', dataIndex: 'source_type', width: 100, render: (value) => <StatusTag status={value} /> },
              { title: '状态', dataIndex: 'status', width: 140, render: (value) => <StatusTag status={value} /> },
              { title: '质量问题', dataIndex: 'quality_issues', width: 100, render: (issues: Schema<'QualityIssue'>[]) => issues.length },
              { title: '操作', width: 220, fixed: 'right', render: (_, row) => {
                const canHumanize = row.available_actions.includes('CREATE_HUMANIZATION_JOB');
                return <Space size={4}>
                  <Button size="small" type="primary" onClick={() => navigate(contentPrimaryHref(row, task.data.platform_profile_id))}>{contentTaskLabels[row.primary_task]}</Button>
                  {canHumanize && <Button size="small" onClick={() => setHumanizeSource(row)}>自然化</Button>}
                </Space>;
              } },
            ]}
          /></TableRegion> : <NoData description="尚无内容版本，可从上方任一入口创建首稿" />}
    </Card>

    <DeletionGuidanceModal open={deletionOpen} resourceLabel="内容任务" blockers={task.data.deletion?.blockers ?? []} refreshing={task.isFetching} resolveLink={taskDeletionLink(taskId, task.data.source_published_content_issue_id)} onClose={() => setDeletionOpen(false)} onRefresh={async () => { await task.refetch(); setDeletionOpen(false); }} />
    <PermanentDeleteTaskModal
      taskId={permanentDeleteOpen ? taskId : undefined}
      onClose={() => setPermanentDeleteOpen(false)}
      onDeleted={() => {
        setPermanentDeleteOpen(false);
        navigate('/tasks?archive_status=ARCHIVED', { replace: true });
      }}
    />

    <Modal title="取消任务" open={cancelOpen} onCancel={() => setCancelOpen(false)} footer={null} destroyOnHidden>
      <Form<Schema<'CommandRequest'>> layout="vertical" initialValues={{ expected_revision: task.data.revision, comment: '' }} onFinish={(body) => taskCommand.mutate(body)}>
        <Form.Item name="expected_revision" hidden><InputNumber /></Form.Item>
        <Form.Item name="comment" label="说明"><Input.TextArea /></Form.Item>
        <Space>
          <Button onClick={() => setCancelOpen(false)}>暂不取消</Button>
          <Button type="primary" htmlType="submit" loading={taskCommand.isPending}>确认取消</Button>
        </Space>
      </Form>
    </Modal>
    <Modal
      title="确认重试原生成快照"
      open={!!retryTarget}
      onCancel={() => !retryJob.isPending && setRetryTarget(undefined)}
      onOk={() => retryTarget && retryJob.mutate(retryTarget.id)}
      okText="确认重试"
      confirmLoading={retryJob.isPending}
      destroyOnHidden
    >
      <Alert type="warning" showIcon title="重试会创建新的生成作业，并可能产生外部模型调用费用；原失败作业保持不变。" />
      {retryTarget?.error_summary && <Typography.Paragraph>{retryTarget.error_summary}</Typography.Paragraph>}
    </Modal>
    <TaskCreateModal
      open={replacementOpen}
      onClose={() => setReplacementOpen(false)}
      onCreated={(created, createdFactIsPublic) => navigate(`/tasks/${created.id}`, {
        state: createdFactIsPublic ? { openAiGeneration: true } : null,
      })}
    />
    {manualOpen && <ManualDraftModal
      taskId={taskId}
      onClose={() => setManualOpen(false)}
      onCreated={async (created) => {
        setManualOpen(false);
        await queryClient.invalidateQueries({ queryKey: queryKeys.contentTasks.versions(taskId) });
        navigate(`/content/${created.id}`);
      }}
    />}
    <Modal
      title="生成 AI 草稿"
      open={generationDialogOpen}
      onCancel={() => {
        setAutoAiOpen(false);
        setAiOpen(false);
        setModelId(undefined);
        createJob.reset();
      }}
      onOk={() => createJob.mutate()}
      okText="生成文稿"
      confirmLoading={createJob.isPending}
      okButtonProps={{ disabled: !modelId || !options.data || options.data.models.length === 0 }}
      width={760}
      destroyOnHidden
    >
      {options.isLoading ? <QueryLoading label="正在加载最新生成配置" />
        : options.error || !options.data ? <QueryFailure
            error={options.error ?? new Error('AI 生成选项不存在')}
            onRetry={() => void options.refetch()}
          />
          : <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              title={`${options.data.platform_profile_name} / ${options.data.platform_prompt.name} / revision ${options.data.platform_prompt.revision}`}
              description="提交时服务端会再次校验 Prompt 身份与 revision；配置已变化时不会使用旧确认继续生成。"
            />
            <Form.Item label="当前平台 Prompt（只读）">
              <Input.TextArea
                aria-label="当前平台 Prompt"
                rows={10}
                readOnly
                value={options.data.platform_prompt.template_markdown}
                className="markdown-source"
              />
            </Form.Item>
            <Form.Item label="生成模型" required>
              <Select
                aria-label="生成模型"
                showSearch
                optionFilterProp="label"
                placeholder="选择已启用且测试通过的模型"
                value={modelId}
                onChange={setModelId}
                options={options.data.models.map((item) => ({
                  value: item.id,
                  label: `${item.channel_name} / ${item.display_name} (${item.model_id})`,
                }))}
              />
            </Form.Item>
            {options.data.models.length === 0 && <Alert type="warning" showIcon title="当前没有已启用且测试通过的模型。" />}
            {!options.data.humanization_prompt_configured && <Alert type="info" showIcon title="全局自然化 Prompt 未配置；不影响本次原始生成。" />}
            {createJob.error && <Alert
              role="alert"
              type="error"
              showIcon
              title={promptChanged ? '平台 Prompt 已变化，请重新加载后确认。' : errorMessage(createJob.error)}
              action={promptChanged && <Button size="small" onClick={() => {
                setModelId(undefined);
                createJob.reset();
                void options.refetch();
              }}>重新加载</Button>}
            />}
          </Space>}
    </Modal>
    <Modal
      title={`自然化 V${humanizeSource?.version ?? ''}`}
      open={!!humanizeSource}
      onCancel={() => { setHumanizeSource(undefined); setHumanizeModelId(undefined); }}
      onOk={() => createHumanizationJob.mutate()}
      okText="创建自然化作业"
      confirmLoading={createHumanizationJob.isPending}
      okButtonProps={{ disabled: !humanizeModelId }}
      destroyOnHidden
    >
      <Alert type="info" showIcon title="这会额外调用一次所选模型并创建新的待审核草稿；源版本不会被修改。" />
      {options.isLoading && <QueryLoading label="正在加载自然化模型" />}
      {options.error && <QueryFailure error={options.error} onRetry={() => void options.refetch()} />}
      <Form.Item label="自然化模型" required>
        <Select
          aria-label="自然化模型"
          showSearch
          optionFilterProp="label"
          placeholder="选择已启用且测试通过的模型"
          value={humanizeModelId}
          onChange={setHumanizeModelId}
          options={options.data?.models.map((item) => ({ value: item.id, label: `${item.channel_name} / ${item.display_name} (${item.model_id})` }))}
        />
      </Form.Item>
    </Modal>
  </div>;
}

function ManualDraftModal({
  taskId,
  onClose,
  onCreated,
}: {
  taskId: string;
  onClose: () => void;
  onCreated: (created: ContentVersion) => void | Promise<void>;
}) {
  const [form] = Form.useForm<Schema<'ContentRevisionCreate'>>();
  const [draft, setDraft] = useState<Schema<'ContentRevisionCreate'>>({
    title: '',
    summary: '',
    body_markdown: '',
    tags: [],
    change_summary: '',
  });
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const preview = useMemo(
    () => renderSanitizedMarkdown(draft.body_markdown),
    [draft.body_markdown],
  );
  const create = useMutation({
    mutationFn: async (body: Schema<'ContentRevisionCreate'>) => unwrap(await api.POST('/api/v1/content-tasks/{content_task_id}/manual-versions', {
      params: { path: { content_task_id: taskId }, header: csrfHeader() },
      body,
    })),
    onSuccess: onCreated,
    onError: (error) => {
      if (isContentTagsValidationError(error)) {
        form.setFields([{ name: 'tags', errors: [CONTENT_TAG_ERROR] }]);
      }
    },
  });

  return <Modal title="录入首个人工草稿" open footer={null} width={900} onCancel={onClose} destroyOnHidden>
    <Form<Schema<'ContentRevisionCreate'>>
      form={form}
      layout="vertical"
      initialValues={draft}
      disabled={create.isPending}
      scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
      onValuesChange={(_, values) => setDraft({ ...values, tags: values.tags ?? [] })}
      onFinish={(body) => create.mutate(body)}
    >
      <Alert type="info" showIcon title="提交后直接创建 HUMAN DRAFT，不会创建或计入 AI 作业。" />
      <Tabs activeKey={view} onChange={(key) => setView(key as 'edit' | 'preview')} items={[
        { key: 'edit', label: '编辑 Markdown' },
        { key: 'preview', label: '安全预览' },
      ]} />
      <div hidden={view !== 'edit'}>
        <div className="revision-metadata-grid">
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: '请输入标题' }]}><Input /></Form.Item>
          <Form.Item name="tags" label="标签" rules={contentTagRules}><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
          <Form.Item className="revision-summary-field" name="summary" label="摘要" rules={[{ required: true, whitespace: true, message: '请输入摘要' }]}><Input.TextArea rows={2} /></Form.Item>
        </div>
        <Form.Item name="body_markdown" label="Markdown 正文" rules={[{ required: true, whitespace: true, message: '请输入 Markdown 正文' }]}>
          <Input.TextArea rows={22} className="markdown-source revision-markdown-source" />
        </Form.Item>
        <Form.Item name="change_summary" label="变更说明" rules={[{ required: true, whitespace: true, message: '请说明本次首稿来源或修改目的' }]}>
          <Input placeholder="例如：粘贴外部模型草稿并完成人工校对" />
        </Form.Item>
      </div>
      <section hidden={view !== 'preview'} className="revision-preview" aria-label="人工首稿预览">
        <Typography.Title level={3}>{draft.title || '未填写标题'}</Typography.Title>
        <Typography.Paragraph type="secondary">{draft.summary || '未填写摘要'}</Typography.Paragraph>
        <Space wrap>{draft.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
        <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      </section>
      {create.error && <Alert role="alert" type="error" showIcon title="创建人工首稿失败" description={errorMessage(create.error)} />}
      <div className="form-save-bar">
        <div className="form-save-feedback">
          <Typography.Text strong>{create.isPending ? '正在创建人工首稿' : '提交后进入统一内容审核流程'}</Typography.Text>
          <Typography.Text type="secondary">Markdown 是唯一可编辑正文源。</Typography.Text>
        </div>
        <Button type="primary" htmlType="submit" loading={create.isPending}>创建人工首稿</Button>
      </div>
    </Form>
  </Modal>;
}
