# DEF-001 技术设计

## 核心不变量

管理员权限在受限页面挂载前由单一客户端路由边界判断；受限页面本身不维护第二套权限重定向。服务端权限校验保持不变。

## 设计

1. 将现有 `ConfigurationLayout` 收敛并更名为 `AdminRoute`，作为所有管理员路由的父路由。
2. `AdminRoute` 对管理员渲染 `<Outlet />`；对工程师渲染专用 403 内容，不执行导航。
3. 403 内容使用 Ant Design `Result`，外层提供 `role="alert"`、可聚焦容器和“返回工作台”链接；首次渲染后显式聚焦容器。
4. `App.tsx` 把 `/users`、`/audit` 和 `/configuration/*` 放在同一 `AdminRoute` 下。
5. 删除 `AuditLogPage` 和 `UserManagementPage` 的页面级 `<Navigate>`；审计页查询不再依赖 `auth.isAdmin`，因为未获权页面不会挂载。用户页保留 `useAuth` 仅用于当前用户刷新逻辑。
6. 删除旧 `ConfigurationLayout` 名称及测试，路由 loader 同步改名，不保留兼容导出。

## 失败与边界

- 未认证仍由 `ProtectedRoute` 导向登录页。
- 强制改密仍优先于管理员路由。
- 403 页面不调用受限 API；若绕过前端直接调用，服务端仍返回 403。
- URL 查询参数和目标路径保留，便于用户理解被拒绝的位置。

## 合同影响

无 OpenAPI、数据库、后端权限或公开类型变化。
