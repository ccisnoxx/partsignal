# PartSignal 实现架构

## 边界

PartSignal 是前后端分离的模块化单体。HTTP 契约位于 `contracts/openapi.yaml`，数据库所有权和状态机位于 `contracts/database.md`。前端只依赖生成的 OpenAPI 类型，后端运行时 Schema 必须与提交契约一致。

后端模块分别拥有产品事实、内容策划、内容生产、AI 与平台配置、审核、发布、GEO 观测、文件、身份和审计。跨模块通过应用服务和稳定 ID 协作，不直接修改其他模块的数据。`users.account_type` 是 `ADMIN` / `ENGINEER` 权限唯一来源；管理员包含全部工程师能力。

## 内部代码边界

FastAPI Router 只负责 HTTP 参数、认证与权限依赖、响应投影和业务错误映射；事务、行锁、乐观锁复核、状态转换、跨实体协调与审计由领域应用服务拥有。简单读取和无共享业务不变量的局部操作可直接留在 Router，不为分层形式增加只转发调用的 Service 或 Repository。发布域因命令协调和查询投影均有独立复杂度而分为 `publication` 与 `publication_queries`，其他领域不强制套用读写分离模板。

Pydantic Schema 按接口领域放在 `app.schemas` 子模块，调用方直接导入所属模块，包入口不维护兼容性重导出。SQLAlchemy 映射按稳定数据领域放在 `app.models` 子模块，全部继承同一个 `app.db.Base`，跨域外键继续使用字符串表名；`app.models.__init__` 只导入模块以完成 mapper 和 metadata 注册。该物理拆分不改变表名、约束、枚举、迁移图或公共 Schema。

前端页面在职责已稳定混合时拆为路由容器、领域面板或表单，例如配置中心、发布流程和内容修订；简单页面仍保持单文件。所有 API 数据类型继续来自 OpenAPI 生成产物，React Query 键由 `shared/api/queryKeys.ts` 唯一登记并保持原数组前缀语义，不建立第二套接口或业务状态机。

## 数据所有权

PostgreSQL 保存全部业务状态。Redis 只传递 Celery 消息，消息只包含 `generation_job_id`。对象存储保存文件字节，数据库保存文件元数据、哈希和业务引用。

`FactVersion`、`ContentVersion`、AI 作业输入快照、发布状态事件、GEO 观测和审计记录构成不可变历史。可编辑事实工作区、任务 `user_prompt`、平台 Prompt、全局自然化 Prompt 和当前配置使用乐观锁，状态转换由明确命令完成。模型输出不自报事实或证据 ID，追溯以作业快照和绑定事实版本为准。自然化结果不覆盖正文：它是 `based_on_id` 指向源版本、`source_job_id` 指向 `HUMANIZE` 作业的新 AI 草稿。

## 发布与审核应用服务

发布应用服务唯一拥有发布状态转换、任务自动完成、取消门禁、发布异常和修复任务。发布账号必须与任务锁定平台一致，服务层给出明确业务错误，PostgreSQL 触发器提供最终约束。首条 `VERIFIED` 发布与任务 `COMPLETED`、状态事件和审计在同一事务提交；后续 `REMOVED` 或 `VERIFICATION_FAILED` 不回退任务，只创建唯一 `PublicationAttention`。异常的修复任务和显式解决是两个独立命令，Dashboard 只统计 `OPEN PublicationAttention`。

审核应用服务唯一拥有事实/内容审核状态机、非空退回意见、内容质量门禁、审核记录追加和 `available_actions` 投影。`FactReviewContext` 与 `ContentReviewContext` 从不可变目标版本、任务锁定事实、原始生成快照、完整自然化链、证据文件状态和追加式历史一次装配；前端不再从当前事实工作区或多个独立请求拼接审核依据。Router 只映射路径、请求与响应，不保存第二套状态转换表。

## 外部适配器

内容生成固定接入 OpenAI-compatible Chat Completions，不探测 Responses API 或其他协议。原始生成与可选自然化共用 `generation_jobs`、同一个 Celery task、补投递、租约恢复和指标来源；`job_type` 只选择严格快照和落库关系，不建立第二套队列。渠道凭据由部署主密钥认证加密；每次请求只解析一次完整地址集合，只连接批准 `sockaddr`，并在发送敏感 Header 前校验实际 TCP peer。TLS SNI、证书身份和 Host 保留原 hostname；禁止重定向、超限响应、生产非公网地址和发送后的地址切换。开发环境可显式使用确定性原始生成器和独立开发对象存储服务，但自然化必须经过 OpenAI-compatible HTTP 边界；这些替身不代表真实模型质量或生产 OSS 已联通。单个 AI 作业最多调用供应商一次；Celery Beat 只补投递超龄 `PENDING`，过期 `RUNNING` 显式失败，重试创建新作业并复制原快照。第三方模型只接收任务和全部事实证据均明确为 `PUBLIC` 的冻结输入。Redis 仍只承载 UUID 消息，不保存业务状态、正文、Prompt 或数据分级。
