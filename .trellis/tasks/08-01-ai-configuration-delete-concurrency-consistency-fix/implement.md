# AI 配置删除并发一致性修复：实施计划

## 0. 开始门禁

- [x] 用户评审并批准 `prd.md`、`design.md`、`implement.md`。
- [x] 获得批准后运行 `python3 ./.trellis/scripts/task.py start 08-01-ai-configuration-delete-concurrency-consistency-fix`；批准前不改产品代码。
- [x] 运行 `trellis-before-dev`，完整读取任务文档、AI 配置规范、待修改服务文件和测试文件。
- [x] 确认主工作区仍为 `main`；保留并排除用户既有 `.playwright-cli/` 与 `frontend/.playwright-cli/` 诊断产物。

## 1. 固化原缺陷证据

- [x] 用归档 `PS-QA2-DELETE-001` 和 `delete-concurrency-probe.py` 确认旧实现的渠道/Header 结果均为 `204/204`、成功审计数 2。
- [x] 确认 OpenAPI 现有 `204/404`、路由 ADMIN/CSRF 边界及模型删除 `FOR UPDATE` 正确对照，避免修改无关合同。

## 2. 修复服务端目标所有权

- [x] 在 `delete_ai_channel` 中锁定目标渠道后再判断存在、追加审计和删除。
- [x] 在 `delete_ai_channel_header` 中锁定目标 Header 后再读取父渠道、执行失效、追加审计和删除。
- [x] 保持既有错误码、审计字段、渠道级联、Header 失效副作用和事务提交边界不变。
- [x] 不增加通用锁框架、兼容分支、请求去重或前端防重逻辑。

## 3. 增加永久 PostgreSQL 回归

- [x] 在 `test_ai_channel_management.py` 复用现有隔离库与 FastAPI 依赖覆盖，构造渠道及 Header/模型目标。
- [x] 用两个独立客户端/会话和 `Barrier` 覆盖渠道同目标并发删除，断言 `[204, 404]`、目标及子配置删除、一条成功审计。
- [x] 覆盖 Header 同目标并发删除，断言 `[204, 404]`、Header 删除、一条成功审计，以及渠道/模型只失效并增加 revision 一次。
- [x] 所有并发等待均有超时，并通过上下文管理、`finally`、pytest finalizer 和隔离库强制删除完成清理。
- [x] 先在旧实现上确认新增测试捕获到渠道 `[204, 204]`，再应用修复并验证转绿；断言保持严格 `[204, 404]`。

## 4. 同步稳定规范

- [x] 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`，记录目标行锁、单一成功审计和 `204/404` 并发合同。
- [x] 确认 OpenAPI、数据库合同、迁移、前端和部署无需修改。

## 5. 必需验证

按失败归因规则执行，修复前后只重跑能被当前改动影响的检查：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_ai_channel_management.py -q
make test-integration
make contract-check
make lint
make typecheck
```

- [x] 定向 AI 渠道管理集成测试通过，且新增并发用例实际使用 PostgreSQL。
- [x] 完整 PostgreSQL 集成测试通过，无其他删除、审计或配置状态回归。
- [x] 合同、Ruff/ESLint 和 mypy/TypeScript 检查通过。
- [x] 每次隔离数据库均已删除，开发 PostgreSQL/Redis/API/Worker/Scheduler/前端状态不被测试污染。

## 6. 可选验证

- `make test-unit`：本任务未修改单元边界或前端，只有定向/完整集成失败指向相关共享代码时再运行。
- `make e2e`：公开 API 结构和前端不变，默认不重复整套 E2E；需要发布级信心时再运行。
- `make build`：无依赖、Dockerfile 或构建配置变化，默认跳过。
- 第二轮 `delete-concurrency-probe.py`：可作为 13 个 DELETE 的补充验收，不替代永久集成测试。

## 7. 完成与提交门禁

- [x] 运行 `trellis-check`，检查服务调用链、锁前后审计、测试隔离和规范一致性。
- [x] 运行 `trellis-update-spec` 判定；规范已在第 4 节同步，未重复写其他规范。
- [x] `git diff --check` 通过；任务差异仅为计划中的服务、集成测试、AI 配置规范和 Trellis 任务资料，用户既有 Playwright 产物保持未跟踪且明确排除。
- [x] 向用户报告行为变化、验证结果和剩余风险，提交前单独列出范围并取得批准；不自动推送。

## 8. 实施证据

- 启动：`task.py start` 已将任务从 `planning` 切换为 `in_progress`。
- 红灯：旧服务实现下新增并发测试得到渠道状态 `[204, 204]`，并出现重复删除告警，证明回归用例命中原竞态。
- 绿灯：新增并发用例和整个 `test_ai_channel_management.py` 均通过。
- 完整集成：`make test-integration` -> `69 passed in 86.70s`。
- 质量门禁：`make contract-check`、`make lint`、`make typecheck` 均通过。
- 环境：不存在残留 `partsignal_ai_*` 数据库；开发 API、PostgreSQL、Redis、Worker、Scheduler 和前端容器保持运行。
- 可选门禁：未运行 `make test-unit`、`make e2e`、`make build`；本任务未修改单元边界、前端、依赖或构建配置，必需的真实 PostgreSQL 集成、合同、lint 和类型检查已经覆盖变更风险。
