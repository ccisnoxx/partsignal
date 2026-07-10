# PartSignal 测试策略

## 层级

- 后端单元测试覆盖状态机、权限、快照、生成质量规则、指标和文件校验。
- 后端集成测试使用 PostgreSQL 和 Redis，不使用 SQLite 替代数据库约束。
- 前端使用 Vitest 和 Testing Library 覆盖表单、权限、错误和状态交互。
- Playwright 覆盖批准事实到发布登记和 GEO 观测的主流程，并通过 Redis 与真实 Celery Worker 执行确定性生成作业；不得使用 eager 模式绕过消息链路。
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

测试替身必须显式配置。确定性生成器不得补充输入事实中不存在的参数，开发对象存储必须实际保存上传字节并执行 HEAD 元数据校验。

`make e2e` 需要本机已有 PostgreSQL、Redis 和 Playwright Chromium；CI 使用服务容器执行同一脚本。真实 OSS、真实大模型和生产网络不属于普通测试门禁，只有取得明确批准和隔离测试配置后才能验证。
