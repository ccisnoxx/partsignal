# A29 规划审计

## 已确认事实

- final recheck 的唯一 V1 测试失败属于 `frontend/tests/e2e/mvp-flow.spec.ts` 中从 284 行开始的完整业务场景。
- Header 删除步骤先通过唯一 `headerMore` 触发器打开菜单，随后在 452 行使用页面级 `getByRole('menuitem', { name: '删除' })`。
- 失败时该 locator 匹配两个 menuitem，违反 Playwright strict mode；既有证据没有证明产品同时显示两个可交互删除入口。
- 同一文件已经使用 `.ant-select-dropdown:visible` 约束当前 overlay，说明“从当前可见 overlay 取目标”是项目既有测试模式。
- `deploy/scripts/e2e-local.sh` 将参数透传给 V1 Playwright，因此可用现有隔离生命周期定向运行 `tests/e2e/mvp-flow.spec.ts --project=e2e`；runner 在此前仍会执行既有 V2 real-stack，这是其当前合同，不能绕过。

## Owner 判断

权威 owner 是 Header 删除动作的测试 locator，而不是产品按钮、菜单 label 或 API。最小修复应让 locator 绑定当前可见菜单根节点并保留精确 `menuitem`/`删除` 语义。

禁止用 `.first()`、`.last()` 或 force 选择任意命中项；这些做法会隐藏 overlay 生命周期或错误菜单 ownership。

## 验证边界

- 静态：变更只在目标 spec，禁止模式扫描通过。
- package：V1 lint/typecheck。
- 真实行为：使用 A27 两键环境、动态独占 Redis 与现有 runner 运行目标 spec；不直接连接共享服务。
- cleanup：按 runner 的 database/Redis/storage/process/ports 输出与事后只读状态记录。
- 不运行根 `make e2e` 或 `make verify`；最终集成由 A29/A30 都关闭后的新独立 recheck 决定。

## 执行证据

- 启动候选为 clean `main` 的 `38402dd4377378f85293209de10365087be37713`；原 Phase 8 候选 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce` 是其祖先。
- 唯一测试改动将 Header 删除 locator 收敛为当前可见 `.ant-dropdown-menu:visible` 内 exact `menuitem`/“删除”；原 Dialog、取消、焦点恢复和后续业务断言保持不变。
- `npm --prefix frontend run lint`：exit `0`，耗时 `4.55s`。
- `npm --prefix frontend run typecheck`：exit `0`，耗时 `3.46s`。
- E2E 子进程与 `.env` 的键交集精确为 `DATABASE_URL,REDIS_URL`；Redis logical DB 由实时扫描动态选为 `7`，非硬编码，现有 preflight exit `0`、耗时 `0.073s`。
- `deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts --project=e2e` 只运行一次：V2 real-stack `16 passed / 0 failed / 0 skipped` (`1.3m`)，V1 目标 spec `3 passed / 0 failed / 0 skipped` (`1.2m`)；runner exit `0`，总耗时 `162.208s`。
- Cleanup：database `status=dropped`；Redis 精确删除 `1` 个 allowlisted key 后为空、无外部 client；storage `status=removed`；services 全部 stopped 并 waited；`8000/9001/5173/4173/4174/19009` 全部 released。
- 观察输出中 database URL 精确值命中 `0`、签名 URL 命中 `0`；Redis 连接类别命中 `2`，属于仍开放的 A30 owner。连接值没有写入本 Task evidence，且未宣称存在全局 secret scanner。
- 未运行根 `make e2e`、`make verify` 或 V2 fixture 全集；未修改产品、runner、合同、spec、07/08 或 A30 artifacts，未开始 Phase 9。

## 判定

A29=`CLOSED`。Phase 8 继续为 `NOT_MET`，当前唯一开放 blocker 为 A30；A29 不触发新的 Exit Gate recheck。
