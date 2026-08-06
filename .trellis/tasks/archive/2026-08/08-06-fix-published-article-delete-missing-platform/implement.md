# 修复已删平台来源的发布成果永久删除：实施计划

## 阶段 1：数据库合同

- [x] 新增 `0039` Alembic revision，允许 `archived_at` 与 `CANCELLED` 正交共存；无数据重写，downgrade 对已存在的新合法状态明确阻断。
- [x] 更新 `contracts/database.md`、数据库规范、发布工作台规范和 GEO 方案设计，统一来源任务状态分支。

## 阶段 2：服务与界面

- [x] 修改 `permanently_delete_published_article`：实时平台存在时恢复 `OPEN`，平台已删除时转为 `CANCELLED`，两者都递增 revision 并保留归档标记。
- [x] 让删除成功审计文本准确表达实际来源任务结果，不增加审计详情或第二状态源。
- [x] 更新发布成果永久删除确认文案，明确发布内部历史是删除范围、外部页面不会删除，以及来源任务的两种确定结果。

## 阶段 3：回归测试

- [x] 新增 PostgreSQL 集成测试：成功发布并归档任务、停用并删除平台、永久删除成果，断言任务转为已归档 `CANCELLED`、内部历史清理、批准内容保留。
- [x] 更新前端组件测试，冻结新的条件确认文案；保留现有请求载荷和刷新行为断言。

## 必需验证

```sh
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest -q tests/integration/test_publication_workflow.py::test_published_article_delete_cancels_source_task_when_platform_was_deleted \
            tests/integration/test_publication_workflow.py::test_published_article_permanent_delete_restores_source_task_and_owned_history \
            tests/integration/test_publication_workflow.py::test_published_article_delete_blocks_distinct_geo_history_and_optimization_source

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/models/content.py \
  backend/app/services/publication.py \
  backend/alembic/versions/0039_published_article_delete_missing_platform.py \
  backend/tests/integration/test_publication_workflow.py

(cd frontend && npm exec -- vitest run src/features/publications/PublicationsPage.test.tsx)
npm --prefix frontend run typecheck
```

## 验证结果（2026-08-06）

- PostgreSQL 目标集成测试：3 passed。
- 前端组件测试：1 个文件、15 个测试通过，耗时 31.21 秒。
- 前端 TypeScript 类型检查：通过。
- Ruff：通过。
- Alembic：`0039_article_delete_platform (head)`。

## 可选重验证

本次不默认运行完整后端集成套件、完整前端测试、生产构建或 E2E；变更未修改 API 形状、通用组件或浏览器交互流程。若目标检查暴露跨模块影响，再运行对应更宽检查，不把无因果失败扩入任务。

## 回滚点与完成检查

- 服务和文案修改可通过普通前向修复回退；不得使用破坏性 Git 命令。
- `0039` 上线后若已有归档 `CANCELLED` 数据，禁止直接 downgrade；应用前滚修复或恢复匹配备份。
- 完成前检查 diff，不得混入现有 `.playwright-cli/`，并核对代码、迁移、合同、规范、测试和确认文案一致。
- 提交前按项目规则向用户展示提交计划并取得确认；不自动推送。
