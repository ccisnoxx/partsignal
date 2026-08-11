# Frontend V2 AppShell Product Detail loader 测试修复 — Implementation Plan

> 状态：已实施最小测试修复；原 V2 blocker 已关闭，但 required `make verify` 被范围外 backend integration 失败阻断，因此 Phase 3 gate 保持 `NOT_MET`，迁移文档未修改。

## 1. 任务分类与启动条件

这是轻量、单一目标测试修复：没有共享合同、production behavior 或模块边界变化，因此不创建 `design.md`。

用户确认本规划后才执行：

1. 确认基线仍指向最新、干净的 `main`，且除本 Task 规划产物外没有未知改动；如基线变化，先只复核相关 diff。
2. 运行 `python3 ./.trellis/scripts/task.py start 08-11-frontend-v2-app-shell-product-detail-loader-test`。
3. 从已确认的 `main` commit 创建临时分支 `codex/frontend-v2-app-shell-product-detail-loader-test`。
4. 读取本 Task `prd.md`、本文件、`research/failure-reproduction.md` 与相关 frontend spec，再开始编辑。

## 2. 最小修改方案

### Step 1 — 仅修复 AppShell 测试数据边界

在 `frontend-v2/src/app/layout/app-shell.test.tsx`：

- 导入 generated `components` 类型并声明合法 UUID `productId`。
- 增加一个由 `ProductDetail` 约束的本文件最小 fixture：完整 product，事实/内容/发布/GEO/Activity 使用合同允许的空投影。
- 在“由 match metadata 激活父级导航并生成详情面包屑”用例内局部 mock `api.GET`，返回 `{ data, response }`。
- 使用 fixture 产品型号的 `h1` 证明详情 route 已完成加载。
- 保留“产品”导航激活和“产品 / 产品详情”面包屑断言。
- 增加单次、精确 endpoint/path 参数断言，确保没有第二条 API 请求。

不提取共享 fixture/helper，不改 `renderRoute` 的全局行为，不 mock Router。

### Step 2 — Required validation

按第 4 节顺序运行。targeted 失败只因 Step 1 相关代码已经变化才允许重跑。任何失败先归因，只修复当前测试缺口导致的失败。

### Step 3 — Phase 3 gate 重判

仅当全部 required validation 通过后，在 `docs/frontend-v2/07-migration-plan.md` Phase 3 当前状态末尾追加本 Task 结果：

- blocker 已关闭；
- targeted、typecheck、lint、`make verify`、`git diff --check` 的实际结果；
- Phase 3 exit gate 当前判为 `MET`。

保留 `frontend-v2-content-abstraction-review` 原段落及其当时 `NOT_MET` 历史结论，不改归档 Task。

### Step 4 — 自审与提交门

- 审查完整 diff，确认仅有批准范围文件与 Trellis Task 产物。
- 确认无 production code、route loader、合同、backend、database、generated schema、V1 或 Publishing 变更。
- 提交前展示 commit plan、文件清单、验证结果与 dirty/unrecognized 文件，等待用户确认；不 push。

## 3. 预计修改文件

### 代码与权威文档

1. `frontend-v2/src/app/layout/app-shell.test.tsx`
2. `docs/frontend-v2/07-migration-plan.md`（仅全部 required validation 通过后）

### Trellis 任务产物

- `.trellis/tasks/08-11-frontend-v2-app-shell-product-detail-loader-test/task.json`
- `.trellis/tasks/08-11-frontend-v2-app-shell-product-detail-loader-test/prd.md`
- `.trellis/tasks/08-11-frontend-v2-app-shell-product-detail-loader-test/implement.md`
- `.trellis/tasks/08-11-frontend-v2-app-shell-product-detail-loader-test/research/failure-reproduction.md`

若实现需要第三个代码/权威文档文件，停止并重新确认范围。

## 4. Required Validation

严格按顺序运行：

```bash
npm --prefix frontend-v2 run test -- src/app/layout/app-shell.test.tsx
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
make verify
git diff --check
```

验证判据：

- targeted AppShell suite 全部通过，且 detail GET 精确单次断言成立；Vitest 无未处理 rejection。
- typecheck 与 lint 零错误、零 warning。
- `make verify` 所有 root targets 全部通过；只有该结果允许文档 gate 改判。
- `git diff --check` 通过，最终 diff 无范围外变更。

不把 build、E2E 或 backend 命令重复列为单独 required command，因为 `make verify` 已覆盖这些门禁；不新增浏览器临时会话。

