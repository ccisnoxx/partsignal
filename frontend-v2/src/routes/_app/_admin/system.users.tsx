import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/_admin/system/users')({
  staticData: { navId: 'users', breadcrumb: '用户管理' },
  component: UsersFoundation,
});

function UsersFoundation() {
  return (
    <section className="space-y-2">
      <h1 className="type-page-title">用户管理</h1>
      <p className="text-text-secondary">管理员路由边界已就绪；业务页面不在本任务范围内。</p>
    </section>
  );
}
