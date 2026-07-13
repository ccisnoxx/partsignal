# PartSignal 测试策略

## 层级

- 后端单元测试覆盖状态机、账号类型、凭据加密、SSRF/Header 边界、严格模型响应、快照、生成质量规则、指标和文件校验。
- 后端集成测试使用 PostgreSQL 和 Redis，不使用 SQLite 替代数据库约束。
- 前端使用 Vitest 和 Testing Library 覆盖表单、权限、错误和状态交互。
- Playwright 覆盖批准事实到发布登记和 GEO 观测的主流程，并通过 Redis、真实 Celery Worker 与本机 OpenAI-compatible HTTP 替身执行生成；不得使用 eager 模式或确定性生成器绕过消息链路。
- 契约检查比较提交 OpenAPI、FastAPI 运行时 Schema 和前端生成类型。
- 结构重构还需比较 ORM metadata 表集合、mapper 数、Alembic head、迁移历史和生产 preflight 输出，证明物理移动未改变数据库语义。

## 命令

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make e2e
make build
make verify
```

测试替身必须显式配置。确定性生成器不得补充输入事实中不存在的参数，fake OpenAI-compatible 服务必须走固定目的地址 HTTP 传输、固定路径和严格响应解析；本地 CA/HTTPS 测试必须验证 SNI、Host、证书 hostname、peer 越界零发送、重定向和响应上限。开发对象存储必须实际保存上传字节并执行 HEAD 元数据校验。

第三方模型测试数据必须显式标记完整生成输入为 `PUBLIC`，且绑定事实快照中的每条 Evidence 都是 `PUBLIC`。迁移测试必须证明历史任务仍为未分级，创建、重试和 Worker 防御校验必须覆盖 `AI_DATA_CLASSIFICATION_FORBIDDEN`，不得在 fixture 中用默认值绕过门禁。

阶段二 PostgreSQL 集成测试必须同时覆盖 API 与数据库平台一致性、同平台不同账号、任务取消在途门禁、两条发布并发验证只完成任务一次、重复验证拒绝、并发发布失效唯一待办、修复上下文固定与候选复核、显式解决以及 `0013` 前滚策略。数据库反例还必须证明待办不能直接以 `RESOLVED` 插入或删除。审核测试覆盖事实/内容提交、退回、重新提交、批准的追加式历史，事实与内容的空退回意见、冻结事实证据、版本差异和阻断质量问题。前端组件测试消费生成类型，验证匹配账号、服务端 `available_actions`、冻结审核上下文、显式批准和非空异常处置；不得用页面本地状态机替代服务端。

上线门禁测试在 `0012` 历史 Schema 上运行 `python -m app.cli preflight-integrity`，断言稳定 ID、原因码和非零退出；随后证明 `0013` 迁移本身同样阻断，且不产生部分表或版本前进。合法历史必须按追加式 `VERIFIED` 状态事件识别：发布后来移除时任务仍可保持完成；已显式进入拒绝、移除或验证失败的旧错绑保留历史但不再阻断。

`make e2e` 需要本机已有 PostgreSQL、Redis 和 Playwright Chromium；CI 使用服务容器执行同一脚本。使用开发 Compose 基础设施时先执行 `make dev-infra`，再显式传入宿主机连接：

```bash
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
```

真实 OSS、真实模型和生产网络不属于普通测试门禁。可选真实模型 smoke test 必须使用专用低权限 Key，缺少 Key 时明确跳过，不能把固定成功替身表述为真实云端成功。

行为保持重构必须先运行基线，再按独立切片执行定向回归，最终运行完整契约、lint、typecheck、单元、PostgreSQL 集成、前端组件、构建和 Playwright 流。最终差异审计还要确认 Router 不含事务或实体写入、Schema 与 ORM 调用方均直接导入权威领域模块、React Query 键没有页面内第二来源，并确认迁移和公共契约相对重构前无新增差异。
