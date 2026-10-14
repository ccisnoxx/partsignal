# PartSignal

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

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

- 前端：`frontend/` 是唯一源码 owner，使用 React、TypeScript、Vite、TanStack Router、TanStack Query、Tailwind CSS、shadcn/ui 与 Base UI。
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
- [Hostdzire 部署附录](./docs/Hostdzire部署附录.md)

## 状态

MVP 纵向闭环已实现，采用契约优先的前后端开发。默认开发配置使用虚构数据和独立开发对象存储；`CONTENT_GENERATOR=deterministic` 关闭正式生成、自然化和重试，不产生假 AI 内容。真实生成需要管理员配置合格的渠道/模型，并显式使用 `openai-compatible`。Hostdzire 已有 Production 内部试运行记录，现场状态与未完成验收见 [开发预览说明](./docs/development-preview.md)；仓库默认值不能证明线上能力已启用。跨平台自动发布仍属后续范围。

## 开发入口

```bash
make bootstrap
make dev
```

手工分层质量检查：

```bash
make check-fast          # 小任务；也可只选 check-backend-fast / check-frontend-fast
make check-ai            # AI 切片；需专用测试 PostgreSQL
make check-geo           # API/人工 GEO 切片；需专用测试 PostgreSQL
make verify-release      # 准备部署指定 commit；make verify 是完整兼容别名
```

具体范围、前置条件与其他领域过滤示例见 [测试策略](./docs/testing.md#手工分层命令)。GitHub 只用于代码备份与服务器拉取，仓库不运行 Actions 工作流；Docker 交付可按 commit SHA 追踪，不要求 GitHub Release 或 Git tag。已有独立契约、静态、单元、集成、构建和 E2E 入口继续可用。

HTTP 契约位于 `contracts/openapi.yaml`，数据库和状态机契约位于 `contracts/database.md`。AI 调用使用官方 `openai` Python SDK，继续 OpenAI-compatible Chat Completions，SDK 自动重试关闭（`max_retries=0`）；Base URL、模型、API Key 和受支持 Header 由管理员配置。应用负责凭据加密、业务快照、`PUBLIC` 数据门禁、严格输出 Schema、状态机、审计和指标；不实现自研 DNS pinning、TCP peer、TLS 或 HTTP/1.1 传输。详细边界见 [实现架构](./docs/architecture.md#外部适配器) 和 [SDK 维护记录](./docs/maintenance/openai-sdk-refactor/README.md)。本地测试使用显式替身；真实调用失败不会自动回退。生产 OSS 仍只有在显式配置 `OBJECT_STORAGE_BACKEND=aliyun_oss` 时启用。

当前仍处于开发阶段。2026-08-29 起，原 Frontend V2 已提升为 canonical `frontend/`，旧 V1 源码与双前端构建/测试入口已退役；Production 发布、Hostdzire 流量切换和生产观察不由这次仓库切换触发。
