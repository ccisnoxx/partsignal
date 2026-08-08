import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/')({
  staticData: { navId: 'workbench', breadcrumb: '工作台' },
  component: WorkbenchFoundation,
});

function WorkbenchFoundation() {
  return (
    <section className="space-y-2">
      <h1 className="type-page-title">工作台</h1>
      <p className="text-text-secondary">App Shell 与路由元数据基础已就绪。</p>
    </section>
  );
}
