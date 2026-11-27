# GEO-507 preflight证据与范围解析

依赖GEO-506为manifest done、Trellis completed且有人工作出接受；507初始planned，本任务开始改in_progress。GEO-508/GEO-601仍planned，不改变其状态。分支启动时已为geo/GEO-507；没有Git提交、远程写入或生产迁移。

根合同0054已提供Review、闭合四栏correction和current pointer；0055提供Worker与Job/引用结果。当前公开读取只返回采集结果、data_quality明确未实施，尚无review command且终态Run不允许独立revision变更。507以加法API/详情投影和0056限定guard补齐这些缺口。

已按用户清单读取README、roadmap、WBS完整507行、execution guide、task template、manifest、PRD、domain、workflow、metrics、technical/data/API/frontend/worker/security/testing，以及Accepted ADR002/003。目标API文档的reanalyze段落是草案，用户明确507 deliverables仅人工复核与当前选择，既有506内部命令可以供测试使用但不扩张到新HTTP；字段以根OpenAPI的correction_payload为权威，已更新该草案旁的当前范围说明。无需改变已接受指标、状态机或安全边界。

基线命令及完整结果在evidence/baseline-unit.json/log、baseline-pg.json/log；虚构PG/Redis/fakeOSS使用独立Compose，未调用真实AI。已有dirty/untracked工作在baseline-files.json记录；相关源码前像在evidence/before。任务内diff以这些前像比较，不能使用Git HEAD把前任务改动归于507。

风险与设计依据见prd.md/design.md；本轮只改变review发布、当前read gate、root合同、generated/fixture和直接受影响的测试/文档。
