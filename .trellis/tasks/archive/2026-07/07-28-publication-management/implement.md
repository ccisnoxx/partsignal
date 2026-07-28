# 完善发布管理流程：实施计划

## 前置条件

- [x] `07-28-observation-evidence-management` 已完成通用 FileRecord 生命周期。
- [x] 工作区相关文件的既有未提交改动已识别并保留，尤其是 `frontend/src/app/AppLayout.tsx`。

## 1. 契约与迁移

- [x] 更新 `contracts/database.md`：未公开记录删除资格、事件门禁、附件清理和历史指标边界。
- [x] 更新 `contracts/openapi.yaml`：`PublicationAction.DELETE` 与 DELETE 接口。
- [x] 基于实现时 Alembic head新建事务级发布聚合 DELETE 门禁迁移，不修改旧 revision。
- [x] 运行 `make contract-generate`。

## 2. 后端

- [x] 扩展共享动作投影，以批量资格结果决定是否返回 `DELETE`。
- [x] 实现删除服务：advisory lock、行锁、历史事件、GEO/attention 引用、显式子表删除、安全审计。
- [x] 提交后复用通用 FileRecord 生命周期调度独占附件。
- [x] 新增路由权限、CSRF、204 响应和结构化冲突错误。

## 3. 前端

- [x] 统一“发布管理”页面级命名，保留具体“人工发布”动作。
- [x] 修正发布记录列宽与操作列，只保留一个主入口并展示全部其余服务端动作。
- [x] 为删除、标记已移除、验证失败提供各自确认文案和中文结果反馈。
- [x] 总览“发布需关注”直达 attention Tab，工作台解释触发和处理路径。
- [x] 删除成功后清理 Drawer URL 并失效记录、摘要、候选与相关文件查询。

## 4. 最小验证

```bash
uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -k "publication"
npm --prefix frontend test -- --run src/features/publications/PublicationsPage.test.tsx src/features/dashboard/DashboardPage.test.tsx
make contract-check
make typecheck
make lint
make build
```

必须覆盖：

- PENDING、PLATFORM_REVIEW、从未公开 REJECTED 的可删除与下游引用阻断。
- 任一历史 `PUBLISHED/VERIFIED` 永久阻断，当前 REMOVED 也不能删除。
- 并发删除与 mark-published 只有一个合法结果。
- 直接数据库 DELETE 无事务目标时被拒绝。
- 列表/详情 `available_actions` 一致且无 N+1。
- 独占附件清理、共享附件保留和安全审计。

## 5. Playwright CLI

- [x] 使用真实登录和真实 API，先检查 `requests` 确认代理到 18000。
- [x] 验证导航、页面标题和面包屑均为“发布管理”。
- [x] 验证发布记录所有动作可发现，删除和标记已移除文案不同。
- [x] 验证可删除记录消失，已发布记录没有删除动作。
- [x] 从总览“发布需关注”直达 attention Tab，并完成查看、修复入口和显式解决。
- [x] 检查 1536×1024、1024px、375×812、键盘操作、console 和 requests。

## 回滚点

- 删除资格或触发器反例未通过时不接前端。
- 列表投影出现额外逐行查询时回退到批量资格子查询，不接受前端补算。
- Playwright 仍出现代理 500 时先修正启动参数，不在业务代码加入端口 fallback。
