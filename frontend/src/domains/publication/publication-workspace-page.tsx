import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore, useState } from 'react';

import { MarkdownPreview } from '@/design-system/editor/markdown-editor';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { Timeline } from '@/design-system/workspace/timeline';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';
import {
  getFileDownloadUrl,
  publicationKeys,
  publicationPackageQueryOptions,
  publicationWorkspaceContextQueryOptions,
} from './publication.api';
import {
  formatPublicationTime,
  publicationEventRegistry,
  publicationStageRegistry,
} from './publication-work.model';
import { PublicationWorkspaceActions } from './publication-workspace-actions';
import {
  canonicalPublicationWorkspaceHash,
  publicationWorkspaceSections,
  type PublicationWorkspaceContext,
  type PublicationWorkspaceSection,
} from './publication-workspace.model';

type PublicationWorkspacePageProps = {
  csrfToken: string | null;
  onContentProjectionChange: (taskId: string) => Promise<void>;
  onSectionChange: (section: PublicationWorkspaceSection) => Promise<void> | void;
  workId: string;
};

const sectionLabels = {
  summary: '工作摘要',
  preparation: '发布准备',
  result: '发布结果',
  verification: '核验',
  'content-version': '内容版本',
  close: '关闭信息',
} satisfies Record<PublicationWorkspaceSection, string>;

function subscribeHash(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
}

function currentHash() {
  return canonicalPublicationWorkspaceHash(window.location.hash);
}

