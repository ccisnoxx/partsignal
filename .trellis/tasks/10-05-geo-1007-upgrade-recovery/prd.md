# GEO-1007 未初始化升级 artifact 失败恢复

用户明确指定本任务 ID 为 GEO-1007。当前 delivery manifest 中相同业务范围登记为 GEO-1008，GEO-1007 是页面/API 对齐；本任务不重编号、不交付页面任务，完成状态以本 task.json 为准，并给 GEO-1008 增加关联说明。

## 目标与硬约束

复现 initialized 旧版本开始 upgrade → UPGRADE_DEPLOYING → migration/start/readiness artifact 失败 → 新候选拒绝 → frontend rollback 因未 initialized 拒绝。第一步先形成状态机设计与测试计划，不能放宽 candidate consumer。

显式恢复必须绑定失败身份、新不可变 manifest、维护锁和静默运行态；不静默切镜像，不直接 initialized，不 downgrade 或修改业务历史。新增中断、重复、错误候选、错误 manifest、并发、SIGTERM 反例，在独立 PG16/Compose 演练；更新 Runbook 和低敏恢复证据模板，独立只读复核，最后置 review。

## 验收

- 复现证据与至少两个方案比较见 design.md。
- 选择同 schema/同迁移内容的受控前向修复；不能证明即停止。
- 前向接管是状态所有者单个原子写；保留 previous_candidate 和每次失败候选历史。
- 必须停止整个项目和所有活动数据挂载；不提供 force。
- 修正版再次失败仍 UPGRADE_DEPLOYING；只有完整 deploy/activate 才 initialized。
- 隔离演练保持历史记录/摘要，正常、故障与 SIGTERM 退出清理本次所有资源。
- review 不是人工接受、candidate 冻结或生产发布；不提交/推送/操作远端。
