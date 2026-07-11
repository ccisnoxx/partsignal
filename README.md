# PartSignal

PartSignal（元件信号）是面向电子元器件国产替代业务的多平台 GEO 内容运营系统。

系统以经过审核的产品事实为唯一来源，使用 AI 生成适配官网、行业网站、论坛和问答平台的差异化内容，并通过人工审核、人工发布登记和 GEO 观测形成运营闭环。

## 当前范围

- 产品、参考型号、替代关系和证据管理。
- 不可变事实版本和审核流程。
- 多平台差异化内容生成与版本管理。
- 人工发布登记和发布页面验证。
- AI 搜索提及、推荐、引用和准确性观测。
- 第一阶段不实现跨平台自动发布。

## 技术基线

- 前端：React、TypeScript、Vite。
- 后端：Python、FastAPI、Pydantic、SQLAlchemy、Alembic。
- 数据：PostgreSQL、Celery、Redis。
- 文件：阿里云 OSS。
- 部署：Docker Compose、Nginx、双 VPS WireGuard 入口。

## 项目文档

- [项目会话归档](./docs/GEO项目会话归档.md)
- [产品与业务方案](./docs/GEO多平台内容运营系统方案设计.md)
- [前后端技术与部署方案](./docs/GEO系统前后端技术与部署方案.md)
- [实现架构](./docs/architecture.md)
- [本地开发](./docs/development.md)
- [测试策略](./docs/testing.md)
- [部署与运维](./docs/operations.md)
- [Hostdzire 部署上线 Runbook](./docs/Hostdzire部署上线流程.md)

## 状态

MVP 纵向闭环已实现，采用契约优先的前后端并行开发。默认开发配置只使用虚构数据、确定性生成器和独立开发对象存储；真实模型、生产 OSS、生产 VPS 与跨平台自动发布均未启用。

## 开发入口

```bash
make bootstrap
make dev
```

常用质量检查：

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

HTTP 契约位于 `contracts/openapi.yaml`，数据库和状态机契约位于 `contracts/database.md`。生产内容生成固定使用管理员配置的 OpenAI-compatible Chat Completions 渠道；API Key 与敏感 Header 由 `AI_CREDENTIAL_ENCRYPTION_KEY` 加密，作业只保存非敏感快照。本地和自动化测试可以显式使用确定性生成器，但不会在真实调用失败时自动回退。生产 OSS 仍只有在显式配置 `OBJECT_STORAGE_BACKEND=aliyun_oss` 时启用。
