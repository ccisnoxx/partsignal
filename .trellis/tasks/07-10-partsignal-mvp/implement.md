# PartSignal MVP Implementation

## Ordered Work

- [x] 建立 `agent/mvp`、项目 AGENTS、根命令、数据库/OpenAPI 契约和开发 Compose。
- [x] 初始化身份、审计、会话、RBAC、健康检查和前端受保护应用壳。
- [x] 实现产品事实、证据、不可变事实版本和事实审核。
- [x] 实现问题、平台规则和内容任务。
- [x] 实现 GenerationJob、Celery、确定性生成器、质量检查和内容草稿。
- [x] 实现 Markdown 修订、版本比较和内容审核。
- [x] 实现人工发布候选、发布包、PublicationRecord 和状态事件。
- [x] 实现追加式 GEO 观测和基础指标。
- [x] 实现上传意图、开发对象存储、文件验证和附件关联。
- [x] 完成 CI、生产配置模板和运维文档；全链路运行验收等待 Docker 环境。

## Per-Milestone Gate

每阶段先由主 Agent 更新契约，随后后端与前端子 Agent 并行实现，最后主 Agent 运行契约检查、目标单测、PostgreSQL/Redis 集成测试和相关 E2E。检查失败不得进入下一阶段。

## Validation

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose -f deploy/compose.dev.yaml config
```

最终验证必须从空数据库运行 Alembic，使用真实 PostgreSQL/Redis 与显式开发适配器完成完整业务流。不得使用 SQLite 或固定成功响应替代业务逻辑。

## Git

只有主 Agent 可切换分支、暂存和提交。每个通过检查的里程碑独立提交；不得暂存现有未跟踪的 `.agents/`、`.codex/` 或与 MVP 无关的 `.trellis/` 内容。
