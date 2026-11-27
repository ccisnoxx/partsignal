# GEO-1006 管理员显式机会评估

复用 evaluate_opportunities，交付受 CSRF 保护的 ADMIN HTTP 入口。管理员显式指定 ALL/FILTERED 范围、带时区的 UTC 半开窗口、不可变规则 revision；支持 Subject/Surface/Profile 和模式过滤，并必填 Idempotency-Key。ENGINEER、停用/改密、总开关/评估开关关闭拒绝。

返回 evaluated_cells、created、existing_reused、skipped、unavailable_reasons、as_of 及稳定运行 ID。计数按规则/范围评估结果分区，低样本及无来源不制造机会。重复同用户同 key 原结果重放，变参冲突；新 key 可显式重评当前证据但沿既有机会 identity 去重。

回执、机会/来源/评估与低敏 SUCCESS 审计同事务。禁止自动 Action/Retest、周期任务/Beat/CRON、生产操作、提交推送或改动其他任务状态。更新 OpenAPI/database、生成类型、Runbook。完成后 task/manifest 为 review，等待人工接受。

验收：实际 API/真实 PostgreSQL 覆盖权限、CSRF、参数、开关、规则 revision、过滤、幂等与并发、变化后的重放、原子失败、来源/首次快照保留、无后续动作、迁移及历史守卫；定向合同/类型/静态检查；fresh 独立只读复核。
