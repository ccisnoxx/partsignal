# 收缩删除与归档生命周期：实施计划

## 0. 开始门禁

- [x] 用户评审并明确批准最新 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-06-simplify-deletion-lifecycle`，当前规划阶段不得提前执行。
- [x] 运行 `trellis-before-dev`，重新读取三份任务文档、根 `AGENTS.md`、相关 `.trellis/spec/`、`contracts/openapi.yaml` 和 `contracts/database.md`。
- [x] 确认主工作区仍位于 `main`，保留用户已有 `.playwright-cli/` 和其他未识别改动；不创建分支、不提交、不推送。
- [x] 记录当前 Alembic head、测试数据库状态和将要修改的文件清单。

## 1. 合同优先

- [x] 更新 `contracts/openapi.yaml`：
  - `ContentTask` 的 `archived_at`、nullable 平台 ID 和四个删除生命周期动作。
  - `archive_status=ACTIVE|ARCHIVED|ALL` 查询参数。
  - archive、restore、永久删除预览、永久删除四个 operation。
  - 永久删除预览/请求 Schema 与稳定错误响应。
  - 发布工作和文章响应中的 nullable 平台/账号 ID。
- [x] 更新 `contracts/database.md`：归档正交状态、平台/账号标量快照、外键语义、聚合删除顺序、共享 GEO 保留、审计白名单和不可逆迁移。
- [x] 更新 Pydantic Schema 与 Router 签名，使运行时 OpenAPI 和冻结合同一致。
- [x] 运行 `make contract-generate`，只由 OpenAPI 重新生成 `frontend/src/shared/api/schema.d.ts`，不得手改生成类型。

回滚点：合同检查无法表达 nullable 历史身份或动作权限时先修正合同，不在前端增加兼容类型。

## 2. Alembic 与 ORM

- [x] 基于实施时 head 新增单个前向迁移（预期 revision `0037_simplify_deletion_lifecycle`，以实际 head 为准），不修改任何历史 revision。
- [x] 为 `content_tasks` 增加 `archived_at` 与平台标量快照，确定性回填后设置快照非空。
- [x] 为 `publication_works` 增加平台/账号标量快照，确定性回填后设置非空。
- [x] 调整任务、发布工作、平台账号、来源问题、GEO 来源、citation 和逐篇结果外键及检查约束。
- [x] 收窄不可变触发器：继续禁止历史 UPDATE，解除对服务端聚合 DELETE 的绝对阻断。
- [x] 调整 `audit_logs` 触发器，只守卫 UPDATE；执行 `SUCCESS + action 白名单` 的一次性全局清理。
- [x] 在迁移文件中冻结白名单字符串并显式拒绝 downgrade，提示恢复迁移前 PostgreSQL 备份。
- [x] 同步更新 ORM 模型与中文模块/类文档；不增加 JSONB 配置快照、归档表或通用删除模型。

迁移必测：

- 旧数据快照回填准确，nullable 外键和新约束生效。
- 缺失当前关联时迁移失败，不写占位值。
- 审计只清理目标行，所有业务表行数/状态不变。
- 直接 UPDATE 批准内容、发布/GEO 历史和审计仍被数据库拒绝。
- 删除平台只置空历史实时 ID，不删除任务。
- downgrade 返回预期 `55000`。

## 3. 审计收缩

- [x] 在 `backend/app/audit_types.py` 增加唯一 `RETAINED_AUDIT_ACTIONS`，与 PRD 白名单逐字一致。
- [x] 在 `backend/app/audit.py` 使 `validate_audit_entry` 拒绝非 `SUCCESS` 或白名单外动作。
- [x] 删除 `commit_audit` 及 Router 中失败/拒绝审计包装；保留真实业务错误返回和日志，不用 no-op 替代。
- [x] 删除服务中所有白名单外 `append_audit` 调用，包括草稿、作业、文件、模型测试/发现、普通状态和失败流程。
- [x] 保留的配置/批准/发布/删除审计继续通过现有敏感键检查。
- [x] 更新审计查询测试：迁移后 action/filter options 只出现实际白名单动作，outcome 只出现 `SUCCESS`。

回滚点：删除审计调用后若业务事务、错误映射或权限判断发生变化，说明审计与业务逻辑耦合未解除，先修复共同所有者，不保留失败审计兼容分支。

## 4. 内容任务后端生命周期

- [x] 创建任务与 GEO 优化任务时写入平台名称/网站快照。
- [x] 调整批量任务投影：默认排除归档、支持 `archive_status`、实时平台缺失时使用快照，按当前用户投影动作。
- [x] 扩展普通 `delete_content_task`：
  - 锁内检查运行生成作业、成功文章和 GEO 实时关联。
  - 聚合删除未成功发布工作、事件、失败验证、附件、内容、审核、作业和任务来源。
  - 清理被删子记录旧审计并调度无引用文件。
  - 保留一次 `content_task.deleted`。
- [x] 实现 archive/restore：revision、状态和归档标记校验，不改变业务状态，不写审计。
- [x] 实现永久删除预览：批量计数、URL 去重、共享/独占 GEO 链判定，不产生写入。
- [x] 实现管理员永久删除：在锁内重算范围、解除下游实时来源、清理整个聚合、写空 details 墓碑并一次提交。
- [x] 从 GEO 服务提取不 commit、不独立审计的内部更正链删除 helper；公共 GEO 删除继续保持现有响应和审计语义。
- [x] 确认双删、旧 revision、错误确认文本、共享 GEO、共享文件和任一步异常均无部分结果。

## 5. Prompt、平台与账号后端规则

- [x] Prompt 与平台 Prompt 绑定写操作复用一个 PostgreSQL 事务级 advisory lock；不新增锁服务或配置项。
- [x] Prompt 投影即使存在绑定也返回 `DELETE`；删除服务按 UUID 锁平台、置空绑定、增加平台 revision、删除 Prompt 并一次提交。
- [x] 平台删除投影只把 `OPEN` 任务和非终态发布工作视为阻断；账号数量改为删除影响，不再作为阻断。
- [x] 平台删除服务锁内复核活动任务/工作，级联配置账号、置空终态历史实时 ID、保留任务并复用 Logo 文件生命周期。
- [x] 发布工作创建/换账号时保存标量快照；查询改为左连接并从实时配置或快照投影。
- [x] 账号显式删除只阻断非终态发布工作；终态历史在账号 ID 置空后继续可读。
- [x] AI 渠道和模型删除保持现有历史快照/`SET NULL` 逻辑，只调整审计调用与测试。

回滚点：任何平台删除路径出现任务级联、非终态工作丢失实时配置、Prompt 部分解绑或历史页无法投影时，不接入前端。

## 6. 前端

- [x] 更新 `ContentTasksPage`：当前/归档筛选、归档/恢复动作、普通删除新文案和永久删除预览确认流程。
- [x] 永久删除弹窗展示分项计数、外部 URL、不可恢复提示和 `永久删除` 输入；输入不匹配时不发请求。
- [x] 成功后失效内容任务、内容版本、发布、GEO、平台和审计的既有 query key，并安全返回对应列表。
- [x] 历史平台 ID 为空时显示快照名称，不生成失效配置链接或 `.slice()` 调用。
- [x] 更新 Prompt 删除弹窗：展示受影响平台列表/数量和自动解绑后果。
- [x] 更新平台删除确认：展示级联账号数量、明确不删除任务；活动任务阻断仍使用服务端 deletion 投影。
- [x] 更新账号删除文案与动作消费，使终态历史不再导致“查看删除条件”。
- [x] 复用现有 Ant Modal、Dropdown、Form、错误组件和焦点恢复，不新增通用危险操作组件。

前端必测：

- ACTIVE/ARCHIVED 查询参数与 URL 同步。
- 工程师与管理员动作差异。
- 归档、恢复、普通删除和永久删除四条确认链。
- 永久删除输入、预览失败、revision 冲突、成功跳转和缓存刷新。
- 平台/账号实时 ID 为空的历史展示。
- Prompt 绑定影响提示与删除后平台生成门禁。
- 键盘操作、焦点恢复和移动端弹窗无页面横向溢出。

## 7. 权威文档与稳定规范

- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md`，删除“发布/GEO 永不物理删除”的过期结论，写入归档后管理员永久删除例外。
- [x] 更新根 `AGENTS.md` 的项目规则：批准内容、发布和 GEO 仍不可原地修改；显式归档任务永久删除是唯一整体删除例外。
- [x] 行为通过验证后使用 `trellis-update-spec` 更新：
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/publication-workbench-guidelines.md`
  - `.trellis/spec/backend/available-actions-contract.md`
  - `.trellis/spec/backend/ai-configuration-guidelines.md`
  - 受影响的前端组件规范
- [x] 检查 OpenAPI、数据库合同、设计文档、spec、代码和测试没有保留相互冲突的旧规则。

## 8. 必需验证

先运行最小定向检查；失败先归因，只有当前改动导致且属于本任务范围才修复。

### 8.1 定向后端

从仓库根目录运行：

```bash
UV_CACHE_DIR=$PWD/.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_audit.py \
  backend/tests/unit/test_configuration_audit.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_contract.py

