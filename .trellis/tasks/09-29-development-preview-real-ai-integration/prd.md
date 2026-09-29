# Hostdzire 开发预览真实 AI 接入与端到端生成验证

## Goal

只在现有 Hostdzire 开发预览上配置真实 OpenAI-compatible 渠道与精确模型，完成一次可追溯的真实供应商生成闭环；不接入真实 OSS、不执行 Production cutover、不开发功能或修改产品代码。

## Requirements

- 工作区固定为 `/Users/sc/PycharmProjects/partsignal` 的 `main`，独立于已完成的 frontend-redevelopment-delivery；保留其他工作区和会话改动。
- 非敏感供应商身份来自本机 Git 忽略且 `0600` 的 `.env.ai.json`。缺字段只报告字段名，不猜值、不从 `.env.production.ai.json` 导入。API Key 与敏感 Header 仅由用户在受控管理员页面亲自输入，严禁进入聊天、命令参数、日志、截图、Trellis、Git、源归档或环境文件。
- PostgreSQL 是渠道、模型、Job 与内容的权威。渠道和模型先保持 disabled；实际 Provider 模型测试 `PASSED` 后才显式启用，且不得将创建成功或 HTTP 可达当成测试成功。
- 切换 staging `CONTENT_GENERATOR` 时本机和远端必须维持同一受控配置身份；检查 metadata/SHA、备份、checksum compare-and-swap、Settings/Compose 校验、原子安装和最小容器重载。失败恢复为 deterministic 健康态，不动当前 release、PostgreSQL、Redis、Nginx、网络或 fake-oss 数据。
- 通过正常业务流程使用现有合格 Product/公开批准事实/Platform/Prompt/ContentTask，或创建清楚标记的预览测试数据。明确确认一次真实生成，验证 Job、ContentVersion、current pointer、Prompt/model/channel lineage 与 Usage/Logs。不得自动批准、发布或删除历史。
- 首次远端或数据库写入前和最终收尾均需 fresh 独立只读高风险复核且结论为 NO BLOCKER。发现需更改公共合同、产品代码、持久化模型、认证权限或并发行为的实质缺陷时记录 blocker、恢复健康态并结束本任务。

## Acceptance Criteria

- [ ] 真实渠道与精确模型通过真实供应商测试且 enabled。
- [ ] staging runtime 使用 `openai-compatible`，必要服务安全重载；配置双端同一 SHA。
- [ ] 至少一个真实 GenerationJob 为 `SUCCEEDED` 并产生不可变 ContentVersion，身份链与安全 Usage/Logs 可核验，无 deterministic fallback。
- [ ] 公网和所有项目/非项目容器及网络健康，current release/Nginx 无漂移。
- [ ] secret 边界、`git diff --check`、tracked secret scan、最终独立 NO BLOCKER、Trellis 安全记录与 Git 身份核验完成。

## Notes

- `.env.ai.json` 初检仍缺 `provider_brand`、`base_url`、`model_display_name`、`model_id`；用户须在本机补齐，不在聊天给出值。
- 初次代码核对发现 `CONTENT_GENERATOR` 的运行消费关系需要独立复核，不能仅据配置值宣称切换成功。
