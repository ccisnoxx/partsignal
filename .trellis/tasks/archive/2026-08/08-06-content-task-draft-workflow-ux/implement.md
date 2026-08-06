# 内容任务工作流与人工草稿管理优化：实施计划

## 1. 实施顺序

- [x] 更新 `contracts/openapi.yaml`：新增草稿 PUT/DELETE、`ContentDraftUpdate`、`SAVE | DELETE` 内容版本动作，并重新生成前端类型。
- [x] 新增 `0040` 数据库迁移，收窄人工草稿 UPDATE 窗口并建立受控单版本 DELETE 守卫。
- [x] 在后端建立共享的批量人工草稿删除资格策略，覆盖审核、子版本、生成和发布直接引用。
- [x] 实现人工草稿保存命令：锁、revision、当前指针、审核记录、哈希和质量问题校验。
- [x] 实现人工草稿删除命令：锁内复核、直接父指针恢复、精确事务语境和最小审计。
- [x] 调整 `ContentVersion` 动作投影，落实人工/AI/退回稿动作矩阵并保持批量查询无 N+1。
- [x] 修改任务详情的生命周期分支，将“新一轮内容生产”从系统 AI 卡片中分离。
- [x] 扩展现有任务创建弹窗：预填产品/平台、默认最新已批准事实版本、显示版本变化，创建后不自动打开 AI。
- [x] 复用现有修订表单实现“保存当前草稿”模式，并增加受服务端动作控制的删除确认流程。
- [x] 统一“AI 生成记录”和内容版本中文状态，补齐审计动作中文文案。
- [x] 同步数据库合同、架构、业务设计和 Trellis 稳定规范。
- [ ] 完成定向测试、合同门禁、类型检查和真实浏览器验收，最后检查 diff 与文档一致性（除浏览器共享数据/假 AI 服务环境阻断外均已完成）。

## 2. 重点文件

### 合同与数据库

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/alembic/versions/0040_*.py`
- `backend/app/models/content.py`
- `backend/app/schemas/content.py`

### 后端业务

- `backend/app/routers/production.py`
- `backend/app/services/content_production.py`
- `backend/app/services/projections.py`
- `backend/app/services/content_version_policy.py`
- `backend/app/audit_types.py`
- `backend/app/services/audit_logs.py`

### 前端

- `frontend/src/features/content-tasks/ContentTasksPage.tsx`
- `frontend/src/features/content-tasks/ContentTasksPage.test.tsx`
- `frontend/src/features/content-editor/ContentEditorPage.tsx`
- `frontend/src/features/content-editor/RevisionForm.tsx`
- `frontend/src/features/content-editor/ContentEditorPage.test.tsx`
- `frontend/src/shared/components/StatusTag.tsx`
- `frontend/src/shared/components/enumLabels.test.tsx`
- `frontend/src/features/configuration/PromptOutputPreview.tsx`
- `frontend/src/features/configuration/AuditLogDetailPanel.tsx`
- `frontend/src/shared/api/schema.d.ts`（由 OpenAPI 生成）

### 权威文档

- `docs/architecture.md`
- `docs/GEO多平台内容运营系统方案设计.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/component-guidelines.md`

## 3. 必需验证

### 合同与静态检查

```bash
make contract-check
uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run typecheck
```

### 后端定向测试

```bash
uv run --project backend pytest -q \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_contract.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest -q \
    tests/integration/test_content_draft_lifecycle.py \
    tests/integration/test_migrations.py
```

后端测试至少覆盖：

- 人工当前 `DRAFT` 保存成功、revision 冲突、AI/历史/已审核版本拒绝。
- 标题、摘要、Markdown、标签、哈希和质量问题更新；版本号与 lineage 不变。
- 人工 `DRAFT / ABANDONED` 删除成功，当前指针恢复直接父版本或置空。
- 审核、子版本、生成来源/结果、发布工作/事件/核验任一引用阻断删除。
- AI 草稿始终不可删除；直接数据库 UPDATE/DELETE 被触发器阻断。
- `content_version.deleted` 审计只有稳定标识，无内容字段。
- 列表、详情与 mutation 返回动作一致，批量投影查询次数不随版本行数线性增长。

### 前端定向测试

```bash
npm --prefix frontend run test -- \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/shared/components/enumLabels.test.tsx

npm --prefix frontend run lint
```

前端测试至少覆盖：

- `NO_DRAFT`、已有当前内容和终态任务三种互斥布局。
- 续建表单预填产品/平台、默认最新批准事实、版本变化提示和无自动 AI 弹窗。
- 零 AI 记录隐藏整个区域，有记录/失败时保留正确界面。
- `SAVE` 与 `CREATE_REVISION` 两种编辑模式、dirty/保存中/已保存/失败状态。
- `DELETE` 确认、成功导航、失败保留页面和人工/AI 动作差异。
- 六种内容版本状态以及相关提示不显示原始协议值。

### 真实浏览器验收

优先扩展现有 `editor-workspace-convergence.spec.ts` 或 `mvp-flow.spec.ts`，不创建一次性 CLI 流程：

```bash
npm --prefix frontend run e2e -- \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/mvp-flow.spec.ts \
  --project=e2e
```

验收人工草稿保存、刷新后内容保留、删除确认与指针恢复、已完成任务续建、键盘操作、375px/1440px 和 200% 缩放下关键入口可达。若完整 `mvp-flow` 超出定向时间预算，可先运行新增的精确用例并在结果中说明未覆盖风险。

## 4. 可选全量验证

本任务修改公共 API、数据库状态守卫和跨层动作投影，定向验证通过后建议运行：

```bash
make test-unit
make test-integration
npm --prefix frontend run test
npm --prefix frontend run build
```

`make verify` 只在发布前或用户明确要求全量门禁时运行；无关失败先归因，不顺手扩大修复范围。

## 5. 退出门禁

- [x] PRD、设计、实现、OpenAPI、数据库合同与最终代码没有冲突。
- [x] 没有新增依赖、回收站、软删除、第二套编辑器或前端权限推断。
- [x] AI 作业、AI 草稿、已审核内容和发布历史保持不可变。
- [x] 数据库与服务端同时保护保存和删除边界，前端按钮只消费动作投影。
- [x] 删除审计不包含正文、标题、摘要、标签、变更说明、Prompt 或模型响应。
- [x] 已检查 diff 中没有兼容 fallback、静默默认、N+1、宽泛异常捕获或无关修改。
- [ ] `git diff --check` 和全部必需验证通过；未运行的可选检查及残余风险已说明。
- [ ] 实施完成后先展示变更、验证结果与提交计划，获得用户确认后再提交到 `main`；不自动推送。
