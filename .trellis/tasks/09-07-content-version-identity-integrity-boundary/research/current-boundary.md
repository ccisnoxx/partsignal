# 当前实现与证据缺口

## 基线与方法

2026-09-07，主工作目录 main，HEAD `22788cd8a38bb45c6ff486535676afdb83a9e7d3`。本轮只做静态阅读，不运行 PG catalog、迁移或业务测试。历史 research 的代码行号与“GENERATE retry 尚未修正”等描述是当时状态；本任务以当前代码及前置已归档交付为准，不改写历史决策。

用户指定权威输入由主代理及两个只读证据代理分工完整阅读；大型合同/测试按分段读取，审查结果补充在本目录 review 记录中。父计划背景仍描述历史全局mapper，T1后的当前代码与已批准 T4-C 的 unknown合同优先。

## authoritative owner

| 位置 | 当前证据 | 本任务含义 |
|---|---|---|
| backend/app/models/content.py:107 与 backend/app/db.py:14 | 两项 UniqueConstraint 和 uq 命名约定 | 静态预期名称不是 current-head catalog 实测 |
| backend/app/services/generation.py:339 | process_generation_job owns Session、Job锁及终态早返 | 同Job正常重复并非unique race |
| backend/app/services/generation.py:354 | source lookup 在 provider前 | 需独立PENDING已有source对照 |
| backend/app/services/generation.py:376 | RUNNING/attempt/lease提交 | final失败允许保留该阶段 |
| backend/app/services/generation.py:396 | 重新锁Job；task lock由validate_generation_context(lock_task=True)提供 | final allocator正常串行 |
| backend/app/services/generation.py:406 | max(version)+1 后ContentVersion INSERT；439 flush，450后success元数据 | 首flush失败不能单独证明晚期metadata回滚 |
| backend/app/services/generation.py:473 | exception→rollback→get同Job→FAILED/安全摘要/清lease→commit | 不应新增source错误恢复mapper |
| backend/app/services/content_production.py:883 | 共享人工allocator，923 flush后pointer/revision | 仅caller持锁可安全分配，不抽象新owner |
| backend/app/services/content_production.py:929 | manual持Task锁并校验无主线 | 并发后到者可被CONTENT_MAINLINE_EXISTS拒绝 |
| backend/app/services/content_production.py:957 | revision持Task锁复核当前source后调用allocator | 并发后到者可能CONTENT_VERSION_NOT_CURRENT，不应强求双成功 |
| backend/app/services/content_production.py:992 | update_content_draft比较expected_revision | AC10使用该真实对照，不改create schema |
| backend/app/db.py:31 | request get_db exception rollback，finally close | 真实同Session复用需在rollback之后close之前观测 |

## 测试资产与分配

| 文件 | 已有资产 | 待补/验收责任 |
|---|---|---|
| backend/tests/unit/test_generation.py | snapshot/eligibility/HTTP Job mapper unit矩阵；没有worker两identity最终失败测试 | required回归；仅在有意义时补worker失败边界unit，不创建无用classifier测试 |
| backend/tests/integration/test_generation_reliability.py:59 | 隔离PG迁移、patched_sessions、真实本地HTTP替身、seed_generation_job | catalog、source replay/sentinel、worker task/version、metadata晚期rollback、worker Session/dispatch与锁证据 |
| backend/tests/integration/test_generation_reliability.py:1239 | duplicate_workers（准确nodeid以定义为准）已有并发/重复单provider、单version、SUCCEEDED | 保留并扩展必要证据，不能代替source已存在PENDING分支 |
| backend/tests/integration/test_content_draft_lifecycle.py:38 | 隔离PG、人工草稿fixture、save/delete及stale服务对照 | manual/revision真实HTTP task/version sentinel、晚期rollback、正常Task锁、同Session复用、HTTP revision409 |
| backend/tests/unit/test_contract.py 与 test_runtime_response_metadata.py | 静态合同/runtime gates | required运行、零diff，不通过修改它们冻结unknown500 |

正常allocator测试必须证明三条owner各自等待Task行锁后读取max，而不是仅测试任意SELECT FOR UPDATE。sentinel要断言真实error.orig.sqlstate和diag.constraint_name，不能复用已有pk_generation_jobs或Humanization约束当作本任务证据。

## 实测留待实施

- current-head约束列顺序、唯一性、deferrability/索引有效性及两条精确异常。
- source provider窗口旁路fixture、晚期commit故障、三个allocator锁等待与同Session复用。
- 五文件required与Ruff/mypy/全局diff gate实际结果；当前不宣称通过。

## 历史候选裁决与只读合同证据

- 合同 owner 的 `research/content-version-integrity.md:25`、`:34` 和 `research/generation-job-integrity.md:69` 曾建议 source final unique 后回查 replay；最终 `research/contract-decision-matrix.md:97` 已否决该候选。本任务严格采用 pre-provider replay、post-flush FAILED；不得从旧 research 恢复候选方案。
- `contracts/database.md:411` 的 Required Constraints 支持 owner内version唯一、分配时锁owner；`:43` 支持source_job唯一。两精确名称仍需catalog。
- `contracts/openapi.yaml:6356` 的 ContentRevisionCreate 无 expected_revision；`:6369` 的 ContentDraftUpdate 才含该字段。HTTP409对照使用后者。
- `backend/tests/unit/test_contract.py:305` 与 `backend/tests/unit/test_runtime_response_metadata.py:996` 冻结无500/default结构；runtime测试`:1050` 确認无全局IntegrityError handler。它们不提供本任务PG原子性证明。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:181` 保留current pointer、人工编辑和显式恢复规则，无本任务新增前端合同。

## 上下文注入限制

`task.py validate`通过但报告 database-guidelines.md（71755 bytes）超过32768字节注入上限。保留权威spec引用，不复制/缩写为第二权威来源。实施及check代理必须识别native injection截断，并在child侧分段完整读取该文件；其他注入材料若截断同样补齐后再执行。此警告不表示文件已经完整注入。
