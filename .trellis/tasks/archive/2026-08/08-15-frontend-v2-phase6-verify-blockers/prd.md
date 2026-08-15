# Frontend V2 Phase 6 verify blocker 修复

## Goal

关闭当前候选 `make verify` 在 Frontend V2 unit 阶段暴露的 10 个阻塞失败，保持既有产品行为、可访问性语义与业务合同不变；随后只对最终候选运行一次完整 `make verify`，以当前证据重新判定 Phase 6 Exit Gate。此 Task 不是 Phase 7 功能开发。

## Confirmed Facts

- 规划开始时主工作区位于 clean `main`，`main` 相对 `origin/main` ahead 219；本 Task 不因此 pull 或 push。
- `.trellis/tasks/archive/2026-08/08-15-frontend-v2-configuration-abstraction-review` 已归档，其归档提交 `3ebd385e` 与后续 journal 提交 `fb52b764` 已在当前 `main`；该 Task 记录 Configuration open P0/P1/P2 为 0。
- 规划开始时没有活动 Trellis Task、目标临时分支和额外 worktree；规划批准后已创建唯一分支 `codex/frontend-v2-phase6-verify-blockers` 并把当前 Task 启动为 `in_progress`。
- 已归档审计的唯一候选 `make verify` 在 V2 unit 阶段以 `4 failed / 69 passed files`、`10 failed / 416 passed tests` 停止；integration、build、E2E 与其 cleanup 未运行，因此 Phase 6 当前为 `NOT_MET`。
- 2026-08-15 本 Task 以四个独立 Vitest 进程复现：
  - `global.test.ts`：`7 failed / 25 passed`，Vitest 300ms；
  - Product Detail：`1 failed / 6 passed`，Vitest 1.54s；
  - Content Editor：`1 failed / 6 passed`，Vitest 1.83s；
  - Publication Workspace：`1 failed / 4 passed`，Vitest 2.11s。

## Requirements

### R1. 关闭 Design System token 测试边界错误

- `:root` 继续是全局 Design System token 的唯一权威声明位置。
- `.geo-insights-print-shell` 在 `@media print` 中的纸张高对比覆盖必须保留；该覆盖只作用于 Print shell，不得扩散到普通 route。
- 测试必须区分全局 token 声明与获批准的 Print 局部覆盖，同时精确锁定允许的 Print override 集合；不得删除唯一性合同或允许任意 scoped duplicate。

### R2. 收紧 Product Detail 标题顺序测试边界

- Product Detail 页面仍按 `摘要 → 基本信息 → 事实 → 内容任务 → 发布成果 → GEO 摘要 → 最近 Activity` 呈现自己的 level-2 headings。
- App Shell 主导航继续按当前权威导航配置呈现 `工作区 / 内容运营 / GEO / 业务配置 / 系统管理`。
- Product Detail 测试只在具名 Detail article 内断言页面章节；不得把全局主导航 heading 写入 domain 页面顺序合同。

### R3. 收紧 Content Editor Diff 测试边界

- Main `内容文档` 的 Diff tab 与 Reference `Server Diff` 继续复用同一服务端 Diff；两处分别支持主任务查看和参考上下文，不删除任一表面。
- 测试在 `内容文档` 语义 region 内断言版本差异和具体 diff line，不使用 `getAllByText`、数组下标或模糊 selector。

### R4. 收紧 Publication Workspace 核验说明测试边界

- ACTION_REQUIRED 的当前核验提示继续显示最近失败说明；Reference `核验历史` 继续保留相同不可变 verification comment。
- 测试在 `发布内容与操作` 语义 region 内断言当前失败提示，并保留 Content Task 修正入口和焦点恢复断言；不得删除历史证据或降低断言强度。

### R5. 重新执行当前候选门禁并更新权威结论

- 四个目标测试通过后，依次运行完整 V2 unit、静态/合同/构建检查；只有这些前置检查全部通过才运行一次最终候选 `make verify`。
- 记录每层实际通过、失败、跳过数量和耗时；完整门禁另记录 PostgreSQL、Redis、临时 storage、进程和固定端口 cleanup。
- 更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`，不修改已归档 Task。
- 只有最终候选 `make verify` 完整通过且 Phase 6 open P0/P1/P2 为 0，才能把 Phase 6 Exit Gate 从 `NOT_MET` 改为 `MET`。

## Acceptance Criteria

- [x] `frontend-v2/src/styles/global.test.ts` 同时证明 `:root` token 唯一和 Print shell override 精确受限，33 tests 全部通过。
- [x] Product Detail 测试只断言 Detail article 的七个章节，现有 7 tests 全部通过且主导航生产代码不变。
- [x] Content Editor 测试在 `内容文档` region 精确断言 Diff，现有 7 tests 全部通过且 Main/Reference 两个 Diff 表面不变。
- [x] Publication Workspace 测试在 `发布内容与操作` region 精确断言失败说明，现有 5 tests 全部通过且当前提示、历史证据、修正链接和焦点行为不变。
- [x] 完整 `npm --prefix frontend-v2 run test` 通过，不再有上述 10 个 blocker。
- [x] `api:check`、typecheck、lint、build、`make contract-check` 与 `git diff --check` 通过。
- [x] 最终候选只运行一次带本机 PostgreSQL source URL 和独占 Redis DB 14 的 `make verify`，实际计数、耗时与 cleanup 证据写入本 Task artifacts。
- [x] `07`、`08` 与当前实现、测试和门禁结果一致；未通过完整门禁时仍明确保持 `NOT_MET`。
- [x] 没有 API、数据库、权限、部署、依赖、产品能力、compatibility fallback、通用测试 helper 或新抽象变化。
- [ ] 提交前展示精确 commit plan 并取得确认；不 push、不创建 PR。
- [ ] 完成归档并 fast-forward 合入 `main` 后删除唯一临时分支。

## Out of Scope

- Phase 7 及任何新页面、字段、动作、状态、权限或产品流程。
- 修改 production 页面以消除本来有不同语义归属的重复文字，或删除 Print 高对比需求。
- API/OpenAPI、数据库、backend、V1、权限、deployment、dependencies、E2E orchestration 或固定端口配置变更。
- 清理其它测试、样式、导航、页面文案、`text-tertiary` 或与当前 10 failures 无关的问题。
- 使用历史通过结果代替当前候选完整门禁，或因新无关 blocker 无限扩大本 Task。

## Affected Contracts

- 产品、API、数据与权限合同不变。
- 测试合同收紧为现有语义 owner：全局 token 与 Print scoped override 分责；domain 页面断言使用 article/Workspace region 边界。
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`、`09-architecture-decisions.md` 与 frontend specs 当前不需修改，因为已批准 Token、Print、Workspace 和导航合同不变。

## Planning Gate Record

- 用户已批准规划，并授权创建唯一临时分支后实施。
- 批准前没有运行 `task.py start`、创建分支或修改 production/test/docs 权威文件。
- 批准后按顺序创建分支、启动 Task、实施与验证；当前未提交、归档、合入或 push。
