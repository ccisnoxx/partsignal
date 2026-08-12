# Implement — Publishing Vertical Slice 抽象回顾

> 当前状态：已按用户批准完成白名单内实施与验证；等待最终报告后的提交确认。Phase 4 Exit Gate 因已记录的跨层 blocker 与完整门禁失败仍为 `NOT_MET`。

## Phase 0 — Approval and baseline

- [x] 用户批准当前 findings、白名单与 follow-up 拆分。
- [x] 确认主工作区在干净、最新的本地 `main`；基线 commit 为 `96d43693f8f3cb5bb59cc8bd83c3bc8d38186d2a`。
- [x] 重新读取 `prd.md`、`design.md`、`implement.md`、`audit.md` 及相关 frontend specs。
- [x] 按用户明确授权创建临时分支 `codex/frontend-v2-publishing-abstraction-review`，设置 Task branch 并运行 `task.py start`。

## Phase 1 — Independent review unit A: Article conflict

- [x] 在 `published-article-detail-page.tsx` 为 `OPEN_ISSUE` 409 增加 stale/no-replay/reload 流程。
- [x] 保留 dialog 输入；stale 时禁用 submit。
- [x] reload 后只依赖最新 Article 的 `available_actions` / `open_issue_id`。
- [x] 在现有 Article detail test 中证明一次 POST、无 replay、输入保留、显式 reload 与 server token 重判。

## Phase 2 — Independent review unit B: Issue context consistency

- [x] 在 `published-content-issue-workspace-actions.tsx` 的 409 reload 中刷新按需 repair context。
- [x] 只有 Workspace Context 与 repair context 都成功刷新后才清除 stale。
- [x] 在 `published-content-issue-workspace-page.tsx` 对 resolved outcome 穷尽 `RESTORED` / `RETIRED`；null 明确失败。
- [x] 在现有 Issue workspace test 中覆盖 conflict → reload → latest revision/candidates 及 resolved+null。

## Phase 3 — Independent review unit C: local deletion

- [x] 删除无生产消费者的 `publicationCoreActions` 与对应死测试。
- [x] 保留 `publicationWorkspaceActions` 作为实际 Workspace action resolver。
- [x] 删除 `mapPublicationStartError` 这一无语义 public alias，只保留 `mapPublicationError`。
- [x] 更新 Start dialog 与 API tests；未新增 wrapper 或 registry。

## Phase 4 — Required validation for this Task

按失败归因规则运行；同一失败在代码/环境未改变时不重复执行。

```bash
npm --prefix frontend-v2 run test -- --run \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/publication-workspace.model.test.ts \
  src/domains/publication/published-article-detail-page.test.tsx \
  src/domains/publication/published-content-issue-workspace-page.test.tsx

npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/publication-workspace.spec.ts \
  tests/e2e/published-articles.spec.ts \
  tests/e2e/published-content-issues.spec.ts \
  --project=foundation-desktop

git diff --check
```

说明：目标 component tests 直接证明本次行为变化；既有 fixture specs 证明 production artifact、router、浏览器 transport 与主要 Publishing 回归。当前 Task 不修改 backend/contract，因此 backend integration 不作为本 Task 局部修正的替代验证。

## Phase 5 — Follow-up Task before Phase exit

- [ ] 创建并批准 `publication-work-projection-contract-correction`。
- [ ] 修正/确认 Work 非终态 live、终态 frozen snapshot 的投影规则，不包括未定义的 website snapshot。
- [ ] 为 `GET /api/v1/publication-works` 声明可实际返回的 409，并补 runtime/contract regression。
- [ ] 重新生成并检查前端类型；不得添加前端兼容 fallback。

当前 Task 不创建或实施该 follow-up；F-14/F-15 继续作为 Phase 4 blocker，由用户另行批准。

## Phase 6 — Phase 4 Exit Gate validation

所有阻断 finding 关闭后，Phase 退出必须运行完整门禁：

```bash
make e2e
make verify
```

`make verify` 当前包含 `contract-check lint typecheck test-unit test-integration build e2e`；仍单列 `make e2e`，用于明确记录 fixture 与完整 real-stack 的最终 Phase 证据，而不是依赖历史执行记录。若 CI/runtime 成本需要去重，只能在 Trellis 收尾记录中引用同一最终 `make verify` 内成功的 e2e 子阶段，不能跳过该子阶段。

