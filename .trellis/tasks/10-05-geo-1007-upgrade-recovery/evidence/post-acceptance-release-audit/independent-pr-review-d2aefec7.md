# 全 PR 新固定源码只读审查记录

受审base：83ff42e7cacc9f2aa406eba2f128f3f4d4dd86af；head：d2aefec7ced564d70d2961f7855755a6f17b6b2d；PR#1。两个fresh critical_reviewer各自只读审查backend/API/迁移/worker与frontend/用户旅程/缓存合同，均返回CHANGES_REQUESTED。此文由主代理根据其最终交付保存；全tracked审前/审后无变化，审查者未修改源码/task/Git。审查交付被验收不等于候选APPROVE。GEO-1007恢复已接受baea420f，此结论不把其他分支集成缺漏归为该修复新缺陷。

## Backend/API/迁移/worker

P1合并门禁：test_file_upload_relay.py:84的SimpleNamespace缺id，deps.py:62在所有认证请求绑定真实session；本地及远端31项因此失败，真实SessionRecord.id为非空PK。最小修复为夹具提供稳定UUID与实际字典db.info，保留HTTP权限/CSRF/内容/并发/恢复断言；不能删真实绑定或宽松fallback。

P1合并门禁：test_runtime_response_metadata.py:646/:687旧operation/raw response inventory255/1404不包含evaluateGeoOpportunities，实际256/1411；静态合同已登记256operations/1667增强responses。两项本地/CI失败不属于id错误。同步已核实inventory，保留逐operation的request-id、400/ErrorEnvelope、全response header及剥离metadata后的完整比较；不能删sentinel或以新数字代替新入口覆盖。

P1独立合并门禁（静态确定，PG未实跑）：geo_answers_support.py:38及六模块明确upgrade head，仍预期0065，而实际0066；0066 downgrade安全停止会先拒绝，旧0065拒绝文本也不成立。test_geo_answer_migration.py:30/:66/:71、test_geo_manual_migration.py:85/:90、test_geo_admission_migration.py:159/:163、test_geo_decision_migration.py:27/:84/:87、test_geo_browser_session_migration.py:46/:77/:80、test_geo_retention.py:53（阻止该文件11项行为验证）。逐处更新真正head场景并保留数据/ORM/降级后不变断言；test_geo_ops_runtime.py:24明确冻结0065和0066测试的0065降级目标必须保留，不全局替换。

核查身份/CSRF/当前actor写事务、Batch/Run冻结身份和attempt lineage、MANUAL草稿/提交/证据原子性、collector claim/SENT/lease/迟到结果、预算UNKNOWN、分析revision/current pointer/复核追加、Opportunity及归档聚合删除例外、Retest严格基线、引用文件清理竞争。未确认其他公共API可达源码错误，不是穷尽保证。早期引用/分类表0050_geo_answer_guards.sql:58/0055_geo_analysis_worker_guards.sql:73缺TRUNCATE守卫为权限边界覆盖缺口；未查现场role权限、未执行SQL、未见公共API路径，不认定为独立确认发布阻断。

## Frontend/API交界

P2范围批准阻断：catalog-page.tsx:32、questions-page.tsx:43、opportunity-commands.tsx:52和opportunity-decisions.tsx:74成功写后没有取消无data的首个在途list GET。提交前revision7响应可在revision8写成功后被复用，覆盖显示并清除invalidated状态。安装TanStack Query源码与无网络/无文件内存反例：reads=1,listRevision=7,isInvalidated=false,isStale=false。最小修复为成功后cancel受影响lists，再验证principal/挂载身份，投影canonical并invalidate；Surfaces/PlanWizard/PlanDetail已有该顺序。应延迟首个无缓存列表响应，提交后释放旧响应，验证取消/忽略并回读提交后的版本。没有改写DB或绕过服务端CAS。

P2范围批准阻断：catalog-page.tsx:62删除当前Subject时URL和详情observer尚在就removeQueries；下一次父render可重建详情GET/404，列表未即时过滤旧ID。state-management.md:79明确删除生命周期。安装库无网络/文件内存反例：reads=2,postDeleteRead=true,state=error，未做浏览器页面时序。修复应先投影过滤已删行，详情invalidate refetchType:none，清URL后校准列表；现测试删除后仍返回成功详情且不数GET，需定向验证不再读取详情/旧行不复现。

P2保留已知：overview-page.tsx:27/insights-page.tsx:20将本页计数/动作集成缺口说成整体机会闭环未实现；工作台及API组合路径已有。准确限定本页、给工作台路径、保留NOT_IMPLEMENTED计数，不猜算，不补做范围外完整Action/Retest UI。首发能力说明缺口，不单独证明生产安全绕过。

核查路由筛选/query key/cancel/principal epoch、MANUAL CAS/提交幂等与未知结果恢复、review correction/不可变历史/比较指纹、CSRF/401/403/404/409/422、原文/证据、Reports/CSV及工作台/API边界。未确认权限绕过或历史原地改写；未跑浏览器/DB/容器/cache写检查，真实页面时序、焦点/键盘、签名下载和跨浏览器仍未运行。

## 主代理新门禁与后续

clean固定d2a的本地contract/lint/typecheck通过，backend unit33failed/3832passed，完整verify exit2于此停止。CI37519768532 overallFAILURE，verify同33项失败step exit1，两frontend shardSUCCESS。主代理保存日志时间/SHA/exit/摘要哈希；reviewer阅读不是独立重跑。原始launcher umask077失败另保留，环境修正后10项Browser session通过。新固定SHA需修确认门禁和UI竞态再验证、复审；不得沿用本次CHANGES_REQUESTED为未来通过。其他任务review不自动接受；无clean main/正式候选/RC/真实生产验收。
