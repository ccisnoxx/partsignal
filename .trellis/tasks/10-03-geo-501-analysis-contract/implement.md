# GEO-501 执行记录

## 准入与基线
GEO-304=done、GEO-005=done、GEO-501=planned；分支geo/GEO-501。编码前已输出12项preflight。基线contract-check通过、unit105passed、PG43passed；日志evidence/baseline-*.log。原colima已运行，独立项目partsignal-geo501-validation使用55461/56401/19021端口，不迁移原数据库。

## 执行与验收

GEO-501 已实现并完成本地验证，交付 `review`，不自行 `done`。GEO-304、GEO-005 均为 `done`；只修改 manifest 的 GEO-501 条目。没有 commit、push、生产迁移或发布。

### 实现边界

- 根 OpenAPI 新增闭合分析输入/配置、revision、Mention/Recommendation/Claim、类型化 review correction、Review 和 Selection components；无新 operation。DeletionBlockerType 增加 GEO_ANALYSIS，前端 generated 类型同步，既有删除阻断元数据补齐。
- ORM 增加六张表：geo_analysis_revisions、geo_analysis_fact_versions、geo_entity_mentions、geo_recommendations、geo_claim_assessments、geo_run_reviews。Run 增加可空复合 FK current_analysis_revision_id。
- 0054 冻结 DDL/SQL，不读取运行时 ORM；全部历史 FK RESTRICT。应用级事实删除、FactVersion 读投影、用户删除和 Catalog 分析引用计数接入真实关系，避免数据库拒绝与 UI 可用动作矛盾。
- 更新 PRD、领域模型、流程、数据架构和 API 设计中受影响的草稿说明，根合同继续拥有精确字段和规则。没有指标、Opportunity、Browser、分析算法、Worker、分析/复核 API 或页面。

### 业务与并发保证

原始 Answer/Citation 不写分析事实。输入创建起冻结，完整答案摘要、对象/别名/域名、每产品事实、分析器/模型/提示/参数/规则参与 PG 生成的 input_sha256；JSON 对象键使用 PG 规范表示，数组顺序为输入一部分。PENDING 只可同值锁定或一次终结，终态分析、子结果、事实绑定和 review 的任何 UPDATE/DELETE（含同值）都拒绝。子结果只在 PENDING 装配，并须与 COMPLETED 同事务提交；失败不能遗留子结果。

每个创建时已有同产品非空 APPROVED 事实的 OWN_PRODUCT 必须选择一份并冻结强关系；manifest 与关系延迟校验完全一致。无事实 claim 只能 UNJUDGEABLE，review 也不能把它改为可判准确。事实之后 RETIRED 不破坏旧 revision。事实资格按装配事务可见快照：RR 旧快照之后的批准不回写历史；新 RC 看见合格事实后不能省略。此语义已文档化并有真实双连接反例。

统一锁顺序 Run→Analysis→Fact。应用必须在 UPDATE Analysis 前锁 Run，不能依赖 BEFORE trigger 改变 UPDATE 已取得的行锁顺序。Run 同值写建立 MVCC 冲突，业务 revision 不变，RR 过期分配/发布/review 返回 40001；显式冲突不转成功。revision=max+1 在 Run 锁下裁决，unique 最终兜底；成功输入唯一，失败允许新 revision 重试。

current pointer 仅可独立发布本 Run 最新 COMPLETED 且更高 revision，连同 Run.revision+1，不能夹带状态、费用或采集字段。失败不清空，旧版本晚完成不能覆盖新成功结果。当前 review 只在 pointer 对应 analysis 内按服务端 created_at DESC,id DESC 选择；旧 review 保留历史，过期 review INSERT 拒绝。

本任务没有新增命令幂等键或业务错误映射。数据库保留 23505/具体 unique、23514/具体 constraint、23503/强引用、40001/序列化、40P01/死锁；后续服务按命令语义受控重试。既有事实/用户删除分别返回 FACT_VERSION_IN_USE、USER_IN_USE 和真实阻断。

### 迁移与恢复

Alembic `0054_geo_analysis_contract`，down_revision=`0053_geo_collection_admission`。最终候选在隔离新数据库 geo501_final_clean 由空库成功 upgrade head，head 与六表另行查询确认；非空 0053 回答/引用/运行数据前滚及 ORM metadata 定向通过。没有历史回填；旧 Run pointer=NULL，旧回答及采集/费用列保持原值。

0054 downgrade 返回 SQLSTATE 55000 安全停止，不删除分析/复核历史。上线先迁移再接入后续消费者；失败时停止新分析写入并前向修复或恢复备份。测试数据库不属于生产或原开发数据库。收尾只清理 partsignal-geo501-validation 容器、网络和专属数据卷，cleanup.log 记录 exit 0；原 colima 与其他栈保持。

### 实际命令与结果

| 命令 | 实际结果 | 日志 |
|---|---|---|
| git diff --check | 通过，exit 0；最终再次检查 | evidence/diff-check.log |
| make contract-check | 通过，FastAPI operation 与根合同、前端 generated 类型一致 | evidence/contract-check-final.log |
| make lint | 通过，ruff 与 ESLint | evidence/lint-final.log |
| make typecheck | 通过，mypy 160 文件与前端 tsc | evidence/typecheck.log |
| make test-unit | 最终 exit 0：后端 3057 passed；前端 121 文件、1141 passed | evidence/test-unit.log |
| make test-integration（COMPOSE 覆盖为本任务隔离栈） | 初次 exit 2：897 passed、1 failed；失败修复后定向 26 passed；未重跑完整套件，不写成全量通过 | evidence/test-integration.log、evidence/integration-final-targeted.log |
| uv run --project backend alembic -c backend/alembic.ini upgrade head | 最终空库前滚 exit 0，head=0054_geo_analysis_contract | evidence/migration-final-clean.log、evidence/migration-final-clean-head.log |

