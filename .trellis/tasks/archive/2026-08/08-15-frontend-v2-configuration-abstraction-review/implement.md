# Frontend V2 Phase 6 Configuration 抽象回顾与 Exit Gate 审计实施计划

## Status

`planning`。本文件经用户批准前不得运行 `task.py start`、创建实施分支或修改生产代码。

## 0. Start gate after approval

1. 再次运行 `trellis-start`/current context，确认当前 Task 指向本目录。
2. 确认主工作区位于最新 clean `main`，本规划提交已在 `main`，且没有未识别 dirty files。
3. 按 Frontend V2 例外创建 `codex/frontend-v2-configuration-abstraction-review` 临时分支。
4. 读取 `trellis-before-dev` 与当前 `prd.md`、`design.md`、`implement.md`，再执行 `task.py start`。
5. 不 dispatch implement/check sub-agent；本会话直接实施和检查。

## 1. Build the evidence matrix before editing

创建 `research/audit.md`，完整读取 Configuration production files，并搜索全部 caller/test 后记录：

1. Platform List/Workspace/Accounts/Type 的 route、model、API、page、cache consumer 与测试；
2. Prompt Library/Editor/Preview 的 shared list key、dirty/revision、GenerationJob handoff 与测试；
3. AI Channel List/Core/Models/Runtime 的 conditional URL、shared form owner、secret、revision、action、Usage/Logs/Audit 与测试；
4. Design System primitives/patterns 的真实消费者与 domain-local 重复；
5. OpenAPI/generated/backend projection 与 docs/ADR/spec 的一致性；
6. 最近 real-stack evidence 的覆盖范围、候选基线和可复用条件。

每个 P0/P1/P2 finding 必须先验证根因与全部行为不同的 caller；P3 只记录。完成矩阵前不改生产代码。

## 2. Decide the smallest correction set

- 若没有 open P0/P1/P2：跳过生产代码和测试修改，直接进入文档与 Exit Gate。
- 若有 finding：逐项按 `删除 -> 复用 -> root owner 局部修正 -> 已获证据的最小共享抽象` 处理。
- 修改 exact owner 前重新完整读取该文件、相关 generated types、全部 callers 与现有 tests。
- 每项非平凡修复只补一个最小稳定边界回归；不建立通用 harness 或按私有调用结构写测试。
- 若需要公共 API、数据库、权限、部署、依赖或新产品行为：停止，更新 audit 为 blocker，返回 planning。

## 3. Implement verified findings only

允许的实施顺序：

1. contract/model invariant（仅现有合同内）；
2. query key/action/error/cache owner；
3. page/component/route composition；
4. colocated model/component regression；
5. 删除被新 owner 取代的旧代码。

不得夹带 Phase 7、全局 Settings framework、文件拆分、命名清理或与 finding 无关的格式化。

## 4. Update authoritative evidence and docs

