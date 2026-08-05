# 实施计划

## 实施前检查

- [x] 用户在本规划摘要之后明确批准启动实现。
- [x] 执行 `task.py start`，确认任务状态进入 `in_progress`。
- [x] 使用 `trellis-before-dev` 重新加载合同、数据库、发布工作台和前端组件规范。
- [x] 确认主工作目录仍在 `main`，且除本任务规划文件外没有未识别改动。

## 阶段 1：权威合同与设计

- [x] 修改 `contracts/openapi.yaml`，从 `PublicationWorkCreate`、`PublicationPreparationUpdate`、`PublicationWork`、`PublicationWorkListItem`、`PublishedArticleOut` 删除 `section_url` 及 required 项。
- [x] 更新 `contracts/database.md`，登记新 migration revision、列删除、守卫变化、数据丢弃与不可逆降级。
- [x] 更新 `.trellis/spec/backend/publication-workbench-guidelines.md`，明确开始发布只需要内容版本和账号，准备更新只变更账号，`final_url` 仍是公开地址。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md` 的当前发布流程和表结构；不改历史归档。

## 阶段 2：数据库与后端根因删除

- [x] 新增 `backend/alembic/versions/0036_remove_publication_section_url.py`，替换守卫函数后删除列；`downgrade()` 以 `55000` 拒绝。
- [x] 从 `PublicationWork` ORM 删除列。
- [x] 从创建、准备更新、工作列表/详情和发布成果 Pydantic schema 删除字段。
- [x] 从发布服务删除创建幂等地址比较、开始/准备阶段地址域名校验、赋值与更新；保留 `final_url` 的域名校验。
- [x] 从查询投影删除字段，不增加兼容输出。

## 阶段 3：生成类型与前端

- [x] 运行 `make contract-generate`，仅通过 OpenAPI 更新 `frontend/src/shared/api/schema.d.ts`。
- [x] 从 `PublicationsPage.tsx` 删除开始发布和准备更新中的栏目地址表单、初始值及 payload 映射。
- [x] 删除工作/成果详情中的栏目地址展示；保留账号、最终 URL、发布时间、核验和问题信息。
- [x] 更新前端组件 fixture 和请求断言，证明请求体不含已删除字段。

## 阶段 4：回归测试

- [x] 更新 `backend/tests/integration/test_publication_workflow.py` 的创建数据，并保留/补强 `final_url` 域名拒绝覆盖。
- [x] 在 `backend/tests/integration/test_migrations.py` 新增 0035→0036 测试：既有行升级、列不存在、其余字段保留、账号冻结和其他守卫有效、降级返回 `55000`。
- [x] 仅更新当前 head 场景；验证旧 revision 的历史 fixture 不改写。
- [x] 更新 `frontend/src/features/publications/PublicationsPage.test.tsx`，覆盖表单字段、请求体和详情展示。
- [x] 更新 `frontend/tests/e2e/mvp-flow.spec.ts` 与 `frontend/tests/e2e/shared-data.setup.ts` 的创建请求；共享数据准备已通过无字段请求创建发布工作，全量流程中的 AI 作业因 Celery 未消费停在 `PENDING`，未进入后续发布步骤。

## 必需验证

先运行直接证明本次行为的定向检查：

```bash
make contract-generate
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py \
  backend/tests/integration/test_migrations.py -k 'publication or section_url'
npm --prefix frontend exec -- vitest run \
  src/features/publications/PublicationsPage.test.tsx
make lint
make typecheck
git diff --check
```

该变更涉及公共 API、数据库 schema、状态守卫和发布主流程，提交前还必须运行发布级完整门禁：

```bash
make verify
```

若定向迁移筛选无法覆盖新测试名称，应改为显式测试节点或完整运行 `backend/tests/integration/test_migrations.py`，不得用 SQLite 替代 PostgreSQL。每次失败只修复经证据确认属于本任务的原因，不扩展处理既有或无关失败。

## 完成前审查

- [x] `rg -n 'section_url|栏目地址'` 的剩余命中逐项归类，仅允许旧迁移、冻结迁移快照、历史归档、验旧迁移 fixture、删除迁移说明/回归断言和历史验收制品。
- [x] 检查最终 diff 不含可选兼容字段、隐藏默认值、占位 URL、重复域名校验或静默回退。
- [x] 确认 0034、0035 和 `backend/app/migration_schema_v1.py` 未修改。
- [x] 确认 `final_url` 校验、账号门禁、revision、状态守卫和历史不可删除行为未弱化。
- [x] 确认代码、OpenAPI、数据库合同、生成类型、测试和当前设计文档一致。

## 验证结果

- 通过：合同生成与一致性检查、lint、后端和前端类型检查、后端 154 个单元测试、54 个 PostgreSQL 集成测试、前端 190 个组件测试、24 个视觉合同测试、前后端 Docker 构建、开发/生产 Compose 配置解析、差异空白检查。
- 全量 E2E：51/52 通过；唯一失败发生在发布步骤之前，AI 生成作业 30 秒内持续为 `PENDING`，表明 Celery 未消费。该用例中本任务唯一改动位于后续发布请求，只删除 `section_url`，没有证据将失败归因于本任务，故未修改代码或无依据重跑。

## 风险与回退点

- 数据风险：升级会永久删除既有 `section_url` 值；执行生产迁移前必须确认可恢复数据库备份。
- 版本风险：旧前端会发送被新合同拒绝的额外字段，新前端也不能配合旧后端；前后端与迁移必须同版本发布。
- 守卫风险：替换 PostgreSQL 函数时必须以 0035 定义为基线，只删除 `section_url` 比较，避免遗漏其他不可变规则。
- 回退方式：实现提交前可撤销代码改动；生产迁移后不得执行伪降级，只能回滚应用并恢复迁移前数据库备份。

## 后续操作边界

本计划不授权提交、推送或部署。代码验证完成后先提交精确 commit 计划并取得确认，再执行 Git 操作；线上发布需另行明确授权。
