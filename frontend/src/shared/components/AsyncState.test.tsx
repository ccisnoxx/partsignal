/** 验证共享查询状态对用户暴露可恢复错误和服务端追踪信息。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { NoData, QueryFailure, QueryLoading } from './AsyncState';

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
    render(<QueryLoading label="正在加载发布成果" />);

    expect(screen.getByLabelText('正在加载发布成果')).toHaveAttribute('aria-busy', 'true');
  });

  it('允许业务页面补充恢复动作和空态下一步', async () => {
    const onBack = vi.fn();
    render(<><QueryFailure error={new Error('详情不存在')} actions={<button onClick={onBack}>返回列表</button>} /><NoData description={<span>尚无记录</span>} action={<button>创建记录</button>} /></>);

    await userEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByText('尚无记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建记录' })).toBeInTheDocument();
  });
});
