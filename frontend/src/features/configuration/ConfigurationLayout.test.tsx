/** 验证所有配置子路由共用同一个管理员权限边界。 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { ConfigurationLayout } from './ConfigurationLayout';

const authState = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: authState.isAdmin }) }));

beforeEach(() => { authState.isAdmin = true; });

function renderRoute(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/" element={<h1>工作台</h1>} /><Route path="configuration" element={<ConfigurationLayout />}><Route path="*" element={<h1>管理员配置</h1>} /></Route></Routes></MemoryRouter>);
}

test('管理员可以进入任意配置子路由', () => {
  renderRoute('/configuration/ai/channels/channel-1');
  expect(screen.getByRole('heading', { name: '管理员配置' })).toBeInTheDocument();
});

test('普通用户直接访问配置子路由会被重定向到首页', () => {
  authState.isAdmin = false;
  renderRoute('/configuration/audit');
  expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '管理员配置' })).not.toBeInTheDocument();
});
