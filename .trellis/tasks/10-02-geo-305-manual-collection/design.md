# GEO-305 事务与状态设计

单Run一份临时草稿，独立draft_revision首次1、未保存虚拟0。两位工程师共享上下文；文件仍只允许当前命令actor上传。submit接受完整载荷且检查expected_draft_revision，允许最终未保存编辑，但不得忽略另一人的草稿更新。草稿受限正文/元数据和有序引用JSON只作临时编辑，正式提交转换成不可变关系并删除草稿，答案为唯一正式事实。

提交身份SHA256(actor+固定命名空间+ASCII key)，摘要覆盖run ID与规范完整输入；时间UTC、引用按实际位置、原文保留。单Run唯一submission，保存answer/run归属、提交时run_revision、使用的draft_revision和时间。重放鉴权后先查身份，不重新检查配置/状态/revision或重复审计。0050历史不回填虚构身份。

锁序User(FOR NO KEY UPDATE，舍弃认证heartbeat)→identity advisory→Surface→Profile→Batch→Run→Draft→Files(UUID)。初读Run只定位不可变资源ID。当前Profile/Surface资格锁后重验；冻结InputSnapshot拥有模式、环境与require_screenshot。Batch先于Run，完整集合复用GEO-302确定性投影，不另写状态机。

新submit锁内检查MANUAL PENDING/NOT_STARTED/无答案、draft revision、正文/时间/证据。删除草稿→Snapshot→所有Citation→合法边COLLECTED/revision+1→Batch缓存→submission→立即约束→最小审计→commit。任何失败rollback。解除草稿文件后只对已经无真实引用的文件安排既有清理；正式引用保持受控。

人工collected_at显式输入，Run.created_at≤collected_at≤锁内数据库clock；started_at=collected_at，维持既有约束。未知source和搜索事实NULL；无费用/usage猜测。raw summary沿用GEO-304闭合结构；URL不HTTP/DNS，文件重验上传者/HEAD。

无分析Worker，回执analysis_dispatch=NOT_IMPLEMENTED。Run.COLLECTED及workflow ANALYSIS_PENDING是后续稳定ID加载依据；dispatch_attempt_count保持0，不建虚假AnalysisRevision/队列/成功投递日志。正式成功只表示证据提交。

0051仅expand两表与守卫，无历史改写/回填，降级55000安全停止。独立critical_reviewer只读复核事务、锁、幂等、文件和迁移。
