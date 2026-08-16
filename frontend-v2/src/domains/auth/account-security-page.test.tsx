import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountSecurityPage } from './account-security-page';

afterEach(() => vi.restoreAllMocks());

describe('AccountSecurityPage', () => {
  it('强制改密说明清晰，并按合同校验两个 8 字符边界', async () => {
    const onSubmit = vi.fn();
    render(<AccountSecurityPage mustChangePassword onSubmit={onSubmit} />);
    const user = userEvent.setup();

    expect(screen.getByText('首次登录必须修改临时密码，完成前不能进入业务页面。')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^当前密码/), '1234567');
    await user.type(screen.getByLabelText(/^新密码/), '7654321');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByText('当前密码至少需要 8 个字符', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^当前密码/)).toHaveFocus();
    expect(screen.getByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('新密码至少需要 8 个字符');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('切换两个密码可见性并提交 exact ChangePasswordRequest', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AccountSecurityPage mustChangePassword={false} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const oldPassword = screen.getByLabelText(/^当前密码/);
    const newPassword = screen.getByLabelText(/^新密码/);

    await user.type(oldPassword, 'password-123');
    await user.type(newPassword, 'password-456');
    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(oldPassword).toHaveAttribute('type', 'text');
    expect(newPassword).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      old_password: 'password-123',
      new_password: 'password-456',
    }));
    expect(screen.getByLabelText(/^当前密码/)).toHaveValue('');
    expect(screen.getByLabelText(/^新密码/)).toHaveValue('');
  });

  it('pending 禁止重复提交和编辑', async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));
    render(<AccountSecurityPage mustChangePassword onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^当前密码/), 'password-123');
    await user.type(screen.getByLabelText(/^新密码/), 'password-456');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByRole('button', { name: '修改中…' })).toBeDisabled();
    expect(screen.getByLabelText(/^当前密码/)).toBeDisabled();
    expect(screen.getByLabelText(/^新密码/)).toBeDisabled();
    expect(screen.getByRole('button', { name: '显示密码' })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledOnce();

    resolveSubmit?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认修改' })).toBeEnabled());
  });

  it('服务端拒绝时保留密码字段并显示错误', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('当前密码错误'));
    render(<AccountSecurityPage mustChangePassword onSubmit={onSubmit} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^当前密码/), 'password-123');
    await user.type(screen.getByLabelText(/^新密码/), 'password-456');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByRole('alert', { name: '请修正以下问题' })).toHaveTextContent('当前密码错误');
    expect(screen.getByLabelText(/^当前密码/)).toHaveValue('password-123');
    expect(screen.getByLabelText(/^新密码/)).toHaveValue('password-456');
  });
});
