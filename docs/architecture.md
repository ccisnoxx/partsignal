# PartSignal 实现架构

## 边界

PartSignal 是前后端分离的模块化单体。HTTP 契约位于 `contracts/openapi.yaml`，数据库所有权和状态机位于 `contracts/database.md`。前端只依赖生成的 OpenAPI 类型，后端运行时 Schema 必须与提交契约一致。

后端模块分别拥有产品事实、内容策划、内容生产、AI 与平台配置、审核、发布、GEO 观测、文件、身份和审计。跨模块通过应用服务和稳定 ID 协作，不直接修改其他模块的数据。`users.account_type` 是 `ADMIN` / `ENGINEER` 权限唯一来源；管理员包含全部工程师能力。

## 数据所有权

PostgreSQL 保存全部业务状态。Redis 只传递 Celery 消息，消息只包含 `generation_job_id`。对象存储保存文件字节，数据库保存文件元数据、哈希和业务引用。

`FactVersion`、`ContentVersion`、生成作业输入快照、发布状态事件、GEO 观测和审计记录构成不可变历史。可编辑事实工作区、任务 `user_prompt`、平台 Prompt 和当前配置使用乐观锁，状态转换由明确命令完成。模型输出不自报事实或证据 ID，追溯以作业快照和绑定事实版本为准。

## 外部适配器

内容生成固定接入 OpenAI-compatible Chat Completions，不探测 Responses API 或其他协议。渠道凭据由部署主密钥认证加密；请求前重新校验 URL 与 DNS，禁止重定向和生产非公网地址。开发环境可显式使用确定性生成器和独立开发对象存储服务，它们不代表真实模型质量或生产 OSS 已联通。单个生成作业最多调用供应商一次；Celery Beat 只把过期租约标记失败，显式重试创建新作业。Redis 仍只承载 UUID 消息，不保存业务状态。
