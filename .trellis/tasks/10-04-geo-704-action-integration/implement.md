# GEO-704 实施与验证

## 交付状态与依赖
GEO-703 manifest=done、Trellis completed，2026-10-04人工接受记录已核对；本任务开始前允许执行。仅实现704，当前分支geo/GEO-704，无commit/push/部署。全部最终门禁结束后，704 manifest、Task status及delivery_status均为review，不自行done。

## 实现
三个POST行动入口由GEO Application Service协调，调用product_facts.start_fact_revision_context、content_planning.create_content_task及publication现有Issue/Repair服务。GEO仅写Opportunity和追加Action，不直接写其他领域ORM。事实入口返回现有唯一Markdown工作区，不创建第二份可编辑事实或改写已批准版本；内容保留明确批准事实/发布平台及机会主题；发布支持OPEN_ISSUE/LINK_ISSUE/CREATE_REPAIR并保留原领域revision、开放状态、唯一修复任务及审计。

Action保存完整首次trigger、当时全部run/analysis/review/role、目标身份及请求ID。历史无来源快照保持null，后续重新分析/复核/评估不会改写保存快照。首行动仅ACKNOWLEDGED→IN_PROGRESS，每个新行动revision+1；实际内容发布完成仍IN_PROGRESS，任务完成不解决机会。所有可创建类型由服务端投影。

## 事务、锁与错误
User非键更新锁和账号重验→actor/key事务advisory→目标领域原资源锁→Opportunity FOR UPDATE刷新及最终CAS→机会/action/审计→一次commit。保持领域现有锁序，GEO评估器Product→Opportunity，不在Opportunity锁后新增父Product/Task锁。失败audit/flush/commit及晚到CAS整体rollback，目标与回执均不残留，同键可在恢复后重试。

actor/key SHA-256 partial unique；请求摘要覆盖行动类型、机会ID及完整验证后payload（含expected_revision）。同键同载荷返回第一次行动和首次revision，不重复创建/成功审计；同键异载荷409 IDEMPOTENCY_CONFLICT；陈旧revision409 REVISION_CONFLICT；状态不符409 INVALID_STATE_TRANSITION。已提交请求在后续关闭/目标删除后可重放，但账号/强制改密仍重验。发布已存在修复任务继续原领域409；不存在404；角色/CSRF/强制改密沿用401/403；未知身份和错误事实/产品归属422。Router只解析协议和调用，不拥有写入/事务/锁。

## OpenAPI / 数据 / 前滚
根OpenAPI新增fact-revision、content-task、publication-repair三POST、判别请求/行动来源/回执组件及删除阻断GEO_OPPORTUNITY_ACTION；详情追加available_action_types和行动navigation_path/target_available/source_snapshot，全部重生成frontend schema.d.ts。普通内容创建HTTP三字段不变；内部主题传递由既有内容服务拥有。

Alembic 0060_geo_opportunity_actions，down_revision=0059_geo_opportunities。四个nullable列(source_snapshot、request_key_sha256、request_sha256、opportunity_revision_after)、all-null/all-non-null CHECK、actor/key唯一与target索引、来源/目标身份INSERT及删除守卫。旧行无历史回填、无删改0059历史，旧行动新列保持null；SQL与ORM一致。空库和非空0059→head真实PG前滚验证。DDL事务有5s锁/120s语句超时，downgrade显式安全停止，恢复用事务回滚、备份或前向修复；没有生产数据库操作。

普通ContentTask、Article/Issue删除受行动引用阻断；服务预检和PG守卫一致，旧null快照直接Issue目标同样409阻断。管理员只能经既有归档ContentTask aggregate永久删除语境删除目标；Action UUID/快照保留，读模型批量返回目标缺失和无导航。

## 安全 / 前端
session、ADMIN/ENGINEER、强制改密及CSRF不变；产品资格只接受保存Run中的OWN_PRODUCT，事实/平台/Issue由原领域验证。没有真实外部AI、引用URL/HEAD请求、新Redis消息或生产开关变化。成功审计只保存稳定ID、动作、revision/status，不复制请求键、发布描述、回答/事实正文或凭据；来源快照只存ID和原触发结构。导航来自服务端闭合目标类型+UUID，安全相对路由。

