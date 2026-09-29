# Hostdzire 开发预览首次重新部署

用户已明确通知“现在部署开发预览”。这是开发阶段的界面和业务预览；不启动正式 Production cutover、maintenance、quarantine、clean-init 或 observation。上一任务已将项目环境清空，公网当前为 410，旧配置和失败冻结证据保留。

## 验收

- 精确核对本地代码、origin/main、两个工作树与 Hostdzire 清理后的现场。保护旧冻结目录、archive、manifest、镜像身份和历史配置；其他 9 个容器、Nginx 共享 TLS/ACME 不改变。
- 将本次已评审的配置/文档/测试源码形成可追溯、已验证的新代码身份；不得从脏工作树制作发布包或复用旧冻结 release。
- 按用户对真实 AI/OSS 的选择，明确 `.env`、`.env.staging`、`.env.production.ai.json` 的归属。使用完整、安全的 staging runtime 配置；不输出任何 secret，不将 env 或 AI Key 放进 Git/archive/log/聊天。旧远端配置在受控备份中保留。
- 新建唯一开发预览 release，首次空库执行 staging full 路径，包括 PostgreSQL/Redis、migration、初始账号、API/worker/scheduler/frontend 与开发存储或经确认的真实 OSS。Compose project 固定 `partsignal-staging`，物理和逻辑网络身份一致。
- 在回环 API/Frontend 健康、容器身份与资源检查通过前保持公网 410；以后用 staging Nginx 模板原子安装并验证公网 root/live/ready/assets/安全头。失败保留现场和可恢复证据，不伪报成功。
- 用户未要求正式 Production 发布；旧 Production AI 操作清单不自动导入开发预览。真实 AI 如需使用，经开发管理员页面受控配置/测试/启用，不能将配置参考文件当成已启用业务。
- 保存构建/测试/执行/资源/安全结果与退出码/bytes/SHA。公共部署合同和外部写入候选须独立只读高风险复核。

## 本次外部服务选择

用户授权立即部署开发预览，未要求在本次接入真实 OSS/AI。预览使用 `.env.staging` 中的开发对象存储和确定性 AI 适配器；用户填写的本机 `.env` 实际 OSS 字段和 `.env.production.ai.json` 均未上传为预览运行输入。后续真实服务启用需按开发配置流程单独验证。
