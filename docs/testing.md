# PartSignal 测试策略

## 层级

- 后端单元测试覆盖状态机、账号类型、凭据加密、SSRF/Header 边界、严格模型响应、快照、生成质量规则、指标和文件校验。
- 后端集成测试使用 PostgreSQL 和 Redis，不使用 SQLite 替代数据库约束。
- 前端使用 Vitest 和 Testing Library 覆盖表单、权限、错误和状态交互。
- Playwright 覆盖批准事实到发布登记和 GEO 观测的主流程，并通过 Redis、真实 Celery Worker 与本机 OpenAI-compatible HTTP 替身执行生成；不得使用 eager 模式或确定性生成器绕过消息链路。
- 契约检查比较提交 OpenAPI、FastAPI 运行时 Schema 和前端生成类型。

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

测试替身必须显式配置。确定性生成器不得补充输入事实中不存在的参数，fake OpenAI-compatible 服务必须走真实 HTTP 客户端、固定路径和严格响应解析，开发对象存储必须实际保存上传字节并执行 HEAD 元数据校验。

`make e2e` 需要本机已有 PostgreSQL、Redis 和 Playwright Chromium；CI 使用服务容器执行同一脚本。使用开发 Compose 基础设施时先执行 `make dev-infra`，再显式传入宿主机连接：

```bash
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
```

真实 OSS、真实模型和生产网络不属于普通测试门禁。可选真实模型 smoke test 必须使用专用低权限 Key，缺少 Key 时明确跳过，不能把固定成功替身表述为真实云端成功。
