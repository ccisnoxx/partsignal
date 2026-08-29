import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from './login-page';

afterEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('客户端校验合同边界并聚焦第一个无效字段', async () => {
    const onSubmit = vi.fn();
    render(<LoginPage onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('请输入用户名', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveFocus();
    expect(screen.getByLabelText(/^密码/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('密码至少需要 8 个字符');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('切换密码可见性并提交 trim 后的 exact LoginRequest', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginPage onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const password = screen.getByLabelText(/^密码/);

    await user.type(screen.getByRole('textbox', { name: '用户名' }), '  engineer  ');
    await user.type(password, 'password-123');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      username: 'engineer',
      password: 'password-123',
    }));
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveValue('');
    expect(screen.getByLabelText(/^密码/)).toHaveValue('');
  });

  it('pending 禁止重复提交和编辑', async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));
    render(<LoginPage onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: '用户名' }), 'engineer');
    await user.type(screen.getByLabelText(/^密码/), 'password-123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('button', { name: '登录中…' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '用户名' })).toBeDisabled();
    expect(screen.getByLabelText(/^密码/)).toBeDisabled();
    expect(screen.getByRole('button', { name: '显示密码' })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledOnce();

    resolveSubmit?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled());
  });

  it('服务端拒绝时保留字段并显示明确错误', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('用户名或密码错误'));
    render(<LoginPage onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: '用户名' }), 'engineer');
    await user.type(screen.getByLabelText(/^密码/), 'password-123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('用户名或密码错误');
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveValue('engineer');
    expect(screen.getByLabelText(/^密码/)).toHaveValue('password-123');
  });
});
