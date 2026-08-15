# Frontend V2 Phase 6 verify blocker 复现与归因

## 1. Baseline

- 日期：2026-08-15（Asia/Shanghai）。
- 基线：`main` at `fb52b76489e34b305117da0993496171fc54cddf`，planning 开始前 clean；相对 `origin/main` ahead 219，不 pull/push。
- 已归档前置 Task：`.trellis/tasks/archive/2026-08/08-15-frontend-v2-configuration-abstraction-review`，归档提交 `3ebd385e` 已在当前 `main`。
- 前置 Task 当前候选证据：V2 unit `4 failed / 69 passed files`、`10 failed / 416 passed tests`；门禁在 V2 unit 停止，Phase 6 为 `NOT_MET`。

## 2. Independent reproductions

| ID | Command | Exit | Result | Vitest duration | Planning status |
| --- | --- | ---: | --- | ---: | --- |
| F-01 | `npm --prefix frontend-v2 run test -- src/styles/global.test.ts` | 1 | `1 failed file`; `7 failed / 25 passed tests` | 300ms | open |
| F-02 | `npm --prefix frontend-v2 run test -- src/domains/product/product-detail-page.test.tsx` | 1 | `1 failed file`; `1 failed / 6 passed tests` | 1.54s | open |
| F-03 | `npm --prefix frontend-v2 run test -- src/domains/content/content-editor-page.test.tsx` | 1 | `1 failed file`; `1 failed / 6 passed tests` | 1.83s | open |
| F-04 | `npm --prefix frontend-v2 run test -- src/domains/publication/publication-workspace-page.test.tsx` | 1 | `1 failed file`; `1 failed / 4 passed tests` | 2.11s | open |

以上均为独立 Vitest 进程；没有修改代码或环境后重复运行完整 `make verify`。

## 3. Findings

### F-01 — P2 — token 唯一性测试混淆全局声明与 Print scoped override

- 失败：`global.test.ts:40` 对 raw CSS 中每个 token 全文件计数 1；`surface-panel`、`surface-raised`、`text-primary`、`text-secondary`、`border-subtle`、`border-strong`、`warning` 实际各为 2。
- production 证据：`global.css:58-118` 在 `:root` 定义全局 token；`:420-435` 只在 `@media print > .geo-insights-print-shell` 覆盖纸张值。
- 合同证据：已归档 `frontend-v2-geo-insights-print` 的 `prd.md:41-47,79`、`design.md:180-192`、`implement.md:57-68` 明确要求 route-scoped 高对比 Print CSS、白色纸张表面、深色文字与 `print-color-adjust`；`08-testing-quality-and-acceptance.md:345` 继续要求 Print media 验收。
- root owner：测试边界。production selector、media scope 与已批准 Print 行为正确。
- 最小修复：测试把精确 Print shell block 从全局唯一性扫描中排除，并单独锁定完整 override allowlist 和值。不能简单把七项期望改为 2，也不能删除唯一性断言。

### F-02 — P2 — Product Detail domain 断言跨入 App Shell navigation

- 失败：测试期望 10 个 level-2 headings，实际 12 个；新增差异为 `GEO`、`业务配置`。
- production 证据：`navigation.ts:53-92` 权威配置五组导航；`app-shell.tsx:120-165` 用 `h2` 命名每组；`product-detail-page.tsx:135-280` 的具名 article 内有七个 DetailSection。
- 合同证据：`02-information-architecture-and-routing.md:105-113` 将 Product Detail 归产品路由；`08-testing-quality-and-acceptance.md:172` 要求同时覆盖 sidebar 与 Detail 页面，但没有要求把两者合为一个 heading 顺序合同。
- root owner：`product-detail-page.test.tsx:152-154` 的 query scope。
- 最小修复：在具名 Product article 内断言七个 section headings；现有主导航 active link 断言保留。

### F-03 — P2 — Content Editor 单元素查询跨越两个真实 Diff 表面

- 失败：`content-editor-page.test.tsx:284` 的 `/v1 → v2/` 命中两个元素。
- production 证据：`content-editor-page.tsx:345-363` 的 Workspace 有 `内容文档` Main 与 `参考` pane；`:475` 在 Main Diff tab 渲染 server Diff，`:543` 在 Reference `Server Diff` 再渲染同一 `ContentDiffView`。
- 合同证据：`03-page-and-workflow-blueprint.md:163-171` 要求 Main 与 Reference 布局且 Reference 包含 Diff/Warnings；`06-code-architecture-and-project-structure.md:139-143` 保持 Content domain 的服务端 Diff owner。
- root owner：`content-editor-page.test.tsx:284-285` 的 query scope。两处生产展示服务不同任务，不构成可访问性或交互歧义。
- 最小修复：在 `内容文档` region 内断言版本与 ADD line；不删除 Reference Diff，不用 all-by 或数组下标。

### F-04 — P2 — Publication 单元素查询跨越当前状态与不可变历史

