# GEO-1007 单项接受后的发布阻断复审

状态：整分支 CHANGES_REQUESTED；生产 NO-GO。固定源码：d2aefec7ced564d70d2961f7855755a6f17b6b2d；GEO-1007 接受源码：baea420fb8a479d66d578d3f4fd91d38086b8c29。两个新 fixed-source 只读核查分别覆盖 Browser/Catalog 与 CRON/Opportunity/文档/候选；全 PR 的两个独立分模块审查均为 CHANGES_REQUESTED，具体问题见下文及详细记录。不把矩阵通过当作全 PR 通过。

| 项目 | 实现判断 | 当前验收边界 |
|---|---|---|
| GEO-1003 Browser production hard deny | RESOLVED | config.py:218、check-production-inputs.py:164、service.mjs:6与main.mjs:5拒绝；production Compose为零Browser服务/会话挂载。现场Profile、PG全部历史会话、材料和三进程零启用 CANNOT_VERIFY；task仍review。 |
| GEO-1004 Catalog current actor concurrency | RESOLVED | current_actor.py:44/49按User→Session加锁重读；geo_catalog.py:152/288在资源锁前和提交前重验，失败rollback。读PG竞态逻辑/历史红绿证据，未重新跑PG；task仍review。 |
| GEO-1005 CRON 首发边界 | RESOLVED | geo_plan_policy.py:25/60、geo_plan_commands.py:187、geo_batches.py:116/237/296拒绝全部新写/首次运行，历史只读和原回执重放保留；worker.py:42无CRON定时工厂；task仍review。 |
| GEO-1006 ADMIN 手动机会评估 | RESOLVED | geo_opportunities.py:45与OpenAPI:10740接真实ADMIN+CSRF；geo_opportunity_evaluation.py:45/75真实evaluator、幂等/审计同commit；0066新增不可变回执；task仍review。 |
| 用户GEO-1007恢复，delivery GEO-1008 | RESOLVED / 单项ACCEPTED | fresh baea420f APPROVE，51定向+7信号、20backend unit、真实PG16/Compose/镜像/部署harness exit0。accepted_commit固定baea420f；不覆盖全分支/现场/RC。 |
| 原delivery GEO-1007页面能力真实性 | NOT_RESOLVED | overview-page.tsx:27与insights-page.tsx:20仍说整体机会行动闭环未实现，但工作台+Action/Retest API组合已实现；该页面未整合计数/完整创建UI应准确限定。planned不被恢复项覆盖。 |
| 全分支门禁/CI | NOT_RESOLVED | clean d2a本地verify exit2，unit3832pass/33fail；CI37519768532 overallFAILURE，两frontend shardSUCCESS、verifyFAILURE。后续本地integration/performance/build/E2E/deploy集合未到达。 |
| GEO-1009固定正式候选/clean main | NOT_RESOLVED | 当前geo/GEO-906，不是clean main=origin/main；未合并main、未生成同commit archive/image/manifest/RC。 |
| GEO-1010正式MANUAL/生产/容量/监控/恢复 | CANNOT_VERIFY | 旧readiness null/NOT_VERIFIED/NOT_STARTED保留；没有绑定目标/候选/时间的新现场事实。 |

## 新确认问题

P2 页面能力说明（原delivery1007，首发候选接受阻断）：Overview:27、Insights:20把局部未整合功能描述成整体闭环缺失。用户进入成功页面即见错误说明。修复应明确本页面计数/动作局限、工作台和API组合可用操作路径；定向页面/组件验收，不补做范围外功能。

P3 当前Go/No-Go状态漂移（不单独阻断发布）：10-core-rollout-runbook.md:15的后续planned及:21的恢复review与d2a的acceptance.json/manifest1008done不一致。本轮收尾只同步已存在接受事实，保留其他任务review/planned、候选和现场NOT_VERIFIED及历史审计原文。

