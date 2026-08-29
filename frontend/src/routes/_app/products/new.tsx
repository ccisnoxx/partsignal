import { createFileRoute } from '@tanstack/react-router';

import { NewProductPage } from '@/domains/product/new-product-page';

export const Route = createFileRoute('/_app/products/new')({
  staticData: { breadcrumb: '新建产品' },
  component: NewProductRoute,
});

function NewProductRoute() {
  const { auth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  return (
    <NewProductPage
      csrfToken={auth.csrfToken}
      onCancel={() => void navigate({ to: '/products' })}
      onCreated={(productId) => void navigate({ to: '/products/$productId', params: { productId } })}
    />
  );
}