- 失败：`publication-workspace-page.test.tsx:217` 的失败说明命中两个元素。
- production 证据：`publication-workspace-page.tsx:91-101,256-259` 把 verification comment 保存在 `核验历史`；`:305-339` 在 ACTION_REQUIRED 当前状态显示 latest comment 和修正入口。
- 合同证据：`08-testing-quality-and-acceptance.md:231-234` 的 real-stack Flow B 要求旧失败核验 snapshot 不变，同时当前流程进入修正；两处相同文本具有当前恢复提示和历史证据两种语义。
- root owner：`publication-workspace-page.test.tsx:217` 的 query scope。production 没有重复交互控件，且两个 pane 有明确 accessible name。
- 最小修复：在 `发布内容与操作` region 内断言当前失败说明；保留修正链接和 trigger focus。

## 4. Planned correction matrix

| Finding | Writable owner | Production change | Validation |
| --- | --- | --- | --- |
| F-01 | `frontend-v2/src/styles/global.test.ts` | none | global target + complete V2 unit + final verify |
| F-02 | `frontend-v2/src/domains/product/product-detail-page.test.tsx` | none | Product target + complete V2 unit + final verify |
| F-03 | `frontend-v2/src/domains/content/content-editor-page.test.tsx` | none | Content target + complete V2 unit + final verify |
| F-04 | `frontend-v2/src/domains/publication/publication-workspace-page.test.tsx` | none | Publication target + complete V2 unit + final verify |

## 5. Planning conclusion

- 四项均为测试边界 P2 blocker；生产行为符合当前文档与可访问语义。
- 计划不修改 production、contract、database、permission、deployment、dependency、ADR 或 stable frontend spec。
- 当前 open P0/P1 为 0，open P2 为 4；实施关闭四项且最终候选完整门禁通过后才可降为 0。
- 当前 Phase 6 Exit Gate 仍为 `NOT_MET`；planning 证据不能提前改判。

## 6. Implementation evidence before final gate

| Finding | Applied correction | Target result | Current status |
| --- | --- | --- | --- |
| F-01 | 从根 token 唯一性扫描中仅排除精确 GEO Print shell body，并锁定八项 Print override 名称、顺序和值 | `1 passed file / 33 passed tests / 290ms` | closed |
| F-02 | 在具名 `PS-001` article 内断言七个 Detail headings | `1 / 7 / 1.58s` | closed |
| F-03 | 在 `内容文档` region 内断言当前 Diff | `1 / 7 / 1.80s` | closed |
| F-04 | 在 `发布内容与操作` region 内断言当前失败说明 | `1 / 5 / 1.08s` | closed |

- 完整 V2 unit：`73 passed files / 427 passed tests / 12.22s`，failed/skipped 均为 `0`。
- `api:check`、`typecheck`、`lint`、production build、`make contract-check` 与 `git diff --check` 均退出 `0`；build 的大 chunk warning 为既有非阻塞提示。
- production、API、database、permission、deployment、dependency 与 E2E orchestration 均无修改，既有业务行为保持。
- 四个原 Frontend V2 blocker 关闭后 open P0/P1/P2 暂为 `0/0/0`；最终结论以下述当前候选门禁为准。

## 7. Final-candidate gate and new blocker attribution

- 唯一一次 `make verify`：退出码 `2`，总耗时 `430.93s`。
- 已通过：合同检查；backend/V1/V2 lint 与 typecheck；backend unit `193 passed / 5.63s`；V1 unit `28 files / 205 tests / 247.57s`；V1 visual contract `24 passed / 0 failed / 0 skipped / 497.98ms`；V2 unit `73 files / 427 tests / 13.25s`。
- 停止阶段：PostgreSQL integration `114 passed / 2 failed / 142.21s`；Make 因该阶段退出 `1` 而没有运行 image/frontend build、real-stack V1/V2 E2E 或两份 Compose config。
- 新 P2 B-01：`backend/tests/integration/test_content_task_detail.py:306-329` 构造 `primary_task=CREATE_OPTIMIZATION_TASK` 的 `GeoInsightCoverageItem` snapshot，却缺少 `backend/app/schemas/geo_files.py:437-457` 自 `661baf3f` 起要求的匹配 `optimization_action`。production 创建路径使用完整 validated item；root owner 是过期 integration fixture。
- 新 P2 B-02：`backend/tests/integration/test_migrations.py:285` 在执行 `alembic upgrade head` 后仍硬编码期望 `0042_content_version_detail`，而 `backend/alembic/versions/0043_geo_insight_platform_identity.py` 自 `661baf3f` 起已是合法 head。root owner 是过期 fresh-head integration 期望。
- 本分支对 `backend/`、migration、database contract 均为零 diff；两个 blocker 与本 Task 四个 frontend 测试边界修复无因果关系。依批准的范围和单次完整门禁规则，本 Task 不扩围修改、不自动第二次运行 `make verify`。
- cleanup：integration context 清理后 PostgreSQL `partsignal_*` 临时数据库为 `0`；E2E 未启动，storage 目录为 `0`，API/worker/scheduler/fake provider/V1/V2 dev/preview 进程未创建；独占 Redis DB 14 为 `0` key，临时容器已移除；`8000,9001,5173,4173,4174,19009,16379` 全部释放。
- 最终 open P0/P1/P2 为 `0/0/2`，Engineering 为 `NOT_MET`，Phase 6 Exit Gate 保持 `NOT_MET`。
