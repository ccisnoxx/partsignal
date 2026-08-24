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
