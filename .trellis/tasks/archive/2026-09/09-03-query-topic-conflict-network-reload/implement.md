# Query Topic 409 显式重载网络新鲜度实施计划

## 0. Planning Gate

- [x] P1 根因、authority、范围与测试缺口已从当前代码、OpenAPI、稳定 specs 和已归档 conformance baseline 核实。
- [x] `prd.md`、`design.md`、`implement.md` 与 context manifests 可供审阅。
- [x] 用户已在 2026-09-03 后续消息中明确批准本方案。
- [x] 已显式执行 `task.py start .trellis/tasks/09-03-query-topic-conflict-network-reload`，Task 状态为 `in_progress`。

## 1. 实施步骤

### Phase A：先建立失败回归证据

- [x] 扩展 `geo-topics.fixture.ts`：记录完整 options GET，并支持该 endpoint 的可控成功/失败/loading 响应。
- [x] 在编辑 409 E2E 中先制造同 key 在途请求，并于 30 秒内制造第二次冲突；覆盖点击后新 GET、fresh cache 与旧在途请求不被采纳。
- [x] 为删除 409 路径建立 fresh-cache 请求计数断言，确保两个入口都在回归范围内。
- [x] 编辑路径注入显式 GET 失败，断言旧缓存不能解除冻结，草稿/冲突/request ID 与 mutation 计数保持。

### Phase B：实现单一恢复 owner

- [x] 在 `query-topic-list-page.tsx` 增加 domain-local fresh options helper。
- [x] helper 复用 `queryTopicsQueryOptions()`，先取消 exact query key 的点击前在途请求，再用 `staleTime: 0` 执行本次 fetch。
- [x] 编辑与删除 `reloadCanonical()` 都改为调用该 helper；未复制 API、query key 或错误处理。
- [x] 保持 topic missing、无 `DELETE`、reload error、request ID、草稿与用户再次确认语义。

### Phase C：定向验证与边界复核

- [x] Query Topic mobile/desktop Playwright production-artifact 正式门禁一次通过：`14 passed`，`16.3s`。
- [x] frontend lint、typecheck、`api:check` 均通过。
- [x] 实际 diff 只包含预计三个产品/测试文件与本 Task Trellis 文档。
- [x] OpenAPI、generated client、backend、数据库合同、Makefile、CI 和稳定业务设计文档无本 Task 变化。
- [x] 独立检查确认不存在 nonce key、cache clear、直接 `api.GET` 副本、自动 mutation replay、retry/fallback 或 sibling live-projection 修复。
- [x] 已完成触及范围的中文注释、developer-visible text 和 stale comment 检查；为非显然的 cancel + fresh-fetch 责任补充中文意图注释，fixture 错误文本保持中文。

### Phase D：Trellis 收尾准备

- [x] 已更新本文件的实际验证结果，未运行的 optional suites 保持 `NOT_RUN` 并说明原因。
- [x] 最终文档候选的 Task validate 与 task-scope trailing-whitespace 检查均通过。
- [x] 稳定 spec 无需更新：现有 `state-management.md` 和 `available-actions-contract.md` 已明确规定 409 后显式 reload、失败时 stale data 不得解冻和禁止自动重放；本 Task 仅修正实现漂移。
- [x] 已给出路径受限 commit plan，用户于 2026-09-03 明确批准提交并归档；不得带入现有任务外 index/worktree 变化。

## 2. Required Validation

| 状态 | 命令 | 证明目标 |
| --- | --- | --- |
| PASS：14 passed / 16.3s | `npm --prefix frontend run e2e -- tests/e2e/geo-topics.spec.ts --project=foundation-mobile --project=foundation-desktop` | 编辑/删除 fresh-cache、旧在途请求、失败冻结、人工恢复及无自动重放 |
| PASS | `npm --prefix frontend run lint` | 前端静态质量 |
| PASS | `npm --prefix frontend run typecheck` | QueryClient/options 与 fixture generated types |
| PASS | `npm --prefix frontend run api:check` | OpenAPI/generated client 未漂移 |
| PASS（5 个 implement context、4 个 check context；大型 spec 注入警告不影响通过） | `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-03-query-topic-conflict-network-reload` | context manifests 与 Task 结构 |
| PASS | `git diff --check -- frontend/src/domains/geo/query-topic-list-page.tsx frontend/tests/e2e/fixtures/geo-topics.fixture.ts frontend/tests/e2e/geo-topics.spec.ts .trellis/tasks/09-03-query-topic-conflict-network-reload` | task-scope trailing whitespace |

正式定向 E2E 在候选实现上只运行一次；开发中优先使用最小静态/聚焦检查，不把 production-artifact gate 当修复循环。

开发性单项目 E2E 首次因主动注入的 503 未加入 fixture 的预期 console 状态而失败；补齐精确测试边界后重跑为 `2 passed`。这不是正式双 project 门禁重跑。独立检查随后补充 AC3 在途请求回归，并在最终候选上只运行一次上述正式门禁。

## 3. Optional Validation

| 状态 | 命令 | 默认不运行原因 |
| --- | --- | --- |
| NOT_RUN | `npm --prefix frontend test` | 变更局限于单页冲突恢复与已有 E2E fixture；Required E2E 直接覆盖稳定用户边界 |
| NOT_RUN | `npm --prefix frontend run build` | 定向 E2E 按项目现有方式使用 production build/preview，重复独立 build 价值低 |
| NOT_RUN | `make verify` | 不改变 backend、公共合同、数据库、共享基础设施或 release gate；仓库级门禁超出最小证明范围 |

若实施产生共享状态、公共合同或跨模块影响，再报告并调整最小验证，而不静默扩大全量 gate。

## 4. Commit Boundary（实施完成后）

预计工作提交仅包含：

- `frontend/src/domains/geo/query-topic-list-page.tsx`
- `frontend/tests/e2e/fixtures/geo-topics.fixture.ts`
- `frontend/tests/e2e/geo-topics.spec.ts`
- `.trellis/tasks/09-03-query-topic-conflict-network-reload/`

不得使用 `git add -A`、`git add .` 或 `git commit -a`；必须路径受限暂存并在提交前后核对 `git diff --cached --name-status` / `git show --name-status`。现有 `.gitignore`、`backend/app/schemas/configuration.py` 和 staged artifacts 删除均保持原样。

## 5. Stop Conditions

出现以下任一情况时停止实施并报告：

- 必须修改 backend、OpenAPI、generated client、数据库合同、Makefile、CI 或稳定业务设计文档；
- 无法在不清空共享 cache 或改变全局 `staleTime` 的前提下保证点击后请求；
- TanStack Query 的已安装版本不支持设计所需的 exact cancel/fetch options 语义；
- 修复需要吸收 `query-topic-dialog-live-projection` 或 `integrity-error-domain-mapping`；
- 现有任务外 dirty/index 状态妨碍路径受限提交且无法安全隔离。
