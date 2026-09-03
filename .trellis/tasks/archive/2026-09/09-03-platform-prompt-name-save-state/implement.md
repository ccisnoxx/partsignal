# Platform Prompt 名称保存状态实施计划

## 阶段 A：建立定向回归

- [x] 在 `prompt-workspace-page.test.tsx` 增加未绑定 Prompt 名称单独编辑用例，覆盖 dirty、保存资格、无影响 Dialog、exact PUT 与 canonical reset。
- [x] 在 `prompt-workspace.spec.ts` 增加“新建后只改名称”production-artifact 用例，覆盖 mobile/desktop 两个项目。
- [x] 明确记录当前 HEAD 下历史竞态不是稳定本地 red；测试只验证必须长期成立的行为，不伪造失败时序或断言实现细节。

## 阶段 B：最小实现

- [x] 在 `PromptEditor` 首个 render 无条件读取 `isDirty` 与 `isValid`，使 React Hook Form Proxy 始终登记保存资格所需订阅。
- [x] 让 `canSave` 与 disabled reason 消费已订阅的局部状态，不改变 schema、提交、权限、pending、conflict 或 revision 流程。
- [x] 执行 touched-scope 文档检查；产品代码变更是自解释的状态解构，未新增机械注释、日志或开发者可见文案；非显然订阅约束已写入 frontend 状态规范。

## 阶段 C：Required Validation

- [x] `npm --prefix frontend run test -- src/domains/configuration/prompt-workspace-page.test.tsx`
- [x] `npm --prefix frontend run lint`
- [x] `npm --prefix frontend run typecheck`
- [x] `npm --prefix frontend run e2e -- tests/e2e/prompt-workspace.spec.ts`
- [x] `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-platform-prompt-name-save-state`
- [x] 检查本 Task 文档 trailing whitespace、`git diff --check`、本任务 diff、当前 Task 和任务外 dirty/index 基线。

说明：定向 Playwright 通过 canonical 配置的 webServer 执行 production build + preview，因此不重复运行独立 `npm run build`。记录实际通过/失败/跳过数量；chunk-size warning 若仍存在，只按既有构建警告记录，不写成测试失败。

## 阶段 D：Review、提交与收尾

- [x] 复核实际 diff：无第二套表单状态、命令式 trigger fallback、隐藏错误、公共合同或越界文件变化。
- [x] 汇总 required validation、optional `NOT_RUN`、diff 与残余风险，向用户提交 commit plan 并等待确认。
- [ ] 获得提交授权后，只路径受限暂存 Prompt owner、对应测试和本 Task 文档；不得带入既有 artifacts staged deletions、`.gitignore` 或 `backend/app/schemas/configuration.py`。
- [ ] 用户再授权归档时按 `trellis-finish-work` 归档本 Task 并记录 journal；不 push。

## Optional Validation（默认 NOT_RUN）

- [ ] `npm --prefix frontend run test`：完整 frontend Vitest；单个 Prompt component spec 已覆盖本次表单与相邻保存路径，除非定向失败指向共享回归，否则不运行。
- [ ] `npm --prefix frontend run e2e`：完整 frontend Playwright；定向 Prompt spec 已在 production artifact 上覆盖两个 viewport project。
- [ ] `make verify`：仓库级 backend/frontend/contract 全门禁；本任务不触及公共合同、generated、backend、数据库或跨模块状态。
- [ ] 公网部署后复验：本任务不部署，且用户明确暂不修改旧管理员密码；不登录公网。待独立部署与安全授权后再执行。

## 实际验证结果（2026-09-03）

- 定向 component Vitest：1 file passed，10 tests passed，0 failed，耗时 2.42s。
- frontend lint：通过，0 warnings。
- frontend typecheck：通过。
- 定向 production-artifact Playwright：10 tests passed，0 failed，0 skipped，覆盖 `foundation-mobile` 与 `foundation-desktop`；canonical webServer 完成 production build/preview。
- 新增 E2E locator 初检暴露两处 strict-mode 歧义：先把 dirty 文案限定为 revision 0 精确文本，再把保存按钮限定为 exact accessible name；最终新增用例定向复核 2/2 通过，正式 Prompt spec 10/10 通过。
- Playwright build 输出既有 chunk-size warning；不影响退出码，且本 Task 未修改 bundling、依赖或构建配置。
- Trellis context validation、Task 文档 trailing whitespace 与任务范围 `git diff --check`：通过。
- Trellis 独立质量检查确认产品修复从首个 render 无条件订阅 `isDirty/isValid`，没有第二套状态、`trigger()` fallback、合同/权限/业务 HTTP 变化；其发现的测试 locator 歧义已在限定修复预算内解决。
- 任务外基线保持：543 项 staged artifacts 删除仍在；`.gitignore` 与 `backend/app/schemas/configuration.py` diff hash 仍为 `8f3cd5493f77e53ff9513a77ab8cc5212e5dabe96f84ccfc80db14670a08bc87`。

## 完成定义

- 名称单独编辑从状态订阅到 exact PUT/canonical reset 均有定向回归。
- 变更严格限制在 Prompt Workspace owner、对应测试和本 Task 文档。
- Required Validation 全部通过；未运行的 optional suites 保持 `NOT_RUN` 并写明原因。
- `integrity-error-domain-mapping` 未创建、未启动；任务外 dirty/index 未被清理、恢复或带入提交。