UV_CACHE_DIR=$PWD/.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_migrations.py \
  -k "simplify_deletion_lifecycle or audit_allowlist"

UV_CACHE_DIR=$PWD/.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py \
  backend/tests/integration/test_identity_management.py \
  -k "content_task_delete or content_task_archive or permanent_delete or platform_prompt or platform_profile or platform_account or audit"
```

实施时新增测试函数使用上述可筛选名称，避免命令成为空跑。

### 8.2 定向前端

工作目录设为 `frontend/`：

```bash
npx vitest run \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/configuration/PlatformsPage.test.tsx \
  src/features/settings/SettingsPage.test.tsx
```

### 8.3 合同与共享质量门禁

从仓库根目录运行：

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
npm --prefix frontend run build
git diff --check
```

本任务修改共享数据库关系、权限和公开合同，因此完整 unit/integration、lint/typecheck 与前端生产构建均为必需，不以定向通过替代。

### 8.4 Playwright 回归

优先扩展现有 Playwright Test Runner 用例，不用临时 CLI 流程代替可重复回归。从仓库根目录运行：

```bash
npm --prefix frontend run e2e -- tests/e2e/mvp-flow.spec.ts --project=e2e --grep "删除与归档生命周期"
```

用例至少覆盖：普通测试任务一键删除、成功任务归档/恢复/管理员永久删除、工程师无永久删除权限、绑定 Prompt 自动解绑、活动任务阻止平台删除、终态历史不阻止平台删除。

