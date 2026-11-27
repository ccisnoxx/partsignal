import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { FilterChipsBar } from '@/design-system/data-table/filter-chips';
import {
  ComparisonBar,
  CoverageProgress,
  DeltaIndicator,
  ShareBar,
} from '@/design-system/data-viz/data-viz';
import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { PageHeader } from '@/design-system/layout/page-header';
import { SubNavTabs } from '@/design-system/layout/sub-nav-tabs';
import { Button } from '@/design-system/primitives/button';
import { MetadataDisclosure, MetadataList } from '@/design-system/primitives/metadata-disclosure';

function LayoutPrimitivesShowcase() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 bg-surface-app p-6">
      <PageHeader
        actions={(
          <>
            <Button type="button" variant="outline">导出 CSV</Button>
            <Button type="button">新建监测计划</Button>
          </>
        )}
        description="统一页面头部包含主标题、简短说明、元信息与单一主操作槽位。"
        eyebrow="GEO 监测"
        meta={<span>快照时间：2026-08-23 10:30 · 周期：近 30 天</span>}
        title="分析与报告"
      />

      <SubNavTabs
        ariaLabel="GEO 分析页面"
        items={[
          { key: 'overview', active: true, render: (props) => <a href="#overview" {...props}>总览</a> },
          { key: 'answers', active: false, render: (props) => <a href="#answers" {...props}>回答洞察</a> },
          { key: 'reports', active: false, render: (props) => <a href="#reports" {...props}>报告预览</a> },
          { key: 'articles', active: false, render: (props) => <a href="#articles" {...props}>文章关系洞察</a> },
        ]}
      />

      <FilterChipsBar
        items={[
          { key: 'status', label: '状态：已启用', onRemove: fn() },
          { key: 'surface', label: '观测面：ChatGPT Search', onRemove: fn() },
          { key: 'keyword', label: '关键词：TPS5430', onRemove: fn() },
        ]}
        onClearAll={fn()}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <InlineBanner title="只读快照" tone="info">当前报告依据已归档运行生成，不随草稿改动变化。</InlineBanner>
        <InlineBanner title="规则已保存" tone="success">新的阈值版本将在下次运行生效。</InlineBanner>
        <InlineBanner role="status" title="版本变化提示" tone="warning">监测口径在 2026-08-10 有变更，趋势仅供参考。</InlineBanner>
        <InlineBanner
          actions={<Button onClick={fn()} size="sm" type="button" variant="outline">重试</Button>}
          meta="错误码：UPSTREAM_TIMEOUT · 请求 ID：req-9401"
          title="读取失败"
          tone="danger"
        >
          服务暂时不可用，请保留筛选条件后重试。
        </InlineBanner>
      </div>

      <section className="grid gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4 shadow-[var(--shadow-panel)] md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="type-section-title">轻量数据可视化原语</h2>
          <div className="flex flex-wrap items-center gap-2">
            <DeltaIndicator changePoints={0.082} formattedDelta="+8.2 个百分点" />
            <DeltaIndicator changePoints={-0.035} formattedDelta="-3.5 个百分点" />
            <DeltaIndicator changePoints={0} formattedDelta="0.0 个百分点" />
            <DeltaIndicator changePoints={null} formattedDelta="不可比较" />
          </div>
          <ComparisonBar current={0.72} currentLabel="本期 72.0%" previous={0.58} previousLabel="上期 58.0%" />
        </div>
        <div className="space-y-3">
          <ShareBar label="我方品牌提及份额" value={0.44} />
          <CoverageProgress label="目标主题覆盖率（达标）" targetRate={0.6} value={0.74} valueLabel="74.0%" />
          <CoverageProgress label="长尾主题覆盖率（未达标）" targetRate={0.6} value={0.42} valueLabel="42.0%" />
        </div>
      </section>

      <MetadataDisclosure defaultOpen summary="完整维度与版本元信息" summaryMeta="3 项">
        <MetadataList
          items={[
            { label: '单元键', value: 'geo_cell_tps5430_chatgpt', mono: true },
            { label: '口径版本', value: 'metric_v2.3' },
            { label: '样本规模', value: '48 次有效采集' },
          ]}
        />
      </MetadataDisclosure>
    </div>
  );
}

const meta = {
  title: 'Design System/Layout & DataViz Primitives',
  component: LayoutPrimitivesShowcase,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof LayoutPrimitivesShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultDesktop: Story = {
  parameters: { viewport: { defaultViewport: 'desktop1440' } },
};

export const NarrowMobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile375' } },
};

export const LongHeaderTitle: Story = {
  render: () => (
    <div className="max-w-3xl bg-surface-app p-4">
      <PageHeader
        actions={<Button type="button">保存配置</Button>}
        description="超长业务标题与多段说明在较窄容器内应自动换行，不应挤出或裁切右侧主按钮。"
        eyebrow="业务配置 / 监测对象与竞品"
        meta={<span>最近更新：2026-08-23 · 版本 14</span>}
        title="工业电源管理芯片国产替代方案 GEO 监测对象与竞品别名规则管理"
      />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'tablet768' } },
};
