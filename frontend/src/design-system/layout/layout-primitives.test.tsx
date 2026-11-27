import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/design-system/primitives/sheet';

describe('Design System 新增基础组件', () => {
  it('PageHeader 渲染标题、描述、元信息与操作槽位', () => {
    render(
      <PageHeader
        actions={<Button type="button">新建项目</Button>}
        description="统一页面说明文案"
        eyebrow="GEO 分析"
        meta={<span>快照时间：2026-08-23</span>}
        title="GEO 总览"
        titleId="overview-heading"
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'GEO 总览' })).toHaveAttribute('id', 'overview-heading');
    expect(screen.getByText('统一页面说明文案')).toBeInTheDocument();
    expect(screen.getByText('快照时间：2026-08-23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument();
  });

  it('SubNavTabs 为激活项暴露 aria-current=page', () => {
    render(
      <SubNavTabs
        ariaLabel="GEO 分析导航"
        items={[
          {
            key: 'overview',
            active: true,
            render: (props) => <a href="/geo/overview" {...props}>总览</a>,
          },
          {
            key: 'answers',
            active: false,
            render: (props) => <a href="/geo/insights/answers" {...props}>回答洞察</a>,
          },
        ]}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'GEO 分析导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '总览' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '回答洞察' })).not.toHaveAttribute('aria-current');
  });

  it('InlineBanner 按 tone 分配语义 role 与重试操作', () => {
    const { rerender } = render(
      <InlineBanner meta="错误码：INTERNAL · 请求 ID：req-1" title="读取失败" tone="danger">
        请稍后重试
      </InlineBanner>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-banner-tone', 'danger');
    expect(screen.getByText('错误码：INTERNAL · 请求 ID：req-1')).toBeInTheDocument();

    rerender(<InlineBanner tone="info">只读模式提示</InlineBanner>);
    expect(screen.getByRole('status')).toHaveAttribute('data-banner-tone', 'info');
  });

  it('MetadataDisclosure 与 MetadataList 渲染折叠元数据', () => {
    render(
      <MetadataDisclosure summary="完整维度与版本" summaryMeta="2 项">
        <MetadataList
          items={[
            { label: '单元键', value: 'cell-1', mono: true },
            { label: '公式版本', value: 'v2' },
          ]}
        />
      </MetadataDisclosure>,
    );

    expect(screen.getByText('完整维度与版本')).toBeInTheDocument();
    expect(screen.getByText('cell-1')).toBeInTheDocument();
  });

  it('SheetContent 支持尺寸变体与粘性头尾布局', () => {
    render(
      <Sheet open>
        <SheetContent size="xl">
          <SheetHeader>
            <SheetTitle>运行详情</SheetTitle>
          </SheetHeader>
          <SheetBody>正文区域</SheetBody>
          <SheetFooter>底部动作</SheetFooter>
        </SheetContent>
      </Sheet>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-size', 'xl');
    expect(screen.getByText('正文区域')).toBeInTheDocument();
    expect(screen.getByText('底部动作')).toBeInTheDocument();
  });

  it('DataViz 轻量原语保留数值文本与不可比空态', () => {
    render(
      <div>
        <DeltaIndicator changePoints={0.12} formattedDelta="+12.0pp" />
        <DeltaIndicator changePoints={null} formattedDelta="不可比较" />
        <ComparisonBar current={0.75} currentLabel="75.0%" previous={0.5} previousLabel="50.0%" />
        <ShareBar label="提及份额" value={0.42} />
        <CoverageProgress label="目标主题覆盖率" targetRate={0.6} value={0.75} valueLabel="75.0%" />
      </div>,
    );

    expect(screen.getByText('+12.0pp')).toBeInTheDocument();
    expect(screen.getByText('不可比较')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '提及份额' })).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('progressbar', { name: '目标主题覆盖率' })).toHaveAttribute('aria-valuenow', '75');
  });

  it('FilterChipsBar 支持逐项移除与清空全部筛选', async () => {
    const user = userEvent.setup();
    const removeStatus = vi.fn();
    const clearAll = vi.fn();
    render(
      <FilterChipsBar
        items={[
          { key: 'status', label: '状态：已启用', onRemove: removeStatus },
          { key: 'mode', label: '模式：API', onRemove: vi.fn() },
        ]}
        onClearAll={clearAll}
      />,
    );

    await user.click(screen.getByRole('button', { name: '移除筛选：状态：已启用' }));
    expect(removeStatus).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    expect(clearAll).toHaveBeenCalledOnce();
  });
});