已有Opportunity详情新增行动目标链接、缺失提示和来源快照。路由/query key/筛选/URL状态机保持现有合同，来源机会ID随链接带入现有目标页面；没有新增创建表单。真实E2E经API登记行动后，用键盘打开事实工作区、返回机会Drawer、继续历史证据及原忽略流程，覆盖刷新/浏览器Back/焦点和既有视口检查。

## 验证
精确argv、退出码、耗时及全日志见evidence/<name>.json/.log。最终命令表见evidence/validation.md。基线389相关unit+18PG通过；本任务Compose容器/网络及匿名测试卷已down --volumes清理，未清理共享项目容器。旧702/703定向18PG通过，2项既有metadata警告。704最终targeted-actions-final：16 passed（9业务/失败/并发、6数据库与旧删除反例、1非空迁移）；frontend单独范围亦通过，之后完整unit统一验证。

首次lint两处规则、合同响应签名/计数及投影mock行序已修正。首轮unit还出现未改fake provider的1s异步并发测试超时；降低同时验证负载后完整make test-unit为3649后端+1244前端通过，未改变provider或超时断言。首轮完整integration：1056 passed/4 failed，旧head/降级断言与fixture revision已修正；后续完整隔离重跑1062 passed、31条既有类别metadata警告、exit=0；额外两项audit/flush/commit参数在完整初轮启动后加入，最终总数增加2。一次COMPOSE_FILE env重跑被Makefile显式-f覆盖，已停止仅该测试容器，退出2，精确记录gate-integration-final，不作为通过；正确重跑使用make命令行COMPOSE=独占文件。

完整make e2e按infra规范运行所有canonical真实旅程、三个GEO阶段及fixture页面suite；exit=0：canonical 30 passed；GEO enabled/api-disabled/monitoring-disabled各1 passed+1 skip；fixture suite 498 passed+68 skip。GEO的非匹配case按开关模式skip，fixture suite的真实栈case按PARTSIGNAL_E2E_REAL_STACK守卫skip，已由前序真实栈阶段覆盖适用范围；skip不计passed。secret scan全部clean，四轮独占DB dropped、Redis14 deleted、端口released、storage removed均确认。真实AI/Browser/生产保留/生产迁移/发布验收不运行，均属明确范围外；未运行make verify的无关发布/性能/部署目标，不冒充通过。

## 独立复核与范围证据
fresh critical_reviewer发现两个P2：Issue SQL缺完整身份/来源资格、旧null快照Issue引用漏删除预检；均修正并取得6项真实PG反例。复核针对初始候选，修复由主代理验证，没有声称再次独立批准。实际工具追踪28个只读shell命令，confirmed observed_write_paths=[]；审计Bundle已关闭、audit-verify passed，audit_id=20261004T192838Z-geo-704-3eb5e6cf。详情及Digest见evidence/review.md。

起始621路径SHA与已有dirty清单已保留；有基线内容的本任务diff单独导出，不把既有GEO全量dirty归属704。补充五个前端映射/E2E及文档checksum改动由704编辑记录定位，未纳入起始内容快照；明细见evidence/changed-files.md。收尾比较源码与合同，保留无关工作并撤销本次带入的纯格式差异；撤销前后Python AST一致。

## 限制与后续
旧行动缺快照无法补造；目标删除后不能打开目标，但来源和稳定ID可读。事实行动为导航，前端本次仅已有行动记录；没有完整创建表单或复测/解决旅程。705 RetestPlanner/基线/可比性，706比较与解决，707完整闭环均保留planned，不实施；Browser、生产保留和上线同样范围外。文档包整体SHA256校验另有README和核心PRD两项既有过期指纹，正文与起始621路径hash一致；本次相关5项指纹已更新，保留不相关指纹差异，详见evidence/document-checksums.json。需要人工审查后才能将704 done。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-704 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次只记录人工验收，不重新实现或重复运行功能门禁。

本次仅收尾GEO-704，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
