# A11 Configuration 真实业务闭环

## Goal

以 production frontend、真实 PostgreSQL、真实会话与本地可控 AI provider，验收平台、Prompt 与 AI 渠道配置的关键业务闭环。

## Requirements

- 前置 A03、A04、A06、A09、A10 均以本轮证据完成后关闭本项；权威为 Configuration 页面蓝图、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A11、OpenAPI 与数据库合同。
- 在同一真实栈中覆盖渠道配置、replacement-only secret/header、模型发现/编辑/测试/启停、Prompt Preview 真实副作用、正式内容生成、Usage/Logs 与关键审计。
- Prompt Preview 与正式生成使用两个独立 Content Task；每个命令只创建一次真实 GenerationJob，并以服务端返回实体、不可变 ContentVersion 和真实聚合验收结果。
- secret 不进入 DOM、URL、GET 响应、console、storage、审计、模型读取、provider payload 或 Playwright 最终产物；revision 冲突和按需 query 仍保留显式恢复边界。

## Acceptance Criteria

- [x] production real-stack 覆盖 Prompt Preview 确认、返回 Job 到 SUCCEEDED、不可变 ContentVersion 展示，以及独立 Task 的正式生成。
- [x] provider 调用、Usage 成功作业、关键配置命令/审计与敏感值边界得到当前运行的精确证据。
- [x] 记录实际代码、独立复核、残余风险及 W01 后继；检查实际 diff/工作树与真实栈资源清理。

## Notes

- 真实栈设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- `ai-channel-configuration-real-stack.spec.ts` 为 Preview 与 Content Editor 正式生成分别创建独立 Product、批准 FactVersion 与 ContentTask，并使用不同 Idempotency-Key，避免两个真实首稿命令竞争同一任务位置。
- production UI 完成渠道创建/编辑、一次 revision conflict 与显式 reload、普通/敏感 Header、模型发现/新增/编辑/删除、失败与成功连接测试、模型/渠道启用、replacement-only API Key/Header，以及 Usage/Logs 与删除收尾。
- Prompt 页面明确选择 Preview Task 与最终模型，经过“确认创建真实首稿”后观察唯一返回 Job 到 `SUCCEEDED`，验证 Job/Version 身份、标题、正文和全屏不可变 ContentVersion；另一个 Task 再经 Content Editor 正式生成。
- fake provider 精确调用 4 次：失败测试、成功测试、Preview、正式生成各一次；Usage 全部时间精确显示业务作业 2、成功 2、失败 0。配置审计包含 create/update/key replacement/header/model/channel 命令，并明确拒绝把 discovery/test 写为永久配置审计。
- 当前 production real-stack `1 passed (16.9s)`；最终 `E2E_SECRET_SCAN status=clean`、`E2E_RESULT playwright=0 secret_scan=0`。隔离数据库删除，Redis DB 14 为 0，端口 8000/9001/4174/19009 释放，临时 storage 与相关进程无残留；生产数据库仍存在。
- 定向 ESLint、frontend typecheck、production build 与 `git diff --check` 通过；原检出区保持干净。独立只读 review 复核双 Task、返回 Job、ContentVersion、provider/Usage 口径与敏感边界，结论为 **NO BLOCKER**。
- reviewer 记录的非阻断缺口是 real-stack UI 未额外以 API 逐字段比较页面 Job ID、`ContentVersion.source_job_id` 与 Preview Task ID；该身份链由生产数据流与 A06 直接测试覆盖。A11 已满足 W01 前置。