隔离集成的实际 make 命令：

```sh
make test-integration COMPOSE='docker compose -p partsignal-geo501-validation -f .trellis/tasks/10-03-geo-501-analysis-contract/evidence/validation-compose.yaml'
```

失败修复后只重跑受影响的历史迁移和本任务真实 PG 范围：

```sh
docker compose -p partsignal-geo501-validation -f .trellis/tasks/10-03-geo-501-analysis-contract/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_run_migration.py tests/integration/test_geo_analysis.py tests/integration/test_geo_analysis_migration.py tests/integration/test_geo_analysis_concurrency.py tests/integration/test_geo_analysis_input.py
```

26 passed = 0048 历史迁移 4、分析不变量 10、0054 迁移 1、并发 5、输入/摘要 6。新增闭合 Schema/公共合同反例 28 项随完整单元通过。基线 contract-check、unit105、PG43 通过；更多执行日志保留在 evidence，未把阶段失败覆盖为成功。

最终迁移命令显式指向独立测试空库：

```sh
APP_ENV=test DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55461/geo501_final_clean' uv run --project backend alembic -c backend/alembic.ini upgrade head
```

这里是本地虚构测试账号；未读取/输出真实凭据。SQL 的 direct UPDATE/DELETE、unique、跨 Run、失败/倒退/过期指针与 review、强事实引用、多产品、哈希变化、删除阻断和 RR 交错都通过定向范围执行。

### 已诊断的阶段失败

- 首次完整 unit 的未修改 fake provider 并发计数测试在 CONNECT 阶段连接失败（3053 passed/1 failed）。独立 fake provider+新合同定向 52 passed，最终完整 unit 3057/前端1141 passed；未修改 provider、网络安全边界或超时来通过测试。间歇本地连接失败的精确底层原因未被证明，不宣称修复了该基础设施。
- 完整 integration 的唯一失败来自 0048 历史测试把后来新增的列/索引/FK 也纳入 0048 对比。只把 0054 的三项排除在历史 scope；保留历史数据、0048 结构与安全停止断言。修复后该文件4项及本任务22项通过。无需用另一轮全量套件重复覆盖相同风险，因此最终全量结果仍按初次失败报告。
- 开发阶段曾修正测试 SQL JSON 字符串冒号的绑定解析、多产品 fixture 的 plan 主体集合和 SET CONSTRAINTS fixture 状态；没有放宽业务约束。静态导入冲突与行宽已修正，最终 lint/typecheck 通过。
- Alembic metadata 的既有循环排序/dialect_options 警告以及新生成列不能自动修改的提示均保留；metadata 实际无差异，摘要生成和变化由直接 PG 测试另行验证。

### 独立复核与证据边界

fresh critical_reviewer `/root/geo501_review` 已只读复核持久化、显式指针、锁/隔离、强引用、历史保留和根合同。确认的 P2 OpenAPI analyzer/config 联动缺口已修复，独立纯内存反例重验通过；已有事实省略 manifest 和领域草稿说明也已关闭。无剩余已确认阻断。Reviewer 未执行 PG/Docker/迁移或套件；这些证据由主代理产生，不冒充独立执行。详见 evidence/review.md。

审计 `20261003T142737Z-geo-501-9fcdccfc` 已 finalize/verify，bundle=closed、status=passed、无待处理异常；模型/推理配置只作 Agent TOML 配置证据。校验器保留 review.tool-events.json 为未分类审计附件的提示，不影响 bundle 校验。定位见 evidence/audit-stage.json，最终回答复用已生成 SUBAGENT_EXECUTION_DIGEST。

最终 owned-paths/candidate.diff 是相对于任务开始时 before 快照的增量；没有将此前其他任务的 dirty diff 当成本任务。initial-sha256 已覆盖的无关文件未变化；新增14个文件另查末尾换行/行尾空白通过；冻结DDL生成时的行尾空格已删除，SQL token不变，最终空库再次成功前滚。敏感环境文件与 Git 引号编码路径不纳入该哈希覆盖，不声称其有完整哈希证据。本任务不写这些路径。manifest 其他任务和 OpenAPI 既有 paths 另作语义保持检查。

### 安全、前端与未执行范围

内部单租户身份/权限/CSRF/SSRF/TLS/凭据边界保持既有实现；无新外部请求，全部 provider 数据为 fake/虚构。闭合输入没有 headers/Cookie/凭据/任意请求 JSON；不复制敏感正文为外部配置。没有新端点，因此本任务不扩大公共写权限。

前端无新路由、query key、URL 状态、分析入口或页面；仅 generated 类型和既有删除阻断元数据。未运行浏览器/E2E、生产迁移、真实 AI、make verify/build：没有可达新用户流程或外部运行时变更，用户指定检查已执行，PG 反例直接覆盖本任务边界。

### 状态与后续

manifest planned→in_progress→review；Task Brief、design、implement、context 索引和 task.json 同步。六表和冻结组件是后续 GEO-502～505 算法、GEO-506 Worker、GEO-507 API、GEO-508 人工复核流程的前提；这些任务未实施。当前 API 分析区域仍保留既有 NOT_IMPLEMENTED 投影，不伪装分析已运行。人工接受后再决定 done。

### 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-501 的实现与测试证据。”据此将 manifest 的 GEO-501 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录。人工接受不将完整集成初次失败、修复后未重跑全量或其他未运行检查改写为通过。本次只记录 GEO-501 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
