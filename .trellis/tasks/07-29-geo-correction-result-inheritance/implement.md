# DEF-04 实施计划

## 实施顺序

- [x] 重新读取 `prd.md`、`design.md`、本文件和相关前后端规范，确认任务已获实施批准后运行 `task.py start`。
- [x] 修改 `GeoObservationForm`：
  - [x] 更正模式从详情响应完整初始化可更正字段和逐篇结果；
  - [x] 更正表格使用详情逐篇数据，新建模式保留候选查询；
  - [x] 对历史 `null` 布尔事实保留未知并要求显式选择；
  - [x] 保持历史附件只展示、本次新增附件才提交；
  - [x] 删除错误的重置注释和逻辑，不新增 helper 层或状态源。
- [x] 更新前端针对性测试：
  - [x] 正常更正打开后完整预填；
  - [x] 两篇文章只修改一个字段，POST 其余字段不变；
  - [x] 历史未知值未选择时不提交，显式选择后提交真实值；
  - [x] 无新增附件时仍提交空 `attachment_file_ids`。
- [x] 强化既有后端人工 GEO 集成测试：
  - [x] 更正只改变一篇的一个事实；
  - [x] 原观测及原逐篇关系不变；
  - [x] 新记录 `supersedes_id` 正确、未修改事实保留、链尾切换。
- [x] 更新 GEO 设计文档和前端组件规范；复核 OpenAPI/数据库契约无需改动。
- [x] 执行必需验证，检查差异只包含 DEF-04 及用户追加确认的验证警告修复。
- [x] 修复验证环境警告：
  - [x] 在 Vitest 初始化中适配 jsdom 不支持的伪元素计算样式；
  - [x] 按 Starlette TestClient 契约加入 `httpx2` 开发依赖并更新锁文件；
  - [x] 重跑前后端定向测试，确认两类提示均消失。

## 必需验证

```bash
npm --prefix frontend run test:watch -- --run src/features/geo-observations/GeoObservationsPage.test.tsx
npm --prefix frontend exec -- eslint frontend/src/features/geo-observations/GeoObservationForm.tsx frontend/src/features/geo-observations/GeoObservationsPage.test.tsx
npm --prefix frontend run typecheck
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_publication_review_closure.py -k manual_geo_observation_uses_independent_facts_and_optional_evidence
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/tests/integration/test_publication_review_closure.py
docker compose --env-file .env -f deploy/compose.dev.yaml build backend-test
```

验证含义：

- 前端定向测试直接证明预填、单字段修改、未知值和请求载荷。
- 后端定向集成测试直接证明追加式持久化链和原记录不可变。
- ESLint、TypeScript 与 Ruff 覆盖本次触及语言边界。

## 可选全量验证

```bash
npm --prefix frontend run test
make contract-check
make test-integration
```

- 前端全量测试用于排除共享页面回归；若定向测试、lint 和 typecheck 已通过，可因耗时跳过并说明残余风险。
- `contract-check` 仅在 OpenAPI 或生成类型出现差异时升级为必需；本设计不改 Schema。
- 全量后端集成测试在发布准备或定向测试暴露共享问题时运行，不默认扩大验收成本。

## 风险与回滚点

- 风险：补采前 `null` 布尔值无法直接满足创建契约。处理方式是保留未知并阻止未确认提交，不转换为 `false`。
- 风险：原记录与当前候选文章集合不同。处理方式是提交完整原基线并由服务端现有 `GEO_PUBLICATIONS_CHANGED` 事务校验拒绝，不在前端补值。
- 风险：Ant Form 的异步详情初始化可能被候选查询 effect 再次覆盖。实现后必须确认更正模式不运行新建候选初始化路径。
- 回滚点：本任务无迁移和数据写入脚本，撤销前端、测试和文档差异即可。

## 审查门

- [x] `prd.md`、`design.md`、`implement.md` 无阻塞问题并获得用户明确批准。
- [x] 任务状态在编码前由 `planning` 切换为 `in_progress`。
- [x] 最终差异不包含用户已有的 `docs/deployed-full-functional-acceptance-plan.md`。
- [x] 不提交、不推送、不处理其他验收缺陷。
