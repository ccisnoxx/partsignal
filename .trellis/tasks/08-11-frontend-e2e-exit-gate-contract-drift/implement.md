# Frontend E2E exit gate 合同漂移 — Implementation Plan

## 1. 启动门

用户确认本规划后才执行：

1. 确认 `main` 仍包含基线 `33e2123`，并审阅确认后出现的任何提交或未知工作树改动。
2. 运行：

   ```bash
   python3 ./.trellis/scripts/task.py start 08-11-frontend-e2e-exit-gate-contract-drift
   ```

3. 创建用户已授权的临时分支：

   ```bash
   git switch -c codex/frontend-e2e-exit-gate-contract-drift
   ```

4. 使用 `trellis-before-dev` 重新加载本 Task `prd.md`、`design.md`、本文件、复现记录和相关 backend/frontend specs，再开始编辑。

规划确认前不运行 `task.py start`、不创建分支、不修改产品/测试/spec/docstring/迁移计划。

## 2. 实施顺序

1. `frontend/tests/e2e/ai-channel-management.spec.ts`
   - 保留 `ai_channel.created` 断言。
   - 只把 `ai_model.tested` 改为 `ai_model.enabled`。
2. `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
   - 只修改 inventory 中一项的 `label`、`marker`、`regionLabel` 为“AI 生成记录列表”。
3. `frontend/tests/e2e/mvp-flow.spec.ts`
   - 管理员 404 数组中的产品 URL 改为 `/api/v1/products/${nonexistentId}?expected_revision=0`。
   - 工程师 403 数组中的产品 URL 做相同修改。
4. `.trellis/spec/backend/ai-configuration-guidelines.md`
   - 明确连接测试只回写当前测试状态，不进入永久审计；模型发现不持久化永久审计。
   - 渠道日志的模型事件范围收敛为真实写入的 CRUD 与启停事件。
5. `backend/app/services/ai_configuration.py`
   - 只改 `test_ai_model` docstring，使其描述 revision 复核后的测试状态回写和保持停用。
   - 不改函数体、签名、调用方或审计代码。
6. 处理用户追加授权的三个失败：
   - AI 渠道 1440px 几何断言改为局部滚动与固定列边界断言；
   - 审计时间列宽从 144px 调整为 160px；
   - MVP 自然化按钮定位改为“创建自然化生成记录”。
7. 处理用户追加授权的删除触发器合同回归：
   - `_delete_task_core` 的 `source_job_id` 断链显式保持 `ContentVersion.updated_at` 原值，不修改触发器或历史 migration；
   - 在现有 PostgreSQL 删除生命周期集成测试中加入终态 AI 作业与 AI 内容版本回归。
8. 运行第 4 节全部 required validation。
9. 仅当 `make verify` 全绿，按 design 第 5 节更新 `docs/frontend-v2/07-migration-plan.md`；否则保持文档不变并停止。
10. 检查最终 diff、工作树和临时数据库清理状态；提交前展示独立 commit plan 并等待用户确认，不 push。

## 3. 预计修改文件

### 必改

- `frontend/tests/e2e/ai-channel-management.spec.ts`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `.trellis/spec/backend/ai-configuration-guidelines.md`
- `backend/app/services/ai_configuration.py`
- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `frontend/src/features/configuration/AuditLogPage.tsx`
- `.trellis/spec/backend/database-guidelines.md`

### 条件修改

- `docs/frontend-v2/07-migration-plan.md`：仅 `make verify` 全绿后。

### Task 产物

- `.trellis/tasks/08-11-frontend-e2e-exit-gate-contract-drift/task.json`
- `.trellis/tasks/08-11-frontend-e2e-exit-gate-contract-drift/prd.md`
- `.trellis/tasks/08-11-frontend-e2e-exit-gate-contract-drift/design.md`
- `.trellis/tasks/08-11-frontend-e2e-exit-gate-contract-drift/implement.md`
- `.trellis/tasks/08-11-frontend-e2e-exit-gate-contract-drift/research/failure-reproduction.md`

需要修改任何其他 production、合同、migration、schema、依赖、fixture 或测试基础设施文件时立即停止并重新请求范围批准。

## 4. Required Validation

本地基础设施只使用用户批准的 Docker PostgreSQL/Redis；不读取或导出服务器数据库配置，不使用 `set -a`。每次 E2E 由 `e2e-local.sh` 创建唯一临时数据库并在退出时清理。

### 4.1 三个精确 targeted E2E

```bash
export DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal'
export REDIS_URL='redis://127.0.0.1:56379/15'
deploy/scripts/e2e-local.sh \
  tests/e2e/ai-channel-management.spec.ts:130 \
  tests/e2e/cross-page-visual-convergence.spec.ts:604 \
  tests/e2e/mvp-flow.spec.ts:284 \
  --project=e2e
