# 内容任务产品驱动实施计划

## 实施步骤

1. **契约与迁移**
   - [x] 更新 `contracts/openapi.yaml`：创建请求删除 `query_topic_id`，任务输出改为显式可空，修复上下文目标问题可空。
   - [x] 更新 `contracts/database.md`，记录 0019 的新写入语义、历史兼容和 downgrade 门禁。
   - [x] 新增 `backend/alembic/versions/0019_product_driven_tasks.py`，只放宽运行时列，不修改冻结历史 Schema。
   - [x] 更新 ORM 和 Pydantic Schema，并重新生成 `frontend/src/shared/api/schema.d.ts`。
2. **普通任务与生成链路**
   - [x] 删除普通任务创建的目标问题查询和写入。
   - [x] 生成快照只为历史任务加载并冻结真实 `query_topic`；新任务省略该键。
   - [x] 确定性开发生成器只在快照存在目标问题时输出对应段落。
   - [x] 保持自然化、重试和已写入快照完全不变。
3. **发布修复兼容**
   - [x] 修复上下文允许新任务没有目标问题，历史非空关联仍执行完整性检查。
   - [x] 修复任务原样继承可空关联。
   - [x] 修复页条件展示历史目标问题并修正文案。
4. **前端创建体验**
   - [x] 删除内容任务弹窗的目标问题查询、表单项及错误处理。
   - [x] 保持产品 -> 已批准事实版本的联动和可用平台筛选。
   - [x] 增加组件测试，断言弹窗无目标问题、无目标问题列表请求且提交体不含该字段。
5. **测试与文档**
   - [x] 增加迁移测试：历史 UUID 保留、升级后允许 `NULL`、有新任务时 downgrade 拒绝。
   - [x] 增加服务测试：产品驱动任务创建、生成快照无伪造问题、历史任务生成仍含真实问题、新旧修复任务继承正确。
   - [x] 更新纵向 E2E，创建内容任务时不创建或提交目标问题。
   - [x] 更新两份权威 GEO 方案文档，删除新任务必选目标问题的现行描述。
6. **一致性收尾**
   - [x] 重新检查所有 `query_topic_id` 调用点，确认剩余用途仅为目标问题管理、历史任务兼容和旧 GEO 观测。
   - [x] 检查代码、迁移、OpenAPI、数据库契约、生成类型、测试、任务文档和方案文档一致。

## 最小验证

```bash
make contract-generate
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test -- ContentTasksPage PublicationRepairPage
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app backend/alembic/versions/0019_product_driven_tasks.py backend/tests
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

## PostgreSQL 与纵向验证

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest backend/tests/integration -k 'migration or content_task or generation or repair'

make e2e
```

若本地环境无法满足完整 E2E，至少完成真实 PostgreSQL 迁移/服务集成测试和前端组件测试，并明确记录未执行项；不得用 SQLite 或伪造成功响应代替数据库语义。

## 关键测试矩阵

- 新普通任务请求不含 `query_topic_id`，数据库落 `NULL`，响应显式返回 `null`。
- 旧客户端提交额外 `query_topic_id` 被 `additionalProperties: false` 拒绝，不静默兼容。
- 新任务原始生成快照、用户消息和确定性草稿均没有“目标问题”占位内容。
- 历史任务继续把真实目标问题冻结进新作业，原有作业快照不变。
- 新任务的发布异常修复上下文返回 `query_topic=null`，修复任务继续为 `NULL`。
- 历史任务的修复上下文返回真实问题，修复任务继续继承 UUID。
- 0018 -> 0019 升级保留历史 UUID；存在空关联任务时 0019 downgrade 在改变列前失败。
- 目标问题设置和旧 GEO 模型观测继续可读，人工 GEO 文章观测不受影响。

## 风险文件

- `backend/app/services/content_production.py`：输入快照不可伪造或改写历史。
- `backend/app/services/publication.py` 与 `publication_queries.py`：新旧修复任务必须同时成立。
- `contracts/openapi.yaml`：创建与输出字段语义不同，不能继续用同一个必填定义误导生成类型。
- `backend/alembic/versions/0019_product_driven_tasks.py`：downgrade 必须先检查数据再恢复 `NOT NULL`。

## 回滚点

- 迁移前备份 PostgreSQL。
- 0019 尚无空关联任务时允许 downgrade；存在新任务后只前滚或恢复备份。
- 任一测试发现生成消息包含占位问题、历史关联丢失或修复上下文漂移时停止发布，不增加默认目标问题绕过。

## 停止条件

完成上述实现和验证后停止；不删除目标问题库、不清理历史任务、不自动提交、不推送、不部署。
