# PartSignal 实现架构

## 边界

PartSignal 是前后端分离的模块化单体。HTTP 契约位于 `contracts/openapi.yaml`，数据库所有权和状态机位于 `contracts/database.md`。前端只依赖生成的 OpenAPI 类型，后端运行时 Schema 必须与提交契约一致。

后端模块分别拥有产品事实、内容策划、内容生产、审核、发布、GEO 观测、文件、身份和审计。跨模块通过应用服务和稳定 ID 协作，不直接修改其他模块的数据。

## 数据所有权

PostgreSQL 保存全部业务状态。Redis 只传递 Celery 消息，消息只包含 `generation_job_id`。对象存储保存文件字节，数据库保存文件元数据、哈希和业务引用。

`FactVersion`、`ContentVersion`、发布状态事件、GEO 观测和审计记录构成不可变历史。可编辑事实工作区和当前任务状态使用乐观锁，状态转换由明确命令完成。

## 外部适配器

内容生成和对象存储通过适配器接入。开发环境使用确定性生成器和独立开发对象存储服务；它们用于验证真实状态机和事务，不代表真实模型质量或生产 OSS 已联通。Celery Beat 每分钟从 PostgreSQL 查找过期生成租约并重新投递，Redis 仍只承载消息，不保存业务作业状态。
