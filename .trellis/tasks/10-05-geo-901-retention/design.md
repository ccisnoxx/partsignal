# GEO-901 设计

保留策略采用已有FileRecord生命周期。七项FK、Answer证据不可变以及指标资格不调整；raw文件只在无引用时到期删除，已提交raw永不解绑，不增加被删除文件的公共读模型。EVIDENCE/text/plain保守按raw政策处理；其余VERIFIED无期限文件按孤立文件政策处理，既有显式cleanup_after优先。

临时草稿仅清理MANUAL、NOT_STARTED、无Answer的FAILED/CANCELLED/BUDGET_BLOCKED终态。PENDING有真实用户意图及draft_revision，清理它会造成ABA和页面丢输入，因此保持。新不可变geo_manual_draft_tombstones（run_id PK/FK、draft_revision、draft_updated_at、retention_days、purged_at）插入守卫锁Run和Draft、确认身份及数据库时钟过期；终态草稿DELETE只接受匹配墓碑。延迟守卫要求同事务清除草稿，防单独墓碑阻塞后续维护。既有PENDING保存/提交守卫正文冻结复制到0064新增函数，只增加终态DELETE分支，不改历史migration。

service先扫描terminal run ID，Run SKIP LOCKED后Draft，再按UUID锁Files；数据库时钟决定截止。墓碑、删除和最后引用解除的7天期限同事务。dry-run只读同一RR快照、不开storage adapter、不获取写锁、不写任何元数据。文件dry-run也只查询候选，无cleanup_after修复。

raw/终态草稿/孤立VERIFIED保留天数均可选，未提供时不启动相应新策略；raw90..180、草稿>=1、孤立>=7（<=3650）。配置合法性由Settings，内部batch1..1000；每类单独限批，周期3600s，默认dry-run。原小时文件任务保持原有已安排到期策略，不受新配置影响；新geo_cleanup_artifacts也调用相同权威文件清理，重复对象delete幂等，DELETED完成复核接受已完成状态。

部署先expand0064，再代码；无回填、无生产执行。停止retention/dry-run恢复可停止新删除；不破坏性downgrade。系统日志仅数量/稳定UUID/状态；不持久化正文、对象路径或底层异常。Browser材料本轮已检查N/A，无法推广到未检查环境，已有802撤销/清理流程继续有效。

独立复核三项已修正：SQL在LIMIT前排除7项实时引用，持锁后重验避免引用竞态与扫描饥饿；墓碑的语句级TRUNCATE守卫复用不可变错误；生产输入5项可选白名单允许批准期限、兼容旧runtime，未知键仍拒绝。0064 DDL与前序约定一致，lock_timeout=5s、statement_timeout=120s，超时整体回滚。新Schema对账仅比较本任务新增FileRecord索引，旧cleanup索引/默认值映射缺口不借本任务重构。
