# GEO-905 Task Brief：大数据量性能和容量硬化

## 1. 基本信息
Task ID GEO-905；R8；负责人主代理；分支 geo/GEO-905（入场已存在）；依赖GEO-607/GEO-902均done且有人工接受。开始planned，实施in_progress，只有本地实现和目标验证完成才review，不能自行done。未提交/部署。2026-10-05本会话用户明确人工审查并接受实现与测试证据，实际blocked→done，Trellis=completed；原阻断、验证结果与覆盖限制保留，验收记录见implement.md。

## 2. 目标
100k+ runs下列表/详情/洞察、1000-run原子创建、完整流式导出与并发Worker具备真实PG性能、查询计划、资源及重复发送证据；访问路径可从业务事实重建。

## 3. 关联需求
PRD §15.4、§16.2/16.8；技术架构§16；测试策略§12；WBS GEO-905完整行及manifest deliverables。

## 4. 必读依据
用户指定的README、roadmap、WBS、execution guide、task template、manifest、governance、PRD、domain/workflow/methodology、technical architecture/data/security/testing/ops和ADR001–005；额外ADR006已接受，Browser延期。当前根OpenAPI相关Run/Batch/报告/洞察协议与database GEO303/306/405–407/506/606–607/902；相关ORM/迁移/服务/测试与backend/spec。文档是目标，当前合同与代码是实现事实。

## 5. 当前行为
100k R5门禁20模板/短回答/单引用；RR全量窗口洞察；CSV专有RR每100候选keyset；1000根矩阵每250插入全事务；Worker固定concurrency1、prefetch1、acks_late；PG lease/发送账本防重复。根树已含大量前序改动，baseline-hashes/before保存本次增量依据。

## 6. 目标行为
容量测试包含非空/密度断言、实际HTTP完整响应与P95、真实100000行CSV发送及有界内存/释放、10并发claim/重复任务零重复外发；必要索引基于实际计划。目标环境和冻结阈值仍待用户明确：PRD列表详情≤2s/洞察≤3s，技术建议500ms/800ms/2s及创建5s，建议不得冒充已冻结VPS阈值。

## 7. 范围内
查询访问路径/索引、Worker可配置容量、性能门禁、必要对应合同/迁移/定向回归与文档证据。

## 8. 范围外
GEO906上线/最终验收、其他任务、真实外部平台/Browser、业务公式/状态机/安全变更、依赖升级、新数据库/消息系统/身份体系、无关重构。

## 9. 不变量
PG唯一业务权威、Redis只ID；Router无业务事务锁写；历史不变、current/latest选择不变、完整同cell及冻结binding；派发/lease/SENT隔离不变；CSV白名单/防注入；缓存可重建。

## 10. 契约变化
OpenAPI/generated无预计变化；必要新增索引通过独立Alembic、ORM/database同步，无表/列/历史回填或不可变例外。索引撤销不删除事实。实际变化以design/implement为准。

## 11. 后端
Application Service保持业务事务/锁/revision/审计；Query只读RR及批量投影；CSV所有权由CsvStream保持。Worker容量通过启动配置有限范围设置，不增加外部重试。指标实时派生，除有证据需要不引入物化汇总。

## 12. 前端
不改变路由/query key/URL状态/组件和公式。

## 13. 测试计划
基线batch/report/read/worker/analysis；旧100k性能。新增100k列表/详情及EXPLAIN、1000创建完整性、CSV实际流与RSS、10并发Worker/稳定ID/重复消息。必要索引迁移只读历史roundtrip及metadata。无产品UI变化不新增E2E旅程。

## 14. 验收
≥100000 runs有非空业务密度；20样本+2预热P95按nearest-rank；1000创建<5s且无部分数据；CSV100000行无缓冲全量、无重复/漏行、低敏审计且提前退出释放；并发无重复调用，目标环境阈值冻结并实测；派生数据可重建且不参与写授权。

## 15. 命令
`git diff --check`、`make lint`、`make typecheck`、`make test-integration`、`make test-geo-performance`及本任务新增容量/EXPLAIN目标；精确执行、首次失败、环境修正和返回码保存在evidence及implement，不将未执行写通过。

## 16. 数据和上线
仅隔离PG迁移/测试；无生产迁移或开关启用。前滚索引需明确锁/超时；撤销访问路径不删业务数据；维持Browser关闭。Worker配置变化需recreate，默认安全单并发。

## 17. 风险与开放输入
目标环境规格/入口/授权与冻结阈值已异步询问，未答不能推断授权；本地结果只证明本地。性能fixture有限形态必须披露；额外缓存/物化只能基于测量且可重建。只按用户五类实质条件blocked。

## 18. 证据
evidence/baseline-status、baseline-hashes、before、基线/候选日志/原始样本/计划；最终implement和独立只读复核/audit。

## 19. 后续
GEO-906独立验收/上线；不实施其他GEO任务，Browser804–807继续deferred。