```

判据：固定 V2 real-stack 前置套件通过；Playwright setup 与三个目标用例全部通过；脚本输出数据库和存储 `status=deleted`。

### 4.2 Frontend 静态门禁

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

### 4.3 Backend 静态门禁

触及 Python docstring 与 backend spec，因此运行完整 backend Ruff/mypy：

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check backend
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app
```

触及内容任务聚合删除后，先运行直接 PostgreSQL 回归：

```bash
export DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal'
APP_ENV=test UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_content_task_delete_and_archive_permanent_delete_lifecycle
```

### 4.4 完整 exit gate

```bash
export DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal'
export REDIS_URL='redis://127.0.0.1:56379/15'
make verify
```

判据：所有 targets 零失败。若出现新的范围外失败，记录命令、失败测试、实际输出和范围归因后停止；不重跑未发生相关代码/配置/环境变化的同一失败，不扩大范围。

### 4.5 Gate 文档与最终 diff

`make verify` 全绿后才更新迁移计划，随后运行：

```bash
git diff --check
git status --short --branch
```

人工审阅最终 diff，确认无未授权 production behavior，且没有 OpenAPI、数据库 schema、migration、依赖、TableRegion 或 fixture 变化。

## 5. Phase 3 gate 重判规则

- `MET`：三个 targeted E2E、所有静态门禁和完整 `make verify` 全部通过；迁移计划追加前置 Task 当次 `NOT_MET` 事实、本 Task 验证证据和当前 `MET`，保留更早全部历史结论。
- `NOT_MET`：任一 required validation 未通过；不修改迁移计划当前 gate。新的范围外失败只记录到本 Task 并停止。

## 6. 回滚点

- Git 基线：`33e21233b29dbc5264d5a357ed93f09b51e62e27`。
- 实施回滚点：各修改保持为独立、聚焦 hunk，可逐项撤销；不使用 `git reset --hard`、`git checkout --` 或历史改写。
- gate 回滚点：迁移计划只在全绿后最后修改；若证据失效，只撤销本 Task 新增段落，历史 `NOT_MET` 不动。
- 环境回滚点：`e2e-local.sh` EXIT trap 删除临时数据库、进程和存储；结束时查询确认无 `partsignal_e2e_%` 数据库。

## 7. 实施与验证记录

### 7.1 已完成最小纠偏

- `ai-channel-management.spec.ts`：保留 `ai_channel.created`，将过期的 `ai_model.tested` 断言替换为当前流程真实写入且永久保留的 `ai_model.enabled`。
- `cross-page-visual-convergence.spec.ts`：仅将 Content Task inventory 项的 `label`、`marker`、`regionLabel` 对齐为“AI 生成记录列表”。
- `mvp-flow.spec.ts`：管理员 404 与工程师 403 的产品删除请求均补充 `?expected_revision=0`。
- AI configuration spec 与 `test_ai_model` docstring 已按 0037 后合同纠偏；函数体、签名和 production behavior 未改。

### 7.2 Targeted E2E 结果与停止点

按 4.1 的精确命令复验。固定 V2 real-stack 前置套件通过；三个原始失败点均已越过：

- 渠道闭环已成功读取 `ai_model.enabled`，随后在同一用例的桌面表格几何断言失败：`statusRight=1062`、`actionsLeft=901`，位置 `ai-channel-management.spec.ts:458`。
- 25 表源码清单已通过“AI 生成记录列表” marker/region 检查，随后在“全局审计日志”375px 日期内容裁切断言失败，位置 `cross-page-visual-convergence.spec.ts:220`。
- 管理员删除不存在产品实际返回合同要求的 404；随后自然化对话框“创建自然化作业”点击等待超时，位置 `mvp-flow.spec.ts:581-585`。

最终 Playwright 汇总为 `1 passed / 3 failed (4.0m)`；脚本输出：

```text
E2E_CLEANUP database=partsignal_e2e_20260811_4543 status=deleted
E2E_CLEANUP storage=.../partsignal-e2e-storage.z6sWhz status=deleted
```

以上三个后续失败当时不属于本 Task 已确认的合同漂移范围，因此按规则停止。用户随后明确授权将它们纳入本 Task；后续实施与验证记录在下方追加，不覆盖本次停止事实。

### 7.3 追加授权后的复验与新停止点

完成第 6 步三个最小纠偏后，按 4.1 的同一精确命令再次复验：

