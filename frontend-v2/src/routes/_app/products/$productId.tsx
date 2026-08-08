import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/products/$productId')({
  staticData: { breadcrumb: '产品详情' },
  component: ProductDetailFoundation,
});

function ProductDetailFoundation() {
  const { productId } = Route.useParams();
  return (
    <section className="space-y-2">
      <h1 className="type-page-title">产品详情</h1>
      <p className="text-text-secondary">路由参数：{productId}</p>
    </section>
  );
}
