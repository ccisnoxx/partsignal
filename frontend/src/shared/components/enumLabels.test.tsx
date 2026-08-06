/** 验证稳定业务状态使用统一中文显示文本。 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from './StatusTag';

describe('中文状态显示', () => {
  it('统一显示内容来源与业务状态', () => {
    render(<>
      <StatusTag status="AI" />
      <StatusTag status="DRAFT" />
      <StatusTag status="PENDING_REVIEW" />
      <StatusTag status="CHANGES_REQUESTED" />
      <StatusTag status="APPROVED" />
      <StatusTag status="SUPERSEDED" />
      <StatusTag status="ABANDONED" />
    </>);

    expect(screen.getByText('AI 生成')).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
    expect(screen.getByText('待审核')).toBeInTheDocument();
    expect(screen.getByText('需修改')).toBeInTheDocument();
    expect(screen.getByText('已批准')).toBeInTheDocument();
    expect(screen.getByText('已取代')).toBeInTheDocument();
    expect(screen.getByText('已放弃')).toBeInTheDocument();
  });
});
