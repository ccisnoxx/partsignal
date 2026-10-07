# ADR-008：内部 MANUAL 试运行先补核心页面，候选冻结归属部署子任务

| 字段 | 内容 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-10-07 |
| 批准依据 | 当前会话用户明确要求按 GEO-1009 接受、治理提交、GEO-1010 子任务规划的顺序推进 |
| 适用范围 | GEO-1009 门禁交付接受与 GEO-1010 公司内部 MANUAL UAT/Pilot 交付治理 |

## 背景

[ADR-007](./ADR-007-manual-first-v1-release-scope.md) 保留 V1.0 人工优先范围和现有 Action/Retest API；当时完整 Action/Retest 页面不属于首发必需。固定 clean main `e5949ab66989c1277424cfe9ab8b93e10ce10046` 的完整门禁已经 exit 0，但 source archive、正式镜像身份、release manifest 和 RC 尚未冻结。用户现明确要求先补内部用户完成业务闭环所需的最小页面，再部署固定候选并进行真实人工 UAT。

## 决策

1. GEO-1009 的最终交付调整为固定 main 的完整门禁验证和可核验的接受记录。原始成功、失败、warnings、skips、日志哈希和被验证 SHA 均保留。用户人工接受后可置为 done。
2. 尚未完成的 source archive、正式镜像身份、release manifest、schema head、tracked-file hashes 及候选冻结移交 GEO-1010-DEPLOY。不得把这些义务写成 GEO-1009 已完成。
3. GEO-1010 是内部 MANUAL 试运行聚合父任务，按 UI → DEPLOY → UAT 顺序交付。UI 补管理员评估、Content Task 行动创建、Retest preview/create、比较及显式解决的最小页面闭环；不要求全站或全部行动类型页面重构。
4. DEPLOY 必须等待 UI done，选择届时已推送、clean 且 HEAD=origin/main 的固定候选。该候选的相关门禁、archive、images、manifest、schema 和 hashes 必须对应同一身份。GEO-1009 的旧 SHA 成功记录不能证明后续 UI 代码或新的治理提交已运行完整门禁。
5. 不增加第四个子任务；不并行执行 UI 和 DEPLOY。UAT 发现代码问题时另建缺陷任务，修复交付后再按影响重验，不在 UAT 中混入实现。
6. 三个子任务全部 done 且集成工作验收后，父任务才能 review；父任务 done 需另有明确人工接受。UAT 必须有具名的内部继续试用、修复后继续或停止推广结论；子任务 done、父任务 done 均不自动授予正式生产 Go。

## 保持的合同与限制

- 服务端拥有权限、revision、幂等、available_actions 和业务状态机；本决策不改变 evaluator、Action、Retest、指标或不可变历史语义。
- MANUAL 是正式采集方式；API 自动采集关闭，Browser 关闭，CRON 和自动 Opportunity 调度不启用。Scheduler 的既有分析恢复、补投递、保留及应用维护任务继续按当前实现运行。
- Opportunity CSV、公共重分析、自动发布、Browser Adapter、真实 AI 平台账号接入、公开流量切换仍不在这三个任务范围内。
- 内部部署只使用获批目标、命名空间和配置。真实外部平台由 UAT 人员人工观测；自动外部调用不因本决策获得批准。
- 原 GEO-906、生产 readiness、备份恢复和容量的历史未知与限制保持。新目标证据单独记录，不把默认配置、本地测试或旧 done 转成现场已验证。
- 恢复材料和已验证 previous V2 等部署输入按既有 runbook 的实际部署路径核验。缺输入时 DEPLOY 保持 planned/blocked，不伪造回退身份、不绕过发布状态或迁移安全停止。

## 后果

候选冻结延后到 UI 完成，避免部署后立即替换页面版本。GEO-1009 人工接受只关闭本轮已调整交付，不免除 DEPLOY 的同候选门禁和工件要求。原 ADR 与历史接受记录不改写，当前任务范围以新任务 brief、manifest 和本文的显式追加决定为准。正式公网生产开放须另有对应授权和验收。
