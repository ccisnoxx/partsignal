# 前端失败恢复与全 UI 验收实施计划

## 实施步骤

1. **依赖盘点**
   - [ ] 列出任务、事实、发布、审核和 GEO 页面所有必需查询及提交门禁。
   - [ ] 建立 mutation → query invalidation 矩阵。
2. **共享状态原语**
   - [ ] 为 `QueryFailure` 增加重试、错误码和 request ID 展示。
   - [ ] 增加无权限状态；保留小而明确的加载组件。
   - [ ] 不创建根据空数组猜业务原因的通用空状态组件。
3. **领域空状态与路由**
   - [ ] 各页面补齐 500、403、空数据和前置入口。
   - [ ] 将发布详情、发布异常详情/修复、事实版本、GEO 筛选/更正改为可恢复路由。
   - [ ] 依赖未成功时禁用提交。
4. **查询一致性**
   - [ ] 增加参数化 query-key 定义。
   - [ ] 按失效矩阵更新跨 feature mutation。
   - [ ] Dashboard 只链接服务端定义的筛选，不本地重算。
5. **组件测试**
   - [ ] 关键依赖分别覆盖 loading、500、403、empty 和 success。
   - [ ] 验证 retry、前置导航、提交禁用和刷新恢复。
6. **全 UI E2E**
   - [ ] 明确 fixture 与被验收步骤的代码边界。
   - [ ] 从创建内容任务开始全程走 UI 完成主闭环。
   - [ ] 覆盖平台一致性、审核证据、自动完成、发布异常、修复、GEO 更正和 Dashboard 深链。
7. **最终收口**
   - [ ] 清理被新路由和状态原语替代的局部重复逻辑。
   - [ ] 更新前端 README、测试文档和父任务验收映射。

## 验证命令

```bash
cd frontend
npm test
npm run lint
npm run typecheck
npm run build
npm run e2e
```

最终从仓库根运行：

```bash
make contract-check
make e2e
make verify
```

## 验收矩阵

- 每个关键页面：loading / 500 + retry / 403 / empty + 前置入口 / success。
- 每个写表单：任一必需依赖失败时不可提交。
- 每个深链：刷新后资源 ID、筛选和操作上下文保持。
- 每个跨域 mutation：相关任务、发布、异常、GEO 和 Dashboard 缓存同步刷新。

## 回滚点

- 路由变更导致不可恢复时停止前端发布，不增加双路由兼容层。
- E2E 需要 API 绕过才能通过时视为产品流程缺陷，回到对应领域子任务修复。

## Goal 4 完成门禁

- [ ] 每个关键页面具有 loading、500+retry、403、empty+前置入口和 success 组件测试。
- [ ] QueryFailure 展示错误码和 request ID；PermissionDenied 不伪装成空数据。
- [ ] 任一必需依赖未成功时表单提交按钮不可用，直接调用提交处理也会被阻止。
- [ ] 深链刷新恢复相同资源、筛选和操作上下文。
- [ ] 从内容任务创建开始的完整 Playwright 流程没有 `page.request` 业务动作。
- [ ] 真实 PostgreSQL、Redis、Celery Worker/Beat 和 OpenAI-compatible HTTP 替身参与 E2E。
- [ ] 运行前端测试、lint、typecheck、build、Playwright，以及根目录 `make contract-check` 和 `make verify`。
- [ ] 完成后停止；不自动提交、推送或进入 Goal 5。
