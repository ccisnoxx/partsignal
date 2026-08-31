# 波次 2 已认证续跑执行摘要

## 结果

Run `20260830-192848-v2-auth-resume` 使用独立会话 `v2-auth-resume-192848` 在权威目标 `https://geo.962850.xyz` 完成了用户授权的一次重新登录，并从 `/content/tasks` 继续波次 2。内容任务、发布、GEO 的部分页面及设置页获得当前运行证据；`/geo/topics` 的列表 API 返回 HTTP 422，形成 P1 缺陷。准备导航到 `/system/users` 时，执行命令误用了非任务域名 `https://partsignal.com/system/users`，随后当前会话被关闭，因此系统管理页和移动端没有完成。该中断属于测试执行错误，不是目标环境故障。

收口时重新核验权威目标：主页、`/api/health/live`、`/api/health/ready` 均为 200，标题仍为 `PartSignal Frontend V2`；结合已冻结的 Staging/release 材料，没有观察到身份漂移。但这些公开证据不能把当前实例与那份 Staging release 直接关联，未形成 R10 要求的正面 Staging 证明。波次 3 为 `BLOCKED`：波次 2 尚未完成，用户授权的重新登录会话已经关闭，Staging 写入门禁也未满足。未创建 TEST registry，未产生业务写入、TEST 对象或清理残留。

## 已核验事实

- ADMIN 登录一次成功；脱敏 `/auth/me` 为 HTTP 200、`accountType=ADMIN`、`mustChangePassword=false`。
- `/content/tasks` 的搜索与重置只产生只读行为；完成的路由交互没有业务 mutation。
- `/publishing/work`、`/publishing/articles`、`/publishing/issues`、`/geo/insights`、`/geo/observations`、`/settings/platforms`、`/settings/platforms/types`、`/settings/prompts`、`/settings/ai` 获得 1440×900 稳定状态证据。
- `/geo/topics` 请求 `GET /api/v1/query-topics/list-items?sort=QUESTION_ASC&page=1&page_size=20` 返回 422，请求标识为 `17ae56af-3238-4281-90be-edfdc8758adc`。
- `/system/users`、`/system/audit`、移动端与键盘补充检查因执行 URL 漂移和当前会话随后关闭而未完成。
- 会话已精确关闭；`playwright-cli list --all --json` 收口结果为 `browsers=[]`、`servers=[]`。

## 缺陷与阻断

1. `P1-002`：Query Topic 列表 API 422，页面不可用，阻断对应波次 3 流程。
2. `EXEC-BLOCK-001`：系统页面导航误用了非任务域名 `partsignal.com`，该域名返回 `ERR_CONNECTION_CLOSED`。纠正后的权威目标 `geo.962850.xyz` 及两个 `/api/health/*` 合同端点均为 200；这是测试执行阻断，不是产品缺陷。

## 证据

- 完整报告：`artifacts/deployed-acceptance/20260830-192848-v2-auth-resume/acceptance-report.md`
- 登录页：`screenshots/01-login-1440.png`
- 内容任务：`screenshots/02-content-tasks-1440.png`
- 发布工作：`screenshots/03-publishing-work-1440.png`
- Query Topic 422：`screenshots/04-geo-topics-1440.png`
- 平台与账号：`screenshots/05-platforms-1440.png`
- AI 渠道：`screenshots/06-ai-1440.png`
- 非任务域名错误：`screenshots/07-nontarget-domain-error-1440.png`

## 后续恢复条件

获得新的独立会话与一次登录授权后，必须固定使用权威目标 `https://geo.962850.xyz`，先补齐 `/system/users`、`/system/audit`、direct reload/history、账户菜单、375×900、移动 Sheet 与键盘焦点。波次 2 完成后，在同一受控认证 context 中获取可把公网实例与 Staging release 直接关联的正面证据，再决定是否开始波次 3；此前继续保持零业务写入。
