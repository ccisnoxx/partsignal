# T6-P 当前验收与收尾 · 2026-10-24

结论：真实错误码恢复行为已经由现行生产实现满足。本轮补齐4个组件测试文件、1份共享fixture和1份浏览器规格；没有发现需要修复的生产行为缺口，没有修改后端、生产前端、OpenAPI或generated schema。

## 验收结果

- Start：PUBLICATION_IDENTITY_CONFLICT、IDEMPOTENCY_CONFLICT、PUBLICATION_CONTEXT_INCOMPLETE、CONTENT_VERSION_NOT_CURRENT均保留选择/request ID，不自动POST；同payload人工重试仅幂等冲突换key，其他复用；成功采用返回canonical ID。
- Work：REVISION_CONFLICT与PLATFORM_ACCOUNT_DISABLED保留输入并显式重读；fixture初始409为PUBLICATION_CONTEXT_INCOMPLETE。移除PUBLICATION_REVISION_CONFLICT/PUBLICATION_ALREADY_EXISTS业务假码。
- Issue：真实REPAIR_TASK_EXISTS空details不猜ID；冲突后两个Context不自动GET，POST始终1次；显式重读时Workspace成功但repair-context失败仍禁提交，完整重读成功后交接canonical repair任务。旧候选变化分别用REVISION_CONFLICT/FACT_NOT_APPROVED。
- Article：PUBLISHED_CONTENT_ISSUE_CONFLICT保留说明、禁止重放；显式重读后使用Article的canonical open_issue_id。

实际命令、退出码、日志与最终文件hash见 [evidence/validation.json](evidence/validation.json)。五指定组件/API文件57/57；typecheck通过；15文件scoped ESLint通过。浏览器三个规格首轮28通过/2新增场景因request-ID定位器歧义失败，增加exact:true后只重跑新增场景移动/桌面2/2通过；复用其余输入未变的28例，不冒称一次完整30/30重跑。两轮production build与敏感产物扫描均通过；有既有chunk-size提示。独立只读候选复核无material finding，见review.md。

本次仅前端fixture验收，不冒称本轮真实PG竞争或生产验收。真实服务器诊断、事务边界复用T5-G已核对历史证据；T6-G/C的12份当前交付文件hash复核均相同，复用该任务已有定向/浏览器结果。未运行全量make verify、后端真实栈、线上smoke、部署；没有提交/推送。

## 父任务与证据边界

T5-G completed；T5-I1..I6 completed，AC11仍NOT_CAPTURED并按用户决定接受。原15-consumer的现行合同、后续测试owner与替代验收已逐项记录在 `../09-04-integrity-error-domain-mapping/closeout.md`。G05原拟新增page unit由已接受的model+PG+严格浏览器覆盖替代，不虚构文件；后续明确的“任意删除409冻结”合同覆盖早期status-only清理规划。两父任务均可关闭。

旧frontend/dist在每次E2E前隔离、结束后原样恢复并比对全部文件hash；任务自有Playwright output、临时日志与进程按最终scope-check清理。验收日志作为本任务明确交付证据保留在evidence/。未归档或操作其他任务资源。
