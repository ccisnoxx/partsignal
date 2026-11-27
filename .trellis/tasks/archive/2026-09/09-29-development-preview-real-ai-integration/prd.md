# Hostdzire 开发预览真实 AI 接入与端到端生成验证

## Goal

只在现有 Hostdzire 开发预览上配置真实 OpenAI-compatible 渠道与精确模型，完成一次可追溯的真实供应商生成闭环；不接入真实 OSS、不执行 Production cutover、不开发功能或修改产品代码。

## Requirements

- 工作区固定为 `/Users/sc/PycharmProjects/partsignal` 的 `main`，独立于已完成的 frontend-redevelopment-delivery；保留其他工作区和会话改动。
- 非敏感供应商身份来自用户参考文件或其亲自配置的线上 PostgreSQL 安全摘要。缺字段只报告字段名，不猜值、不从 `.env.production.ai.json` 导入。API Key 与敏感 Header 仅由用户在受控管理员页面亲自输入，严禁进入聊天、命令参数、日志、截图、Trellis、Git、源归档或环境文件。
- PostgreSQL 是渠道、模型、Job 与内容的权威。渠道和模型先保持 disabled；实际 Provider 模型测试 `PASSED` 后才显式启用，且不得将创建成功或 HTTP 可达当成测试成功。
- 恢复阶段用户明确继续采用现有真实适配器路径，失败通过最新 revision 停用模型/渠道阻止后续调用，不能撤回已发请求。env 不改、容器不重建，两端配置身份保持一致；原 env 切换和 deterministic 恢复要求在本次恢复中被替换。模式开关缺陷保留记录另行修复，不动当前 release、PostgreSQL、Redis、Nginx、网络或 fake-oss 数据。
- 通过正常业务流程使用现有合格 Product/公开批准事实/Platform/Prompt/ContentTask，或创建清楚标记的预览测试数据。明确确认一次真实生成，验证 Job、ContentVersion、current pointer、Prompt/model/channel lineage 与 Usage/Logs。不得自动批准、发布或删除历史。
- 首次远端或数据库写入前和最终收尾均需 fresh 独立只读高风险复核且结论为 NO BLOCKER。发现需更改公共合同、产品代码、持久化模型、认证权限或并发行为的实质缺陷时记录 blocker、恢复健康态并结束本任务。

## Acceptance Criteria

- [x] 真实渠道与精确模型通过真实供应商测试且 enabled。
- [x] 现有 Worker 实际使用 OpenAI-compatible adapter；配置停用恢复路径可核验。env 双端同一 SHA 且未修改，不重建容器，不声称 env 已切换或 deterministic 可回退。
- [x] 至少一个真实 GenerationJob 为 `SUCCEEDED` 并产生不可变 ContentVersion，身份链与安全 Usage/Logs 可核验，无 deterministic fallback。
- [x] 公网和所有项目/非项目容器及网络健康，current release/Nginx 无漂移。
- [x] secret 边界、`git diff --check`、tracked secret scan、最终独立 NO BLOCKER、Trellis 安全记录与 Git 身份核验完成。

## Notes

- `.env.ai.json` 初检曾缺 `provider_brand`、`base_url`、`model_display_name`、`model_id`；用户后来在页面自行配置了真实渠道/模型，线上 PASSED+enabled 已只读核验，不再将参考文件的历史缺项视为线上输入缺失。
- 初次代码核对发现 `CONTENT_GENERATOR` 的运行消费关系需要独立复核，不能仅据配置值宣称切换成功。