全PR backend review为CHANGES_REQUESTED（相对83ff42e7）：P1门禁阻断31项上传夹具缺session identity（test_file_upload_relay.py:84，deps.py:62）；P1两metadata sentinel旧255/1404（test_runtime_response_metadata.py:646/:687，实际256/1411）；P1六个upgrade head集成模块仍期待0065（geo_answers_support.py:38及answer/manual/admission/decision/browser-session migration、retention模块）。前两类已由本地和CI实际失败确认，第三类静态确定、PG尚未执行。全PR前端审查另确认两个P2：catalog-page.tsx:32、questions-page.tsx:43及opportunity-commands.tsx:52/decisions.tsx:74写后未取消首个无缓存list GET，旧响应可覆盖成功后的版本；catalog-page.tsx:62删除活动详情query可再次GET已删对象/404。最小修复分别为先cancel受影响lists后canonical/invalidate、先过滤已删行并详情refetchType:none/清URL后刷新。两项安装库内存反例成立；真实页面时序未跑，未证明数据库或权限绕过。真实SessionRecord.id非空，无证据证明有效生产会话缺id；不能通过删真实绑定、宽松fallback、删语义断言或全局替换合法冻结0065阶段测试消除门禁失败。

## 证据与覆盖

Browser核查者执行20内存Settings/deployment负例、2正例、4Collector production负例和5组只读Compose展开；无容器/DB。Catalog、CRON、Opportunity核查实际源码及PG/HTTP测试逻辑、原始日志和source指纹；历史成功不记为d2a新运行。1005的25源码路径24一致（生成类型后续扩展），1006的20源码路径全一致；Catalog守卫/deps/service/test指纹仍匹配原复核。

main执行本地完整门禁和CI。首次本地launcher umask077影响私钥权限夹具（0644请求变0600）已诊断；改日志显式0600/测试umask022，该文件10项pass，再运行完整门禁得到真实33项backend失败。原始失败不覆盖，未降低测试断言。命令、SHA、UTC开始结束、退出码和日志SHA在local-validation.json；CI结构化状态和原日志SHA在remote-ci-final.json，run37519768532原始日志可从GitHub访问。测试的秘密均为夹具，原始本地日志保存在受保护本机审查目录，不新增生产凭据输出。

本轮未完成同候选integration/performance/build/E2E/deploy全门禁，没有main/RC、真实registry/服务器/公网maintenance/成套生产备份、真实AI/OSS Gate、代表性Publishing/GEO不可变历史、正式MANUAL或阶段批准。恢复信号fakeDocker验证client进程生命周期，不证明Engine服务端操作撤销。早期引用/分类表无TRUNCATE守卫的角色权限边界仍为未验证范围；未见公共API路径，未查现场权限或执行SQL，不作为已确认生产事故。

旧GEO1001审计、137a9fc6CHANGES_REQUESTED及所有生产未知保持；本轮仅接受GEO-1007恢复。整PR#1维持Draft/待修复，先修确认门禁、缓存竞态与页面说明，再对新固定SHA验证和复审；全部准入闭合后才可合并main、在clean main完整门禁、同commit候选冻结与RC/现场阶段。

审查详细记录与定位见[全PR审查交付](../../../.trellis/tasks/10-05-geo-1007-upgrade-recovery/evidence/post-acceptance-release-audit/independent-pr-review-d2aefec7.md)、[本地门禁清单](../../../.trellis/tasks/10-05-geo-1007-upgrade-recovery/evidence/post-acceptance-release-audit/local-validation.json)、[CI最终状态](../../../.trellis/tasks/10-05-geo-1007-upgrade-recovery/evidence/post-acceptance-release-audit/remote-ci-final.json)和[GitHub CI run](https://github.com/ccisnoxx/partsignal/actions/runs/37519768532)。新治理提交只保存这些结论与恢复接受状态，不改变受审运行源码；最后运行SHA是d2a，治理SHA不冒充已重新通过门禁。
