# 设计

复用 geo_plan_policy 作为版本调度边界 owner，require_supported_schedule 对 CRON 返回 409 GEO_PLAN_CRON_UNSUPPORTED；所有 Plan 写命令、当前配置的人工 PLAN 建批和 scheduled 首次窗口调用它，处于现有鉴权/行锁/rollback 边界中。Schema 继续解析 CRON 以读取既存配置和不可变快照，数据库不新增状态、不回写历史，不引入调度开关。

读模型仅增加 UNSUPPORTED_SCHEDULE workflow stage、SCHEDULE_UNSUPPORTED deletion blocker 和 GEO_PLAN_CRON_UNSUPPORTED run reason；存储 status 保持真实历史值。UI 消费 stage 和动作投影显示只读。MANUAL 投影和幂等回执合同保留；历史已提交批次回执重放不创建数据、不重新投递，从当前 CRON Plan 首次建批禁止。

现有 Retest 是人工调用的独立 Batch 命令：从已提交、不可变的基线 Batch 复制严格矩阵，创建 trigger_type=RETEST 的批次。原 plan_id 和 CRON 快照仅作来源追溯，不读取或执行当前 CRON Plan、不改写原计划或快照，不伪装成 SCHEDULED；既有可比性、权限及外发门禁继续裁决。

回滚为代码回退，无 DDL/数据迁移；未来调度交付须另行建立生产入口及验收后再移除此版本守卫。生产历史清点通过只读 SQL，本任务不变更任何目标环境。
