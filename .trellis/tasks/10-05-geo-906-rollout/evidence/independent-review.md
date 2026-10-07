# GEO-906 独立复核

fresh critical_reviewer /root/geo906_release_review，fork_turns=none；只读，不运行测试、数据库或生产动作。
初次发现enable只activate不会重建API，总开关仍false；主代理修正为UPGRADE_PREPARED同candidate再次deploy→activate，已有所有者允许此重入。
第二项发现frontend-only rollback只接受PRODUCTION_INITIALIZED；prepared不允许另一candidate接管，不能在deploy失败时假称可回滚。主代理登记阶段限制和停止条件，不改发布状态机。

最终结论：候选可作为blocked的发布准备交付，不能放行生产。未确认候选增加安全绕过、批准伪造或现场事实冒认。
P1：docs/geo-monitoring/03-technical/10-core-rollout-runbook.md:132 初始化前artifact失败无可执行恢复路径。UPGRADE_PREPARED前端失败需要更换artifact时，prepare-production-data.py:331拒绝frontend回滚，begin_upgrade也不接受另一候选。须发布所有者提供支持且获批的阶段恢复方案；当前保持维护，不先activate、手改状态或直接换镜像。
目标、candidate、阶段批准、容量/观察期和负责人缺失；cron/自动evaluator NOT_MET/NOT_IMPLEMENTED，不能用依赖done或ADR006替代。
白名单仅允许已验收retention，18场景/共享Settings/零外呼不变；Browser N/A负证据、PG/SENT/UNKNOWN、immutable与模板null边界未确认其他问题。
复核时make verify尚未完成且有失败，不计通过；正式验收仍待主代理归因与生产证据。

交付验收通过是对此只读复核任务的报告验收，不是GEO906或生产批准。声明范围hash见review-source-hashes-*.json和review-write-evidence.md。