## 5. Phase 3 Gate 重判规则

### `MET`

必须同时满足：

1. AppShell 目标测试用 generated-type 局部 fixture 完成 Product Detail route 加载。
2. 父级导航与面包屑原目标保持通过。
3. 精确单次 detail GET 证明无额外 API 请求，Vitest 无未处理 rejection。
4. 第 4 节全部 required validation 通过，尤其 `make verify` 零失败。
5. 最终 diff 无 production/contract/backend/generated/V1/Publishing 变更。
6. 迁移计划追加本 Task 的 blocker 关闭与验证证据，历史 `NOT_MET` 结论原样保留。

### `NOT_MET`

任一条件不满足即保持 `NOT_MET`。若 `make verify` 出现新失败，只修复能归因于本测试缺口的失败；其他失败记录证据并停止，不通过扩大范围改判。

## 6. 回滚点

- Git 基线：`8c95e6230eec9dc5b4d1961f9dd494d6a818eb52`。
- 代码回滚：撤销 `app-shell.test.tsx` 的局部 fixture/mock/断言即可；无 production 或数据影响。
- 文档回滚：若最终证据不再满足 `MET`，只移除本 Task 新增的 gate 关闭段落，保留历史段落。
- 不使用 `git reset --hard`、历史改写、兼容层或测试跳过。

## 7. 停止条件

- 需要修改 Product Detail production code、route loader、Router、API/contract、backend、database、generated schema、V1、Publishing 或新增依赖。
- 需要共享 fixture framework 或第三个代码/权威文档文件。
- 同一失败在相关代码/环境没有变化时再次出现且没有新根因证据。
- 工作树出现未知改动，或全量失败无法归因于当前测试缺口。

## 8. 执行与验证结果

### 已实施

- Task 已在 `codex/frontend-v2-app-shell-product-detail-loader-test` 启动。
- `app-shell.test.tsx` 增加 generated `ProductDetail` 约束的最小局部 fixture。
- metadata/navigation 用例局部 mock `api.GET`，以合法 UUID 进入真实 Product Detail route，等待 fixture 产品型号 `h1`，并断言精确单次 detail endpoint/path。
- 原“产品”导航激活和“产品 / 产品详情”面包屑目标保持不变。
- 未修改 production code、route loader、Router、合同、backend、database、generated schema、V1、Publishing 或依赖。

### Required validation 实际结果

| 检查 | 结果 |
| --- | --- |
| targeted `app-shell.test.tsx` | `1 file / 5 tests passed`；无未处理 rejection |
| Frontend V2 typecheck | 通过 |
| Frontend V2 lint | 通过，零 warning |
| `make verify` contract/API/lint/typecheck | 通过 |
| `make verify` backend unit | `176 passed` |
| `make verify` V1 unit / visual contract | `203 passed` / `24 passed` |
| `make verify` V2 unit/component | `35 files / 233 tests passed`；原 AppShell blocker 已关闭 |
| `make verify` backend integration | `86 passed / 1 failed`，因此命令退出 2 |
| `git diff --check` | 通过 |

### 范围外失败归因

失败为：

```text
backend/tests/integration/test_content_task_detail.py::
test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count

sqlalchemy.exc.OperationalError:
psycopg.errors.ObjectNotInPrerequisiteState: 内容任务平台不可原地修改
```

失败发生于 backend integration fixture 提交 `UPDATE content_tasks SET platform_profile_id=NULL` 时，被数据库函数 `partsignal_guard_content_task_platform()` 拒绝。当前唯一代码 diff 是 `frontend-v2/src/app/layout/app-shell.test.tsx`，不参与 backend、数据库 migration、ContentTask fixture 或该 SQL 路径，因此该失败不能归因于本 Task。

按任务约束：未修改 backend/数据库/测试，未重复运行 `make verify`。由于代码和环境没有发生会影响该失败的变化，不允许重跑同一失败。

### Trellis check 与 gate 结论

- 最终代码检查未发现 spec、依赖方向、类型安全、测试目标或范围违例；局部 fixture 与精确单 detail GET 符合既有 frontend quality guideline。
- 无需更新 `.trellis/spec/`：现有 quality guideline 已规定 Product Detail 只使用单一 detail endpoint、fixture 使用 generated type、未声明请求必须失败。
- Phase 3 exit gate 仍为 **`NOT_MET`**：required `make verify` 未全绿。
- `docs/frontend-v2/07-migration-plan.md` 按规则保持不变；不得在 backend integration blocker 未关闭时追加 `MET`。
