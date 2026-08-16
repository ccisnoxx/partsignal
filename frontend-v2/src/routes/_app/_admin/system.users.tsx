import { createFileRoute, redirect } from '@tanstack/react-router';

import { userListQueryOptions } from '@/domains/identity/user.api';
import { UserListPage } from '@/domains/identity/user-list-page';
import {
  isCanonicalUserSearch,
  userSearchSchema,
} from '@/domains/identity/user-list.model';
import { RouteError } from '@/design-system/workspace/route-error';

export const Route = createFileRoute('/_app/_admin/system/users')({
  staticData: { navId: 'users', breadcrumb: '用户管理' },
  validateSearch: userSearchSchema,
  search: {
    middlewares: [({ search, next }) => next(userSearchSchema.parse(search))],
  },
  beforeLoad: ({ location, search }) => {
    if (!isCanonicalUserSearch(location.search, search)) {
      throw redirect({ to: '/system/users', search, replace: true });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    const options = userListQueryOptions(deps);
    if (!context.queryClient.getQueryState(options.queryKey)) {
      void context.queryClient.prefetchQuery(options);
    }
  },
  errorComponent: ({ error, reset }) => (
    <RouteError error={error} onRetry={reset} title="用户管理发生意外错误" />
  ),
  component: UserListRoute,
});

function UserListRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { auth } = Route.useRouteContext();
  if (!auth.user) throw new Error('管理员路由缺少当前用户会话');

  return (
    <UserListPage
      csrfToken={auth.csrfToken}
      currentUserId={auth.user.id}
      onAuthChanged={auth.refresh}
      onSearchChange={(nextSearch) => void navigate({ search: nextSearch })}
      search={search}
    />
  );
}
