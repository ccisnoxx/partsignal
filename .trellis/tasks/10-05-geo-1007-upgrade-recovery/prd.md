# GEO-1007 未初始化升级 artifact 失败恢复

用户明确指定本任务 ID 为 GEO-1007。当前 delivery manifest 中相同业务范围登记为 GEO-1008，GEO-1007 是页面/API 对齐；本任务不重编号、不交付页面任务，完成状态以本 task.json 为准，并给 GEO-1008 增加关联说明。

## 目标与硬约束

复现 initialized 旧版本开始 upgrade → UPGRADE_DEPLOYING → migration/start/readiness artifact 失败 → 新候选拒绝 → frontend rollback 因未 initialized 拒绝。第一步先形成状态机设计与测试计划，不能放宽 candidate consumer。

显式恢复必须绑定失败身份、新不可变 manifest、维护锁和静默运行态；不静默切镜像，不直接 initialized，不 downgrade 或修改业务历史。新增中断、重复、错误候选、错误 manifest、并发、SIGTERM 反例，在独立 PG16/Compose 演练；更新 Runbook 和低敏恢复证据模板，独立只读复核，最后置 review。

## 验收

- 复现证据与至少两个方案比较见 design.md。
- 选择同 schema/原 migration image ID/同 Migration Runtime Fingerprint 的受控前向修复；独立迁移镜像冻结所有应用文件、动态加载内容、Python/依赖/基础系统与执行配置，修复 backend 独立变化。不能证明即停止。
- 严格失败恢复：消费绑定当前 candidate/attempt 的不可变失败事实；正常 deploying/prepared 和已开始新 attempt 的旧失败不能恢复。prepared 后的问题必须独立批准声明，不能伪造部署退出。
- 首次迁移前冻结运行时证明；旧状态缺失证明或失败事实不能在恢复时补造。
- 前向接管是状态所有者单个原子写；保留 previous_candidate 和每次失败候选历史。
- 必须停止整个项目和所有活动数据挂载；不提供 force。
- 正式 recover-upgrade 入口自动进入信号治理，子孙结束前持续持有维护锁；实际入口的 SIGTERM 反例必须通过。
- 修正版再次失败仍 UPGRADE_DEPLOYING；只有完整 deploy/activate 才 initialized。
- 隔离演练保持历史记录/摘要，正常、故障与 SIGTERM 退出清理本次所有资源。
- review 不是人工接受、candidate 冻结或生产发布；不提交/推送/操作远端。
