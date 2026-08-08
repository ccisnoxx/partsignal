import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

const productsSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().catch(1),
});

export const Route = createFileRoute('/_app/products/')({
  validateSearch: productsSearchSchema,
  component: ProductsFoundation,
});

function ProductsFoundation() {
  const { q, page } = Route.useSearch();
  return (
    <section className="space-y-3">
      <div>
        <h1 className="type-page-title">产品</h1>
        <p className="text-text-secondary">当前页码：{page}；搜索词：{q || '无'}</p>
      </div>
      <Link className="text-primary underline-offset-4 hover:underline" to="/products/$productId" params={{ productId: 'router-foundation' }}>
        查看产品详情路由
      </Link>
    </section>
  );
}