## 9. 可选完整验证

以下检查在准备发布、定向 E2E 暴露跨页风险或用户要求全量复测时运行；它们不替代必需检查：

```bash
make e2e
make build
make verify
```

部署后如需要人工复核，再使用项目 `playwright-cli` 建立本任务专属命名会话；必须真实点击和检查请求，结束前只关闭该会话并确认没有遗留。不得运行 `close-all` 或 `kill-all`。

## 10. 交付与停止条件

- [x] 检查最终 diff：无隐藏 fallback、第二套状态机、通用级联框架、敏感审计、任务级联平台删除、失效配置链接或无关改动。
- [x] 记录各验证命令的通过/失败/跳过数和耗时；可选检查跳过时说明原因与残余风险。
- [x] 非平凡 Python 变更完成 touched-scope 中文注释/docstring/日志/异常检查，并在交付说明中明确更新情况。
- [x] 向用户展示精确 commit plan 并取得确认后才提交到 `main`；不自动 push、部署、执行生产数据删除或归档 Trellis 任务。
- [x] 只有代码、迁移、合同、测试和权威文档一致，且必需验证通过，才视为实施完成。

实施验证记录（2026-08-06）：

- `make contract-check`、`make lint`、`make typecheck`、`git diff --check` 均通过。
- `make test-unit` 通过：后端 139、前端 192、视觉合同 24。
- `make test-integration` 通过：PostgreSQL 集成测试 57。
- `npm --prefix frontend run build` 通过。
- 删除与归档 Playwright 回归在隔离 PostgreSQL、Redis DB 15 和本地协议替身中通过：共享 setup 与主用例 2/2，59.7 秒。
- 首次本地 E2E 误连已占用 5173 的旧开发容器，第二次与常驻 Worker 竞争 Redis DB 0；改用项目隔离栈和 Redis DB 15 后排除环境干扰。测试中两个旧 UI 命令读取竞态已改为等待精确 POST 响应，不改变业务期望。

Phase 3.4 上线回归修复：

- 产品引用在新标签页删除后，原产品页重新获得焦点时刷新删除投影，并从最新集合数据派生删除条件弹窗状态。
- 内容任务删除成功后先退出详情路由，再失效详情缓存，避免活跃 observer 重取已删除任务。
- 不存在的内容任务只请求身份接口，显示“内容任务不存在或已删除”，不再继续请求生成作业和内容版本。
- `npm run lint`、`npm run typecheck`、`npm run build` 通过；相关 Vitest 30 项全部通过。

## 11. 高风险文件与回滚点

| 范围 | 主要文件 | 风险 |
|---|---|---|
| 数据模型/迁移 | `backend/alembic/versions/0037_*.py`、`backend/app/models/content.py`、`publication.py`、`geo_files.py` | 不可逆数据删除、外键与触发器顺序 |
| 任务删除 | `backend/app/services/publication.py`、`geo_observation.py`、`projections.py` | 部分删除、共享 GEO/文件误删、并发 |
| 历史投影 | `backend/app/services/publication_queries.py`、相关 Schema | nullable ID 导致历史页面 500 |
| 配置删除 | `backend/app/services/platform_configuration.py` | Prompt 部分解绑、平台误删任务 |
| 审计 | `backend/app/audit.py`、`audit_types.py`、各 Router/Service | 白名单遗漏、敏感信息或低价值日志回流 |
| 前端动作 | `ContentTasksPage.tsx`、`PlatformsPage.tsx`、`SettingsPage.tsx` | 权限误导、确认绕过、删除后 404 |
| 权威合同 | `contracts/openapi.yaml`、`contracts/database.md`、根 `AGENTS.md`、设计文档/spec | 新旧规则冲突 |

任何迁移清理范围、共享 GEO 判定或平台不级联任务的反例失败时立即停止该路径，不通过增加兼容分支或前端隐藏按钮掩盖。
