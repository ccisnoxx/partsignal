# 移动端触控目标与审计空态实施计划

## 阶段 A：建立定向回归

- [x] 在 `auth-session.spec.ts` 增加登录四控件的真实几何断言：320px/375px `>= 44px`，768px/1440px 保持 32px。
- [x] 在 `system-audit.spec.ts` 使用现有确定性筛选制造空结果，并增加 320px/375px 的空态/region 初始可见几何断言。
- [x] 断言审计页面根无横向溢出，空态重置动作可见且可聚焦。

## 阶段 B：最小实现

- [x] 在 `LoginPage` 的用户名、密码、显示/隐藏密码和提交控件加入 `h-11 md:h-8`，不修改共享 primitive。
- [x] 在 `global.css` 的移动 table media query 中增加 `audit-list-table` 局部收窄规则，覆盖 table 与 primary 列的移动宽度。
- [x] 对实际 diff 执行 touched-scope 文档检查；本次没有新增非显然逻辑，注释、docstring、日志与开发者可见错误文案均有意保持不变。

## 阶段 C：Required Validation

- [x] `npm --prefix frontend run test -- src/domains/auth/login-page.test.tsx src/domains/audit/system-audit-page.test.tsx`
- [x] `npm --prefix frontend run lint`
- [x] `npm --prefix frontend run typecheck`
- [x] `npm --prefix frontend run e2e -- tests/e2e/auth-session.spec.ts tests/e2e/system-audit.spec.ts`
- [x] `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-mobile-touch-target-audit-empty-state`
- [x] 检查 `git diff --check`、本任务 diff、当前 Task 与任务外 dirty/index 基线，确认只包含授权文件。

说明：目标 E2E 通过 Playwright 配置的 webServer 执行 `npm run build` 并启动 production preview，因此该命令同时提供 production build/preview 证据；不再重复运行独立 `npm run build`。

## 阶段 D：Review、提交与收尾

- [x] 使用独立只读 Review 核对移动几何、共享 owner、非空/桌面回归与范围边界；Review 无 material finding。
- [x] 汇总 required validation、实际未运行项、diff 与残余风险，向用户提交 commit plan；等待提交确认。
- [ ] 仅路径受限暂存并提交本 Task 的代码、测试和任务文档，不带入既有 artifacts staged deletions、`.gitignore` 或 `backend/app/schemas/configuration.py`。
- [ ] 用户授权后按 `trellis-finish-work` 归档本 Task 并记录 journal；归档前后确认其他 Task 未被修改。

## 实际验证结果（2026-09-03）

- 定向 Vitest：2 files passed，9 tests passed，0 failed。
- frontend lint：通过，0 warnings。
- frontend typecheck：通过。
- 定向 production-artifact Playwright：18 tests，17 passed，1 skipped；唯一 skip 是 desktop project 中按设计跳过的移动专属审计空态用例。两个 project 均覆盖，E2E webServer 的 production build/preview 成功。
- Playwright build 输出既有 chunk-size warning；不影响退出码，且本 Task 未改变 bundling、依赖或构建配置。
- Trellis Task context validation 与 `git diff --check`：通过。
- 独立只读 Review：无 material finding；确认移除任一产品修复都会令对应浏览器几何回归失败。
- 任务外基线保持：543 项 staged artifacts 删除 hash 为 `b9c0e20aaabc3e8bc392aa00e11a427ab42228b4e5d2c96dc6cd18b1408c23b4`；`.gitignore` 与 `backend/app/schemas/configuration.py` diff hash 为 `8f3cd5493f77e53ff9513a77ab8cc5212e5dabe96f84ccfc80db14670a08bc87`。

## Optional Validation（默认 NOT_RUN）

- [ ] `npm --prefix frontend run test`：完整 frontend Vitest；定向组件测试已覆盖本次行为，除非定向失败指向共享回归，否则不运行。
- [ ] `npm --prefix frontend run e2e`：完整 frontend Playwright；本次只改变登录页局部高度与审计 feature-table 移动规则，两个定向 spec 已覆盖受影响路径。
- [ ] `make verify`：仓库级 backend/frontend/contract 全门禁；本任务不触及公共合同、generated client、backend、数据库或跨模块状态。
- [ ] 公网部署后复验：本任务不部署且用户明确暂不修改旧管理员密码，因此不登录公网；待独立部署/验收授权后再执行。

## 完成定义

- 两项 P2 的浏览器几何回归与既有行为回归均通过。
- 变更严格限制在登录页、审计移动 table rule、对应测试和本 Task 文档。
- 未运行的 optional suites 记录为 `NOT_RUN` 及原因，不写成通过。
- 第二个 Prompt Task 仍未启动；`integrity-error-domain-mapping` 未创建或启动。
