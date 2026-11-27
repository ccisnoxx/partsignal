# IntegrityError 工作线当前收尾依据 · 2026-10-24

本记录补充原 planning 阶段文档，不改写当时授权/检查记录。用户现授权完成 T5-G/T6-P 后核对关闭两层父任务；不部署、不提交推送。

## 后端与 Publication/GEO 子工作线

原13个直接子任务已逐项解析当前目录或 archive/2026-09 中的 task.json；前12项均 completed。第13项 T5-C 的6项 I1..I6 也已 completed。新增显式关联的 T5-G 与 T6-P 分别承接过去只存在于计划中的残余条件，完成记录：

- `.trellis/tasks/10-24-publication-geo-integrity-t5-review-gate/review.md`：六项历史 diagnostics、exact mapper、unknown、11 producer、事务与后续 GEO-704 漂移的独立只读核对，无剩余 material finding。
- `.trellis/tasks/10-24-publication-exact-code-recovery-acceptance/implement.md`：真实 Publication 错误码、双 Context 重读、空 details、不重放、key区别的当前验收。
- `.trellis/tasks/10-24-content-deletion-recovery-acceptance/implement.md` 与 evidence/validation.json：T6-C 删除冲突恢复修复、T6-G 剩余验收。该记录中的12份交付文件本轮重新核对 hash，保持相同。
- `.trellis/tasks/09-16-geo-observation-context-code-reconciliation/closeout.md`：AC11 历史证据缺口依用户明确决定接受，**NOT_CAPTURED 不变**，用本轮当前验收收尾，不追认历史 PASS。

## 原 T6 15-consumer 对照

原 implement.md §6.2 的“清理 status-only 409”是需产品裁决的规划目标；后续权威行为文档已经明确多处 DELETE/命令 409 一律冻结与显式 reload。依现行合同关闭，不以删除所有 status 判断作为完成标准。错误信息/结构化 blocker 保持各领域语义，不把 unknown 500 改成 revision conflict，不建立新的全局 code registry。

下表的源路径相对 `frontend/src/`；历史证据为各后续任务 prd.md 的已完成验收记录，本轮不冒称重新执行这些模块测试。

| # | 原生产 consumer | 当前合同与测试 owner / 证据 |
| --- | --- | --- |
| 1 | domains/configuration/platform-list-page.tsx | A01 `09-21-frontend-a01-platform-list/prd.md:26-28`；删除任何409由页面持有、关闭重开不解除、显式成功重读才解除；15直接/16浏览器，3 PG基线；platform-list-page.test.tsx |
| 2 | domains/configuration/platform-types-page.tsx | A04 `09-21-frontend-a04-platform-types/prd.md:21`；按Type ID保存409 hold，blocker展示不假装revision；13直接/7 PG/12浏览器；platform-types-page.test.tsx |
| 3 | domains/configuration/platform-workspace-page.tsx | A02 + A03 `09-21-frontend-a02-platform-workspace-core/prd.md:23`、`09-21-frontend-a03-platform-accounts/prd.md:21-22`；core显式重读、account hold隔离及204后只刷新不重删；20直接/18浏览器，后续23直接/4 PG/20浏览器；platform-workspace-page.test.tsx |
| 4 | domains/content/content-review-page.tsx | C06 `09-21-frontend-c06-content-review/prd.md:11,27-29`；409保留输入、不重放，unknown500展示失败；13直接、25浏览器+1配置skip，两个真实栈Flow分别通过；content-review-page.test.tsx |
| 5 | domains/content/content-task-lifecycle.tsx | T6-C本日验收；普通/永久删除409冻结、CHAIN_CHANGED重读后重新预览确认、完整重读失败保留冻结；list/detail/deletion-dialogs测试及44浏览器通过 |
| 6 | domains/geo/geo-observation-detail-page.tsx | G03后续交付及T6-G本日current验收；CONTEXT_INCOMPLETE整体blocked，HAS_SUCCESSOR/CHAIN_CHANGED显式恢复，无mutation重放；geo-observation-detail-page.test.tsx和browser |
| 7 | domains/geo/geo.api.ts | T6-G本日验收；structured code/request ID原样投影，unknown500不猜chain；geo.api.test.ts |
| 8 | domains/geo/query-topic-list-page.tsx | G05 `09-21-frontend-g05-geo-topics/prd.md:11,26-28`；edit/delete409冻结，QUERY_TOPIC_IN_USE准确显示类型/数量/resolve link，显式发起完整重读。原拟新增page unit不存在，验收已以3 model + 3 PG +20严格浏览器覆盖替代，不虚构文件 |
| 9 | domains/identity/user-list-page.tsx | S01 `09-21-frontend-s01-user-management/prd.md:11,27`；编辑精确REVISION_CONFLICT，删除任何409 hold，bulk保留逐项语义；31直接/14 PG/16浏览器；user-list-page.test.tsx |
| 10 | domains/publication/publication-workspace-actions.tsx | T6-P本日57组件/API组合与浏览器；真实REVISION_CONFLICT和PLATFORM_ACCOUNT_DISABLED保留输入/显式重读；publication-workspace-page.test.tsx |
| 11 | domains/publication/published-article-detail-page.tsx | T6-P真实PUBLISHED_CONTENT_ISSUE_CONFLICT；保留草稿、重读Article后按canonical open_issue_id交接；published-article-detail-page.test.tsx |
| 12 | domains/publication/published-content-issue-workspace-actions.tsx | T6-P真实REPAIR_TASK_EXISTS空details，不推断winner；双Context重读失败仍冻结，完整成功后使用server ID；published-content-issue-workspace-page.test.tsx + published-content-issues.spec.ts |
| 13 | domains/publication/published-content-issue-workspace-page.tsx | 同上；单Workspace权威，repair-context按需。REVISION_CONFLICT与FACT_NOT_APPROVED候选变化继续覆盖 |
| 14 | domains/publication/start-publication-dialog.tsx | T6-P PUBLICATION_IDENTITY_CONFLICT / IDEMPOTENCY_CONFLICT / PUBLICATION_CONTEXT_INCOMPLETE / CONTENT_VERSION_NOT_CURRENT；同payload仅幂等冲突废弃key，其他失败人工重试复用，无自动POST；publication-work-page.test.tsx |
| 15 | routes/_app/geo/observations/$observationId_.correct.tsx | G04 + T6-G本日验收；HAS_SUCCESSOR/CHAIN_CHANGED不猜winner、不重放，Correction整体Context；geo-observation-correction-page.test.tsx与browser |

现行合同位置：`docs/frontend-v2/05-business-actions-state-and-api-contract.md` Publication/Issue §8附近、QueryTopic §10附近及平台/账号/类型/用户各节；`.trellis/spec/frontend/state-management.md` Publication Workspace / Published Content Issue。本轮改变测试覆盖与任务记录，没有新业务合同，不修改OpenAPI或generated schema。

## 关闭语义与未来工作

关闭表示该工作线的实现、合同决策、当前前端验收与已接受证据例外已收尾。不是生产发布证明，也不授权提交、推送或部署。历史完整门禁不会自动变成每次发布要求；将来发布按届时实际候选与变化执行适用验证，继续保持I5/I6与G/C consumer原子交付。

原规划PRD/implement内 planning 限制、未勾选的实施模板和历史“仍需T5-G/T6-P”段落均保留为时间序列，由本记录与最新task.json覆盖当前状态；不批量勾选冒充历史执行。当前5项其他开放项目任务（OSS、GEO804与GEO1010三项）不属于此工作线，未据此关闭。
