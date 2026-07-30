# DEF-001 实现计划

## 实现顺序

1. 将 `ConfigurationLayout` 更名为 `AdminRoute`，实现统一 403 页面、返回工作台和初始焦点。
2. 调整 `App.tsx` 与 `routeLoaders.ts`，把全部管理员页面置于同一父路由。
3. 删除审计页、用户页的重复权限重定向和仅为该重定向存在的查询开关。
4. 将旧配置路由测试改为管理员边界测试，覆盖三个代表性 URL、禁止子页面挂载、焦点和键盘返回。
5. 运行定向测试、类型检查和 lint，检查无残留 `ConfigurationLayout` 或页面级管理员重定向。

## Required Validation

```sh
cd frontend
npx vitest run \
  src/app/AdminRoute.test.tsx \
  src/app/AppLayout.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx
npm run typecheck
npm run lint
```

## Optional Validation

```sh
cd frontend
npm test
npm run build
```

## 部署后回归

部署另行授权。使用工程师账号在真实浏览器直达 `/audit`、`/users`、
`/configuration/ai`，确认 403 文案、焦点、返回工作台和零受限业务请求；管理员页面保持正常。