1. 将 `research/audit.md` 的 finding 更新为 closed/open，并写入实际验证。
2. 更新 `docs/frontend-v2/07-migration-plan.md` 的 Phase 6 进度和最终 gate。
3. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md` 的抽象回顾与当前候选证据。
4. 仅在新稳定决策或既有 ADR 漂移时更新 `09-architecture-decisions.md`；仅在可跨 Task 复用时更新 frontend spec。
5. 对照实现确认 OpenAPI/generated types/database docs 无漂移；没有合同或数据模型变化时不修改根 contracts。

## 5. Required validation

### 5.1 Direct Configuration behavior

先运行能直接覆盖本 Task 变更的 Configuration model/component tests：

```bash
npm --prefix frontend-v2 run test -- src/domains/configuration
```

若修改 Design System 或跨域 public query owner，只追加对应最小 test file；不得机械扩大为无关 suite。

### 5.2 Static, contract and production artifact

```bash
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
make contract-check
git diff --check
```

### 5.3 Final Phase 6 current-candidate gate

在所有 finding 关闭、文档一致且环境 preflight 满足后，只对最终候选运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

该命令必须实际覆盖：

- backend/V1/V2 contract、lint、typecheck、unit、integration 与 build；
- Configuration real-stack 和其他既有 V2 real-stack flows；
- V1 E2E 与 V2 全部 fixture E2E，包括 Platform、Prompt、AI Channel 九个 Phase 6 specs；
- Compose dev/prod config；
- real-stack PostgreSQL、Redis、storage、进程与端口 cleanup。

不得从 `.env` 批量导出无关变量；只提供门禁明确需要的宿主机 PostgreSQL source URL 与独占 Redis URL。记录总退出码、各套通过/失败/跳过数、耗时和 cleanup 标记。

### 5.4 Documentation and diff review

- 逐项对照 audit matrix、`07/08/09`、frontend specs、OpenAPI/generated types 与最终 diff。
- 检查无 symptom patch、重复 owner、hidden fallback、broad catch/default、第二状态源、dead code、弱测试或无关修改。
- 确认 `git status --short` 只包含本 Task 已识别文件。

## 6. Failure attribution and repair loop

- 任一失败先判断是否由本 Task、当前环境、既有无关缺陷或 flaky 证据造成。
- 只有代码、配置或环境发生足以影响结果的变化后才重跑同一失败命令。
- 只修复可归因于本 Task 且在授权范围内的问题；范围外 blocker 记录到 audit，Phase 6 保持 `NOT_MET`。
- 不改测试来迁就错误行为，不以历史通过结果覆盖当前失败。

## 7. Optional validation

仅在 required finding 或 diff 指向对应边界时追加：

```bash
npm --prefix frontend-v2 run build-storybook
make test-deploy-scripts
```

- `build-storybook` 仅在修改 Design System story/primitive 时运行。
- `test-deploy-scripts` 仅在经重新规划批准修改部署脚本时运行；当前默认不触发。
- 真实云 Provider 不属于本 Task；本机真实协议 Provider 是确定性 gate。

## 8. Exit Gate decision

最终在 `research/audit.md` 与本文件记录：

| Category | Required evidence | Result |
| --- | --- | --- |
| Product | Phase 6 路由、心智模型、主要行为与服务端动作一致 | `MET` |
| Engineering | targeted checks 与 `make verify` 当前候选通过 | `NOT_MET`：范围外 V2 unit 10 failures |
| UX / Accessibility | strict fixture 四档、键盘、焦点、错误/dirty/revision | `MET` |
| Architecture | 单一 owner、依赖方向、无过度抽象/第二状态源 | `MET` |
| Contract / Data Integrity | OpenAPI/generated/runtime、revision、secret、real-stack 一致 | `MET` |
| Documentation | code/contracts/tests/docs/spec 同步 | `MET` |

只有六项全部 `MET` 且 open P0/P1/P2 为 0，才能把 Phase 6 标记 `MET`。

## 9. Commit, merge and archive plan

实施和 required validation 完成后先向用户展示：

- findings 与处置结果；
- 精确 changed files 和 diff 摘要；
- 实际 validation/cleanup 结果；
- Phase 6 gate 结论；
- 精确 commit plan。

获得提交确认后：

1. 只 stage 本 Task 文件并复核 staged diff；
2. 建议单提交：`refactor(frontend-v2): close configuration abstraction gate`；若最终无生产代码变化，改为 `docs(frontend-v2): close configuration exit gate`；
3. 不 push、不创建 PR；
4. 按 Trellis finish-work 完成归档，经确认 fast-forward 合入 `main`；
5. 删除临时分支，不自动创建或实施 Phase 7 Task。

## 10. Stop conditions

- 公共 API、数据库、权限、部署、依赖或新产品行为成为必要条件；
- 发现未识别 dirty files 与本 Task 重叠；
- secret 已进入 artifact，且无法在当前既有 owner 内安全关闭；
- 当前候选 `make verify` 暴露范围外 blocker。

以上情况均停止扩大范围，保存证据并请求新授权；不得用 fallback 或降低 gate 继续。

## 11. 实施与验证结果（2026-08-15）

### 11.1 已实施

- F-01：AI Channel 干净配置表单接收后台 canonical channel 时同步 `draftBaseline`，保证下一次编辑提交新 revision；dirty 草稿继续冻结旧 baseline。
- F-02：AI Channel List 成功启停/删除后精确失效 Detail、Models、Logs，删除时额外移除 Detail、Models、Usage root 与 Logs root。
- 新增两条最小页面回归；没有新增抽象、依赖、公共 API、数据库、权限、部署或业务能力。
- 更新 `07`、`08` 与 `research/audit.md`；ADR、frontend specs、OpenAPI、generated schema 和数据库文档无需变化，因为既有稳定决策与合同未改变。

### 11.2 Required validation

| 检查 | 实际结果 |
| --- | --- |
| Configuration targeted | `12 files / 81 tests passed` |
| V2 api:check / typecheck / lint / production build | 全部通过；build 仅有既有 chunk-size warning |
| contract-check / git diff check | 全部通过 |
| 最近归档 Configuration real-stack | V2 `13 passed` + 指定 V1 `5 passed`，合计 `18 passed`、退出码 `0`；secret/trace/cleanup clean |
| 当前候选唯一一次 `make verify` | 失败：V2 unit `4 failed / 69 passed files`、`10 failed / 416 passed tests`；此前 backend unit `193 passed`、V1 unit `205 passed`、visual contract `24 passed` |

### 11.3 Failure attribution 与 Gate

- `frontend-v2/src/styles/global.test.ts` 7 条：现有测试要求 token 全文件唯一，但 `global.css` 的 print media 已有第二套高对比 token；两文件相对基线无 diff。
- Product Detail 1 条：测试的 level-2 heading 顺序未包含既有 `GEO`、`业务配置` 导航组；production/test 相对基线无 diff。
- Content Editor 1 条、Publication Workspace 1 条：测试使用单元素文本查询，但当前 production UI 各渲染两个同文案元素；production/test 相对基线无 diff。
- 门禁在 V2 unit 停止，未启动 integration/build/E2E，因此没有本次 E2E 资源或 cleanup 状态可报告，也不允许用历史结果冒充当前候选完整通过。
- Configuration 自身 open P0/P1/P2 为 `0`，但 Engineering 为 `NOT_MET`；Phase 6 Exit Gate 最终为 `NOT_MET`。依据 stop condition，本 Task 不越权修复 Product/Content/Publication/Design System owner，也不在环境未变化时重跑同一门禁。
