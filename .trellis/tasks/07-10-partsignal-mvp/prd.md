# PartSignal MVP

## Goal

交付一个可本地运行和自动验收的多平台 GEO 内容运营 MVP，打通“批准事实 → 内容任务 → 异步生成草稿 → 人工编辑审核 → 人工发布登记 → GEO 观测”的纵向闭环。

## Confirmed Requirements

- 使用模块化单体、React 前端、FastAPI 后端、PostgreSQL、Celery 和仅作 Broker 的 Redis。
- Markdown 是唯一可编辑正文源；HTML 和纯文本必须派生生成。
- `FactVersion`、`ContentVersion`、`PublicationRecord` 和 `GeoObservation` 分别拥有独立生命周期。
- 已批准事实和内容版本不可原地修改；AI 输出只能创建草稿；未批准内容不能发布。
- MVP 使用内部账号、PostgreSQL 会话、RBAC、CSRF，并禁止事实或内容创建者自审。
- 采用契约优先流程，`contracts/openapi.yaml` 和 `contracts/database.md` 由主 Agent 独占维护。
- 后端子 Agent 只修改 `backend/`，前端子 Agent 只修改 `frontend/`，所有 Git 操作由主 Agent 执行。
- 本次不连接真实大模型、生产 OSS、生产 VPS 或外部发布平台；测试替身必须显式标记且不能掩盖业务失败。

## Acceptance Criteria

- [ ] `make dev` 可启动前端、API、Worker、PostgreSQL 和 Redis，数据库迁移成功。
- [ ] 用户可登录，权限和禁止自审规则由服务端执行并有审计记录。
- [ ] 可录入产品、参考型号、参数、替代关系和证据，并批准不可变 `FactVersion`。
- [ ] 可创建问题、平台配置和绑定已批准事实的 `ContentTask`。
- [ ] Celery 可基于确定性开发生成器创建且只创建一个 `DRAFT ContentVersion`。
- [ ] 人工编辑通过新版本完成，可比较版本、退回和批准，Markdown 不存在第二可编辑副本。
- [ ] 只有批准内容可创建人工 `PublicationRecord`，并可记录审核中、已发布、验证、拒绝和下线。
- [ ] 可追加 `GeoObservation` 并计算提及率、推荐率、引用率和参数准确率。
- [ ] 文件上传使用上传意图和浏览器直传契约，本地通过显式假 OSS 服务验收。
- [ ] OpenAPI、Pydantic 运行时 Schema 和前端生成类型无漂移。
- [ ] 后端测试、前端测试、类型检查、构建、迁移检查、端到端测试和 Compose 配置检查通过。
- [ ] README、AGENTS.md、架构、开发、测试和部署文档与实现一致。

## Out Of Scope

- 跨平台自动发布、CDP、验证码处理和平台账号凭据。
- 真实大模型调用、自动 GEO 模型监测和自动替代结论。
- 微服务、LangChain、Redux、Kubernetes、Elasticsearch、WebSocket 和复杂规则引擎。
- 生产基础设施、生产 OSS、真实产品数据导入、OCR 和文档自动解析。
