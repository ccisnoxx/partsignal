# GEO-1005：V1.0 CRON Plan 边界

产品决策：V1.0 内部试运行只支持人工启动 Plan 或人工创建 Batch；CRON 到期自动创建延期。

- 新建 CRON、MANUAL 改 CRON、历史 CRON 的启用/恢复/编辑/复制/删除/归档/人工 run 一律拒绝，稳定 409 GEO_PLAN_CRON_UNSUPPORTED。
- 历史 CRON 配置、存储状态、revision、关系和 Batch/Run 快照保留，只读。当前用户要求优先于旧 manifest 的原地停用设想。
- 服务端投影 UNSUPPORTED_SCHEDULE / VIEW_HISTORY、无 available_actions；UI 不将历史 ACTIVE 解释为运行承诺。
- 新建/编辑表单只能 MANUAL_ONLY；MANUAL create/activate/run 与临时人工 Batch 保持正常。
- 内部 scheduled factory 不允许首次 CRON 建批；已提交回执重放只读保留。禁止 Beat 到期任务接线、静默降级、伪造执行。
- 现有 Retest 是人工调用的独立 Batch 命令：从已提交、不可变的基线 Batch 复制严格矩阵，创建 trigger_type=RETEST 的批次。原 plan_id 和 CRON 快照仅作来源追溯，不读取或执行当前 CRON Plan、不改写原计划或快照，不伪装成 SCHEDULED；既有可比性、权限及外发门禁继续裁决。
- 更新 OpenAPI、数据库合同、PRD、Runbook、能力矩阵及必要过期说明；增加前后端定向测试，证明拒绝无 Plan/Batch/Run/Redis 副作用。
- PostgreSQL/API 定向验证，前端组件/定向 E2E，fresh 独立只读复核。完成后 task 与 manifest 置 review，不提交/发布/生产操作。
