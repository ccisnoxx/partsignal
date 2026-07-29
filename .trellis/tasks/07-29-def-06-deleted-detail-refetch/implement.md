# DEF-06 实施计划

## 实现

- [x] 在 `AIChannelDetailPage.tsx` 的删除成功回调中，先过滤渠道列表缓存并解除当前路由身份；用 `refetchType: 'none'` 失效已删除详情/模型，不再移除活动 query。
- [x] 在 `AIChannelsPage.tsx` 的列表删除成功回调中应用相同不变量；删除非当前对象不得改变当前路由。
- [x] 在 `PlatformPromptsPage.tsx` 中让删除 mutation 返回删除 ID；先过滤列表缓存，再清理选中项与编辑器身份，并无重取地失效详情。
- [x] 在 `ConfigurationPages.test.tsx` 增加最小回归覆盖：渠道当前/非当前成功、渠道失败、Prompt 成功/失败、两类直接 `NOT_FOUND`、Strict Mode 无重复详情 GET。
- [x] 做 touched-scope 中文注释、错误文本与文档检查；仅在非显然时序处保留必要中文注释。

## 必需验证

```bash
cd frontend
npx vitest run src/features/configuration/ConfigurationPages.test.tsx
npm run typecheck
npm run lint -- --no-warn-ignored
```

若项目 `lint` 脚本不接受附加参数，则运行原始 `npm run lint`，并按失败归因规则只处理本次变更导致的问题。

## 可选验证

```bash
cd frontend
npm test
```

全量测试仅在定向测试暴露共享 query key 或路由回归，或剩余时间足够时运行。本缺陷不修改共享契约、数据库、权限或后端，定向配置页测试与前端 typecheck/lint 是主要完成证据。

## 浏览器检查

- 先搜索现有 Playwright 配置删除流程；仅在已有可复用流程且本地服务可安全运行时执行。
- 不修改已部署环境数据。

## 完成前检查

- [x] diff 不包含其他验收缺陷或用户已有改动。
- [x] 没有 `removeQueries` 作用于仍活动的渠道/Prompt 详情。
- [x] 删除失败路径未被成功态缓存更新污染。
- [x] 普通直接 URL 的 `NOT_FOUND` 未被吞掉。
- [x] OpenAPI 与数据库文档无需更新，因为公共 API 与删除语义未变化。

## 验证结果

- `npx vitest run src/features/configuration/ConfigurationPages.test.tsx --reporter=verbose`：33 项通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- 本地 Playwright AI 渠道闭环：2 项通过（含共享数据准备）；删除后刷新列表且未 GET 已删除详情或模型。
- `git diff --check`：通过。