function PublicationWorkspacePage({
  csrfToken,
  onContentProjectionChange,
  onSectionChange,
  workId,
}: PublicationWorkspacePageProps) {
  const queryClient = useQueryClient();
  const options = publicationWorkspaceContextQueryOptions(workId);
  const query = useQuery(options);
  const [notice, setNotice] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const activeSection = useSyncExternalStore(subscribeHash, currentHash, () => 'summary');

  if (!query.data) {
    if (query.isPending) {
      return <p aria-busy="true" className="p-6 text-text-secondary">正在读取发布工作台…</p>;
    }
    return (
      <section className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
        <h1 className="type-page-title">无法打开发布工作台</h1>
        <p className="break-words text-sm text-destructive">{errorMessage(query.error)}</p>
        <Button onClick={() => void query.refetch()} type="button" variant="outline">重试</Button>
      </section>
    );
  }

  const context = query.data;
  const work = context.work;
  const stage = publicationStageRegistry[work.workflow_stage];
  const events = work.events.map((event) => ({
    id: event.id,
    title: publicationEventRegistry[event.action],
    description: event.action === 'CONTENT_VERSION_CHANGED'
      ? `${event.comment} · ${event.from_content_version_id} → ${event.to_content_version_id}`
      : event.comment || `${event.from_status ?? '新建'} → ${event.to_status}`,
    meta: <time dateTime={event.created_at}>{formatPublicationTime(event.created_at)}</time>,
  }));
  const verifications = work.verifications.map((verification) => ({
    id: verification.id,
    title: verification.outcome === 'PASSED' ? '核验通过' : '核验未通过',
    description: verification.comment || verification.final_url_snapshot,
    meta: (
      <span className="space-x-2">
        <time dateTime={verification.created_at}>{formatPublicationTime(verification.created_at)}</time>
        <span className="font-mono text-xs">版本 {verification.content_version_id}</span>
      </span>
    ),
  }));

  async function copyPackage() {
    setReadError(undefined);
    setNotice(undefined);
    try {
      const publicationPackage = await queryClient.fetchQuery(
        publicationPackageQueryOptions(context.content.id),
      );
      const value = [
        publicationPackage.title,
        publicationPackage.body_markdown,
        publicationPackage.tags.map((tag) => `#${tag}`).join(' '),
      ].filter(Boolean).join('\n\n');
      await navigator.clipboard.writeText(value);
      setNotice('发布包已复制。');
    } catch (error) {
      setReadError(errorMessage(error));
    }
  }

  async function downloadAttachment(fileId: string) {
    setReadError(undefined);
    try {
      const signed = await getFileDownloadUrl(fileId);
      window.open(signed.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setReadError(errorMessage(error));
    }
  }

  async function acceptCanonicalWork(canonicalWork: typeof work) {
    await queryClient.cancelQueries({ queryKey: options.queryKey });
    queryClient.setQueryData(options.queryKey, { ...context, work: canonicalWork });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: options.queryKey }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.workLists() }),
      queryClient.invalidateQueries({ queryKey: publicationKeys.summary() }),
      onContentProjectionChange(work.task_id),
    ]);
  }

  const contextPane = (
    <div className="space-y-5 p-4">
      <dl className="space-y-3 text-sm">
        <ContextValue label="产品" value={`${work.product.brand} ${work.product.part_number}`} />
        <ContextValue label="平台" value={context.platform.name} />
        <ContextValue label="账号" value={work.platform_account_label || '尚未选择'} />
        <ContextValue label="内容版本" value={`v${context.content.version}`} />
        <ContextValue label="内容哈希" value={context.content.content_hash} mono />
      </dl>
      <nav aria-label="发布工作台章节">
        <ul className="space-y-1">
          {publicationWorkspaceSections.map((section) => (
            <li key={section}>
              <a
                aria-current={activeSection === section ? 'location' : undefined}
                className="block rounded-lg px-2 py-1.5 text-sm text-text-secondary hover:bg-muted aria-[current=location]:bg-primary/10 aria-[current=location]:font-medium aria-[current=location]:text-primary"
                href={`#${section}`}
                onClick={(event) => {
                  event.preventDefault();
                  void onSectionChange(section);
                }}
              >
                {sectionLabels[section]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );

  const mainPane = (
    <div className="min-w-0">
      <div id="summary">
        <DetailSection description="状态和下一任务均来自服务端投影。" title="工作摘要">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <ContextValue label="当前阶段" value={stage.label} />
            <ContextValue label="下一任务" value={primaryTaskLabel(work.primary_task)} />
            <ContextValue label="创建时间" value={formatPublicationTime(work.created_at)} />
            <ContextValue label="修订号" value={String(work.revision)} />
          </dl>
        </DetailSection>
      </div>
      <div id="preparation">
        <DetailSection description="账号选择通过底部服务端动作更新。" title="发布准备">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <ContextValue label="平台" value={context.platform.name} />
            <ContextValue label="当前账号" value={work.platform_account_label ? `${work.platform_account_label} · ${work.account_identifier}` : '尚未选择'} />
            <ContextValue label="可选账号" value={context.eligible_accounts.length ? context.eligible_accounts.map((item) => item.label).join('、') : '当前不可更新'} />
            <ContextValue label="平台官网" value={context.platform.website_url ?? '未配置'} />
          </dl>
        </DetailSection>
      </div>
      <div id="result">
        <DetailSection description="实际标题、最终 URL、发布时间和证据由服务端原子登记。" title="发布结果">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <ContextValue label="实际标题" value={work.actual_title ?? '尚未登记'} />
            <ContextValue label="最终 URL" value={work.final_url ?? '尚未登记'} />
            <ContextValue label="发布时间" value={work.published_at ? formatPublicationTime(work.published_at) : '尚未登记'} />
            <ContextValue label="证据数量" value={String(work.attachments.length)} />
          </dl>
        </DetailSection>
      </div>
      <div id="verification">
        <DetailSection title="核验">
          <VerificationStatus context={context} />
        </DetailSection>
      </div>
      <div id="content-version" tabIndex={-1}>
        <DetailSection
          actions={<Button onClick={() => void copyPackage()} size="sm" type="button" variant="outline">复制发布包</Button>}
          description={`批准内容 v${context.content.version}，只读且绑定工作哈希。`}
          title={context.content.title}
        >
          <MarkdownPreview ariaLabel="批准发布内容" value={context.content.body_markdown} />
          {context.switch_candidate && (
            <dl className="m-4 grid gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm sm:grid-cols-2">
              <ContextValue label="候选版本" value={`v${context.switch_candidate.version}`} />
              <ContextValue label="候选标题" value={context.switch_candidate.title} />
              <ContextValue label="候选摘要" value={context.switch_candidate.summary} />
              <ContextValue label="候选哈希" value={context.switch_candidate.content_hash} mono />
            </dl>
          )}
        </DetailSection>
      </div>
      <div id="close">
        <DetailSection title="关闭信息">
          <p className="text-sm text-text-secondary">
            {work.status === 'CLOSED'
              ? `${work.close_reason ?? '未知原因'}：${work.close_comment ?? '无说明'}`
              : work.status === 'COMPLETED'
                ? '工作已完成并冻结为只读，无需关闭。'
                : '工作仍在进行；只有服务端返回 CLOSE 动作时才能关闭。'}
          </p>
        </DetailSection>
      </div>
    </div>
  );

  const referencePane = (
    <div className="space-y-6 p-4">
      <section className="space-y-2" aria-labelledby="attachment-title">
        <h2 className="type-section-title" id="attachment-title">附件</h2>
        {work.attachments.length === 0 ? <p className="text-sm text-text-muted">暂无附件</p> : work.attachments.map((file) => (
          <Button className="max-w-full" key={file.id} onClick={() => void downloadAttachment(file.id)} size="sm" type="button" variant="link">
            <span className="truncate">{file.original_filename}</span>
          </Button>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="event-title">
        <h2 className="type-section-title" id="event-title">事件历史</h2>
        <Timeline items={events} />
      </section>
      <section className="space-y-3" aria-labelledby="verification-history-title">
        <h2 className="type-section-title" id="verification-history-title">核验历史</h2>
        <Timeline items={verifications} />
      </section>
    </div>
  );

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="publication-workspace-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="type-page-title break-words" id="publication-workspace-title">{context.content.title}</h1>
          <p className="break-all text-sm text-text-secondary">工作 ID：{work.id}</p>
        </div>
        <Badge variant={stage.tone}>{stage.label}</Badge>
      </header>
      {query.error && <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning" role="alert">后台刷新失败，当前工作台仍保留：{errorMessage(query.error)}</p>}
      {notice && <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success" role="status">{notice}</p>}
      {readError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{readError}</p>}
      <WorkspaceShell
        ariaLabel="发布工作台"
        context={{ label: '工作上下文', content: contextPane }}
        main={{ label: '发布内容与操作', content: mainPane }}
        reference={{ label: '历史与附件', content: referencePane }}
      />
      <PublicationWorkspaceActions
        context={context}
        csrfToken={csrfToken}
        onCanonicalWork={acceptCanonicalWork}
        onReload={async () => {
          const refreshed = await query.refetch();
          if (refreshed.error) throw refreshed.error;
          if (!refreshed.data) throw new Error('重载发布工作台后未返回 Context');
          return refreshed.data;
        }}
      />
    </section>
  );
}

function ContextValue({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs' : 'break-words text-text-primary'}>{value}</dd>
    </div>
  );
}

function VerificationStatus({ context }: { context: PublicationWorkspaceContext }) {
  const { work } = context;
  const latest = work.verifications.at(-1);
  if (work.status === 'COMPLETED') {
    return (
      <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
        <p className="font-medium text-success">核验通过，发布成果已冻结为只读。</p>
        <p className="break-all">PublishedArticle ID：<span className="font-mono">{work.id}</span></p>
        <a className="text-primary underline underline-offset-2" href={`/publishing/articles/${work.id}`}>
          前往发布成果详情
        </a>
      </div>
    );
  }
  if (work.status === 'ACTION_REQUIRED') {
    if (work.primary_task === 'REGISTER_RESULT') {
      return (
        <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm text-info">
          内容版本已切换，请重新登记真实发布结果后再核验。
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          {latest?.comment || '最近一次核验未通过，请修正内容后复核。'}
        </p>
        <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-2" href={`/content/tasks/${work.task_id}`}>
          打开 Content Task 修正批准内容
        </a>
        {!context.switch_candidate && (
          <p className="text-sm text-text-secondary">服务端尚未提供合法批准候选；本页不会请求或筛选版本列表。</p>
        )}
      </div>
    );
  }
  if (work.available_actions.includes('VERIFY')) {
    return <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm text-info">发布结果已登记，可以开始人工核验。</p>;
  }
  return <p className="text-sm text-text-secondary">当前没有待执行的核验动作。</p>;
}

function primaryTaskLabel(task: string) {
  return {
    CONTINUE_PREPARATION: '继续准备',
    REGISTER_RESULT: '登记发布结果',
    RUN_FIRST_VERIFICATION: '首次核验',
    FIX_AND_REVERIFY: '修复并复核',
    VIEW_COMPLETION: '查看完成情况',
    VIEW_CLOSURE: '查看关闭情况',
  }[task] ?? task;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { PublicationWorkspacePage };
export type { PublicationWorkspacePageProps };