- AI 渠道管理用例通过；桌面断言现验证表格局部横向滚动和固定操作列边界，不要求不存在的整表无滚动。
- 25 表源码清单与移动边界用例通过；“全局审计日志”时间列可完整容纳既有完整日期时间格式。
- MVP 用例已越过自然化确认按钮，随后在 `mvp-flow.spec.ts:695` 等待导航链接“首稿入口”失败。

生产页 `ContentTasksPage.tsx:974` 对 `href="#task-entry"` 的稳定可见文案为“内容工作”；测试仍使用旧文案“首稿入口”。本轮 Playwright 汇总为 `3 passed / 1 failed (1.7m)`，脚本输出：

```text
E2E_CLEANUP database=partsignal_e2e_20260811_5225 status=deleted
E2E_CLEANUP storage=.../partsignal-e2e-storage.cReWY0 status=deleted
```

该导航文案漂移不在用户本轮明确授权的三个新增失败内，因此按既定规则记录并停止；未运行后续 frontend/backend 静态门禁、`make verify`，也未更新 Phase 3 gate 文档。建议的最小后续变更仅为将该 locator 文案对齐为“内容工作”，保留 `#task-entry` 合同不变，需用户另行授权。

### 7.4 导航 locator 授权后的复验与 backend 停止点

用户授权把 `mvp-flow.spec.ts:695` 的 locator 从“首稿入口”对齐为“内容工作”；`href="#task-entry"` 断言保持不变。按 4.1 的同一精确命令复验后：

- 固定 V2 real-stack 前置套件 `7 passed (41.5s)`；
- AI 渠道管理通过（14.3s）；
- 25 表源码清单与桌面、移动边界通过（50.5s）；
- MVP 用例已越过导航、自然化、发布、GEO 与归档流程，最后在删除开放内容任务时收到 500，而非预期 204。

失败请求为 `DELETE /api/v1/content-tasks/{id}?expected_revision=1`。`publication.py::_delete_task_core` 在已设置 `partsignal.content_task_delete_id` 后尝试把任务内容版本的 `source_job_id` 置空；当前 0040 后数据库触发器仍以 `content version identity is immutable`（SQLSTATE `55000`）拒绝该 UPDATE。完整 targeted Playwright 汇总为 `3 passed / 1 failed (2.0m)`，失败位置 `mvp-flow.spec.ts:1143`，脚本输出：

```text
E2E_CLEANUP database=partsignal_e2e_20260811_5738 status=deleted
E2E_CLEANUP storage=.../partsignal-e2e-storage.noa5yl status=deleted
```

该问题属于内容任务删除服务与数据库触发器的生产合同回归，不是本 Task 的 E2E 断言、AI 审计规范或审计列宽漂移；修复将触及 backend production behavior 和 migration/数据库边界，明确超出当前授权。按规则停止：未运行 frontend/backend 静态门禁、`make verify`，未更新 Phase 3 gate 文档。

### 7.5 删除回归修复与最终验证

用户追加授权处理该删除触发器合同回归。权威合同和 SQL 复核确认：触发器允许匹配删除事务中的 `source_job_id -> NULL`，0042 后 `ContentVersion.updated_at` 的 ORM `onupdate` 却把该 Core UPDATE 扩为同时更新时间。最小修复显式保持 `updated_at=ContentVersion.updated_at`；触发器、migration、schema 与其他不可变字段均未修改。现有 PostgreSQL 生命周期测试增加终态 AI 作业和 AI 内容版本后通过：`1 passed in 1.33s`。

全部 required validation 结果：

- 精确 targeted E2E：固定 V2 real-stack 前置 `7 passed`；setup 与三个目标用例 `4 passed (2.1m)`；数据库与存储均输出 `status=deleted`。
- frontend lint、frontend typecheck、backend Ruff、backend mypy、`git diff --check`：全部退出码 `0`。
- 完整 `make verify`：合同与两套 API 类型检查通过；backend unit `176 passed`；frontend V1 unit `203 passed`、visual-contract `24 passed`；frontend V2 unit `233 passed`；Docker backend integration `87 passed`；V2 real-stack 前置 `7 passed`；V1 E2E `52 passed`；V2 E2E `179 passed / 15 skipped`；双前端构建与 Compose 配置检查通过，最终退出码 `0`。
- 结束时 PostgreSQL 查询无 `partsignal_e2e_%` 临时数据库；本任务专用 Redis DB 15 已清理。

因此满足第 5 节 `MET` 判据；迁移计划仅追加历史前置 Task 的当次 `NOT_MET` 证据、本 Task 全绿证据和当前 `MET` 结论，不改写任何既有历史段落。
