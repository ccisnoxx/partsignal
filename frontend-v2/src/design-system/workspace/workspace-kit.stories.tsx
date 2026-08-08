import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';
import { DetailSection } from '@/design-system/workspace/detail-section';
import { StickyActionBar } from '@/design-system/workspace/sticky-action-bar';
import { Timeline } from '@/design-system/workspace/timeline';
import { WorkspaceShell } from '@/design-system/workspace/workspace-shell';

const actions = [
  { key: 'save', label: '保存草稿', intent: 'secondary' as const, enabled: true, onSelect: fn() },
  { key: 'submit', label: '提交审核', intent: 'primary' as const, enabled: true, onSelect: fn() },
];

function ContextPane() {
  return (
    <DetailSection description="工作流上下文由调用方提供" title="上下文">
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-text-muted">对象</dt><dd className="font-medium">PS-1042</dd></div>
        <div><dt className="text-text-muted">Revision</dt><dd className="font-medium">7</dd></div>
      </dl>
    </DetailSection>
  );
}

function ArtifactPane({ loading = false, error = false }: { loading?: boolean; error?: boolean }) {
  if (loading) {
    return (
      <DetailSection description="上下文和参考信息仍可使用" title="正文加载中">
        <div className="space-y-3" aria-label="正文加载中" role="status">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DetailSection>
    );
  }
  if (error) {
    return (
      <DetailSection title="正文暂时无法加载">
        <p className="mb-4 text-sm text-text-secondary">请求失败，当前工作区结构仍保持可用。</p>
        <Button onClick={fn()} variant="outline">重试</Button>
      </DetailSection>
    );
  }
  return (
    <>
      <DetailSection description="Markdown 是唯一可编辑正文" title="事实正文">
        <div className="min-h-80 rounded-lg border border-border-subtle bg-surface-raised p-4 font-mono text-sm leading-6">
          # 电气特性<br /><br />额定工作电压为 5V，工作温度范围为 -40°C 至 85°C。
        </div>
      </DetailSection>
      <StickyActionBar actions={actions} status="已保存 · Revision 7" />
    </>
  );
}

function ReferencePane({ empty = false }: { empty?: boolean }) {
  return (
    <DetailSection title="参考与历史">
      <Timeline
        emptyMessage="暂无参考资料"
        items={empty ? [] : [
          { id: '2', title: '已提交审核', description: '内容工程师提交', meta: '10:30' },
          { id: '1', title: '创建草稿', description: '从产品资料初始化', meta: '09:15' },
        ]}
      />
    </DetailSection>
  );
}

type WorkspaceStoryProps = { loading?: boolean; error?: boolean; emptyReference?: boolean };

function WorkspaceStory({ emptyReference, error, loading }: WorkspaceStoryProps) {
  return (
    <main className="min-h-screen bg-surface-app p-4">
      <h1 className="sr-only">Workspace Kit</h1>
      <WorkspaceShell
        ariaLabel="Product Facts 工作区示例"
        context={{ label: '上下文', content: <ContextPane /> }}
        main={{ label: '正文', content: <ArtifactPane error={error} loading={loading} /> }}
        reference={{ label: '参考', content: <ReferencePane empty={emptyReference} /> }}
      />
    </main>
  );
}

const meta = {
  title: 'Design System/Workspace Kit',
  component: WorkspaceStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultWorkspace: Story = {
  name: 'Default Workspace',
  args: {},
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};

export const LoadingArtifact: Story = { name: 'Loading Artifact', args: { loading: true } };
export const EmptyReference: Story = { name: 'Empty Reference', args: { emptyReference: true } };
export const ErrorRetry: Story = { name: 'Error + Retry', args: { error: true } };

export const DestructiveAction: Story = {
  name: 'Destructive Action',
  render: () => (
    <main className="min-h-96 bg-surface-app p-6">
      <h1 className="sr-only">Destructive Action</h1>
      <StickyActionBar
        actions={[{
          key: 'delete',
          label: '删除草稿',
          intent: 'danger',
          enabled: true,
          confirmation: { title: '删除草稿？', description: '此操作无法撤销。', confirmLabel: '确认删除' },
          onSelect: fn(),
        }]}
        status="危险动作需要二次确认"
      />
    </main>
  ),
};

export const Mobile375: Story = {
  name: 'Mobile 375',
  args: {},
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};
export const Tablet768: Story = {
  name: 'Tablet 768',
  args: {},
  parameters: { viewport: { defaultViewport: 'tablet768' } },
};
export const Desktop1024: Story = {
  name: 'Desktop 1024',
  args: {},
  parameters: { viewport: { defaultViewport: 'desktop1024' } },
};
export const Desktop1440: Story = {
  name: 'Desktop 1440',
  args: {},
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};
