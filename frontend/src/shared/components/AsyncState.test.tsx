/** 验证共享查询状态对用户暴露可恢复错误和服务端追踪信息。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { QueryFailure, QueryLoading } from './AsyncState';

describe('AsyncState', () => {
  it('展示服务端错误码和请求 ID，并允许重试', async () => {
    const onRetry = vi.fn();

    render(<QueryFailure error={new ApiError('服务暂不可用', 'UPSTREAM_TIMEOUT', 'req-42')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('服务暂不可用');
    expect(screen.getByText(/UPSTREAM_TIMEOUT/)).toHaveTextContent('请求 ID：req-42');
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('为加载态提供可读名称和忙碌状态', () => {
    render(<QueryLoading label="正在加载发布记录" />);

    expect(screen.getByLabelText('正在加载发布记录')).toHaveAttribute('aria-busy', 'true');
  });
});