## Optional diagnostics

仅在对应风险出现时运行或新增：

- fixture command method×path 负向检查：出现错误 HTTP method 回归时。
- TableRegion 横向滚动容器断言：出现局部滚动/页面溢出回归时。
- axe 或完整键盘审计：项目新增明确 WCAG 门槛时。
- immutable history 的负向 mutation 测试：出现可修改/删除 API 或历史可变回归时。
- standalone real-stack cleanup：测试从隔离脚本迁移到共享持久 DB 或并行执行时。

## Phase 4 Exit Gate algorithm

对六类 gate 分别计算布尔值：

1. **Product**：三组 URL 与 Work → verification → Article → Issue → repair → resolution 生命周期完成；不包含 GEO/Workbench/Cutover。
2. **Engineering**：lint、typecheck、相关 tests、build、fixture、完整 real-stack、`make verify` 全部通过，且最终代码与被验证 commit 一致。
3. **UX**：direct/refresh/back-forward、canonical search/hash、关键 keyboard/focus、Dialog、responsive root no-overflow、loading/empty/error 均有证据。
4. **Architecture**：server-driven actions、单请求 read-model、无 browser join/第二 DTO/静默 fallback、三资源独立、依赖方向正确、无未批准通用框架。
5. **Contract**：OpenAPI、backend runtime、生成类型、409/no-replay、不可变 snapshot/history 一致；不存在未解决 P0–P2 contract defect。
6. **Documentation**：Phase 4 文档、ADR、Trellis closeout、实际代码与最终验证记录一致。

判定规则：

```text
MET = all(six_categories)
      AND unresolved_P0_P1_P2_findings == 0
      AND final_make_verify_passed
      AND final_fixture_and_real_stack_passed
otherwise NOT_MET
```

历史证据可用于说明范围和回归意图，但不能覆盖最终代码上的失败或未执行门禁。

## Closeout and rollback

- [x] 检查 diff 只包含白名单文件、Task 文档与批准的 migration-plan 状态更新。
- [x] 已记录 Phase 0 rollback point；任一 review unit 可按文件组独立回退，不需要 broad reset。
- [x] 实现未扩展到 backend/contract/Design System/route，主要代码/测试文件保持 10 个白名单文件。
- [x] Gate 为 `NOT_MET`，未把 Phase 4 标记完成；blocker owner 与下一 Task 已记录。

## Execution record — 2026-08-12

Task-specific required validation：

- targeted component/API/model tests：4 files / 22 tests passed；完整 Publication domain：12 files / 48 tests passed。
- `npm --prefix frontend-v2 run typecheck`、`lint`、`build` 全部通过；build 仅有既有 chunk-size warning。
- 三个 Publishing fixture specs（foundation desktop）：11 passed。
- `git diff --check` 通过；`trellis-check` 的规范、依赖方向、重复实现、测试与 diff 自审未发现新增问题。

Phase gate validation：

- 最终代码与恢复后的 npm 依赖布局上重新运行 `make verify`，合同/API check、lint、typecheck、backend unit 177、V1 unit 203 与 visual-contract 24 全部通过；V2 unit 为 281 passed / 1 failed。唯一失败是与本 Task 无关且可稳定复现的 Content DirtyGuard 测试：`src/domains/content/new-content-task-page.test.tsx`；Makefile 因此在 `test-unit` 停止。按失败归因规则未越界修改。
- `make e2e` 已在隔离 PostgreSQL/Redis/对象存储环境运行；Publishing 三条 real-stack flow 全部通过，数据库与临时存储清理成功；完整 real-stack 10 tests 为 9 passed / 1 failed，唯一失败是范围外 `content-ai-real-stack.spec.ts` 的“自然化次数：1”等待超时。由于该失败，Makefile 后续完整 fixture 阶段未执行；本 Task 要求的三个 Publishing fixture 文件已单独全绿。
- F-14 Work snapshot projection 与 F-15 list 409 OpenAPI 声明仍未关闭。因此无论范围外测试是否修复，当前 Phase 4 Exit Gate 都是 `NOT_MET`。

Rollback point：分支基线 `96d43693f8f3cb5bb59cc8bd83c3bc8d38186d2a`；三个 review unit 可按独立文件组回退，不需要 broad reset。
