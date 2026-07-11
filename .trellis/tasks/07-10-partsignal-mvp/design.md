# PartSignal MVP Technical Design

## Architecture

单仓库模块化单体。前端按业务 feature 组织，后端按 `product_facts`、`content_planning`、`content_production`、`review`、`publication`、`geo_observation`、`files`、`identity`、`audit` 组织。跨模块只通过应用服务和稳定 ID 协作。

PostgreSQL 是业务状态权威来源。Redis 只传递 Celery 消息，Worker 只接收 `generation_job_id`。OSS 和 LLM 通过适配器边界接入；MVP 默认使用明确的开发适配器。

## Contracts

- `contracts/openapi.yaml` 是前后端 HTTP 契约唯一来源。
- `contracts/database.md` 定义表所有权、状态机、不可变约束和迁移顺序。
- API 使用 `/api/v1`、UUID、UTC RFC3339、snake_case 和统一错误信封。
- 前端生成 OpenAPI 类型，不手写重复 DTO；后端导出的运行时 OpenAPI 必须通过语义比较。

## Core Invariants

- 已批准 `FactVersion` 只允许状态转为 `RETIRED`，快照字段禁止更新。
- `ContentVersion` 正文字段在创建后禁止更新；编辑创建新版本。
- 生成、内容批准和人工发布均再次检查绑定事实状态。
- `PublicationRecord.content_version_id` 永不变更，状态变化写入事件历史。
- `GeoObservation`、审核记录和审计记录只追加。
- 所有状态转换使用命令接口，不允许通用 PATCH 修改状态。

## Security And External Services

内部账号使用 Argon2、PostgreSQL 服务端会话、Secure/HttpOnly/SameSite Cookie 和 CSRF Header。账号类型收敛为 `ADMIN` 与 `ENGINEER`；创建者可以显式批准自己的事实或内容，但其他证据、质量、状态和审计约束保持不变。

真实生成通过配置中心选择 OpenAI-compatible 渠道、模型和平台 Prompt，作业冻结完整非敏感输入快照；开发生成器只用于本地和自动化测试。开发对象存储提供与上传意图一致的直传和 HEAD 校验，不伪装成生产 OSS。

## Delivery Boundaries

主 Agent 写根目录、契约、部署、CI 和文档。后端子 Agent 仅写 `backend/`，前端子 Agent 仅写 `frontend/`。契约冻结后才允许并行实现，契约变更必须由主 Agent 串行发布。
