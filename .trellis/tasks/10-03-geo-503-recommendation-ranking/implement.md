# GEO-503 实施与验证记录

## 当前状态
实现及本地验证完成，manifest/Trellis=review，等待人工接受，不自行done。当前分支geo/GEO-503；无Commit/PR、提交、推送、生产迁移或发布。

## 实现摘要
- geo_analysis.classify_recommendations消费同一原文/冻结字典，调用既有提及匹配并装配每个确认subject唯一的不可变四态结果、可空rank、原文依据、全部局部证据及复核原因。confidence=null，不造概率。
- geo_recommendation_rules拥有对象分句、并列/转折/否定/条件/引语规则和列表可靠性判定。已匹配名称/别名文字排除在评价线索之外，避免名称内“推荐/首选”自动制造推荐或排名；证据原文不改写。
- 可靠推荐顺序才产1-based rank；普通编号、无序、并列、缺号/重号、重置/多序列、歧义/重复对象/单项多对象、非推荐项、位置与序号冲突及否认优先级均保留null。不压缩未监测项位置、不按提及offset排名。
- 推荐缺乏可靠顺序返回UNRELIABLE_RANK；无依据/不确定为UNKNOWN，矛盾返回RECOMMENDATION_CONFLICT及全部原证据。歧义保持ALIAS_AMBIGUOUS，不任选对象。固定规则版本geo-recommendations-v1。
- 63项独立推荐金标和共享13场景实际执行，不改变共享corpus/gold或mentions-v1。fixture校验只保护格式/引用/隐私，不生成分类或排名预期。新增测试另覆盖原文span、依据2000字符边界、不可变/safe repr和固定失败。

## 修改文件
- `backend/app/services/geo_analysis.py`
- `backend/app/services/geo_recommendation_rules.py`
- `backend/tests/unit/test_geo_recommendations.py`
- `backend/tests/geo_fixtures.py`
- `backend/tests/fixtures/geo_analysis/recommendations-v1.json`
- `backend/tests/fixtures/geo_analysis/recommendations-v1.schema.json`
- `backend/tests/fixtures/geo_analysis/README.md`
- `deploy/scripts/check-geo-fixtures.py`
- `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
- `docs/geo-monitoring/README.md`
- `docs/geo-monitoring/CHANGELOG.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/SHA256SUMS`

另有本任务目录内Task Brief、设计、资料索引和验证证据；未修改前序任务。

## 契约、数据库、迁移及前端
根OpenAPI/数据库、ORM、0054及generated类型逐字/hash保持初始状态；复用GeoRecommendationKind/Out。无新operation、Schema、约束、索引或Alembic revision，head为0054_geo_analysis_contract。基线PG分析/input测试通过既有临时库前滚；完整integration进一步覆盖现有迁移。没有本任务数据迁移、历史回填、生产前滚或自动重分析；恢复只需撤销本任务代码，不动历史数据。

前端路由/query key/URL/generated/页面状态无变化；运行详情分析区仍NOT_IMPLEMENTED。GEO-506才拥有Worker/revision原子写入和复核门禁，GEO-507/508才接复核/API/UI；本次不提前接线。

## 事务、并发、幂等与错误
本纯阶段无Session/ORM/Router/外部I/O、事务、锁、revision分配或状态写入。冻结值和确定性排序保证同输入同结果，没有第二输入hash或持久化幂等机制。既有Run→Analysis→Fact锁、current pointer、terminal immutability、SQLSTATE映射及at-most-once均不变。坏答案沿用固定中文ValueError，不回显正文；尚无HTTP接线和新增错误映射。

## 安全与敏感边界
只处理输入文本，不执行其指令，不调用工具或联网；没有真实外部AI/客户数据/外发事实。测试身份、语料、账号及对象存储全部虚构且独占本地。结果repr不输出正文/别名，依据仅来自原回答；金标复用敏感标记和fixture URL扫描。测试不放宽权限/CSRF/SSRF/TLS/不可变/审计边界。无secret进入新业务配置、输出或审计。

## 基线
| 实际命令 | 结果 | 日志 |
|---|---|---|
| env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_fixtures.py | 104 passed | baseline-unit.json/log |
| make contract-check | exit0 | baseline-contract.json/log |
| docker compose -p partsignal-geo503-validation -f .trellis/tasks/10-03-geo-503-recommendation-ranking/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_analysis.py tests/integration/test_geo_analysis_input.py | 16 passed | baseline-integration.json/log |

## 候选验证
| 实际命令 | 结果 | 日志 |
|---|---|---|
| git diff --check | exit0；收尾再次检查 | git-diff-check.json/log |
| make lint | exit0，Ruff/ESLint | make-lint-final.json/log |
| make typecheck | 最终exit0，mypy162文件及frontend tsc | make-typecheck-corrected.json/log |
| make test-unit | exit0，backend3189/ frontend121文件1141 passed | make-test-unit.json/log |
| make test-integration（本任务独占Compose） | exit0；906 passed / 23既有SQLAlchemy warnings，441.95秒 | make-test-integration.log |
| make contract-check | 基线与候选exit0，根合同/生成类型一致 | candidate-contract.json/log |
| make test-geo-fixtures | exit0；63推荐/28提及/13共享场景，外部调用0 | make-geo-fixtures.json/log |
| env UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini heads | exit0；0054_geo_analysis_contract | alembic-head.json/log |
| 最终定向推荐/提及/合同/fixture | 187 passed；候选类型注解仅修正类型，不改行为 | recommendation-candidate-final.json/log |
| 候选源码Ruff | exit0 | candidate-ruff.json/log |

完整集成命令：
```bash
make test-integration COMPOSE='docker compose -p partsignal-geo503-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-503-recommendation-ranking/evidence/validation-compose.yaml'
```
定向命令：
```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_recommendations.py backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_fixtures.py
```

## 已诊断失败与修复证据
- recommendation-first：5 failed/62 passed。非推荐成员错误参与排序、条件前逗号截断、尾部顺序声明、品牌修饰语错误推荐和列表依据粒度；修复后171定向通过。
- scope-negation-red：6 failed/2 passed/67 deselected。间接否定和未知对象前后句评价串判、英文顺序标题未继承；新证据后修复，179定向通过。
- negative-position-red：4 failed/75 deselected。recommend against/avoiding、建议避免和首选位置/编号冲突；修复后183定向通过。
- name-cue-red：2 failed/1 passed/80 deselected。名称内推荐/首选被当作线索；排除命中名称文字后187定向通过。不改写金标使错误实现通过。
- make-typecheck-final：exit2，辅助局部parts缺list[str]注解；补注解后make-typecheck-corrected exit0。无业务逻辑或断言放宽。
- 初始化记录脚本的系统python缺PyYAML；改用项目uv runtime后依赖确认与状态更新成功，未误写blocked或假称原命令通过。

所有完整输出、精确argv及exit_code由evidence/run_check.py保存，不覆盖阶段失败。

## 增量检查与证据
初始source hash、工作树和所有修改前文件保留evidence；candidate.patch是相对于会话初始状态的真实增量（旧服务/文档原本未跟踪，不能只看git HEAD diff）。未发现非任务文件变化；根合同/迁移/generated/部署与前序任务变化保持。三个资料索引条目通过task.py validate；不把索引当全文读取或实现证据。

本任务不触及公共API/持久化/权限/并发/迁移/发布保证，没有独立复核的必要高后果候选；主代理自查，不称为独立审查，未委派子代理。

## 未运行检查及限制
未运行make e2e、make build、make verify、浏览器矩阵、真实AI或生产smoke：本任务没有UI/完整旅程、打包、出站或Worker接线变化；这些不能证明仍属后续任务的能力。用户最低五项门禁全部实际运行并通过。

确定性规则不承诺跨句指代、反讽、表格/嵌套/续行、未登记型号或未知排序词；复杂评价保守UNKNOWN并复核。多序列/否认顺序会保守清空排名，不能据纯阶段宣称完整R4上线。GEO-504/505、506、507/508以及R5指标、Opportunity、Browser均未实现。

## Task Brief及状态
根manifest仅GEO-503 planned→in_progress→review；Trellis Task Brief/prd、design、implement、上下文和evidence记录范围/授权/基线/验收。依赖GEO-501/502均done且人工接受记录存在。不提交、推送、归档、发布或自行done；本地验证完成并交付review；completedAt=null。


## 最终本地交付
完整integration906通过、23条既有SQLAlchemy循环表排序/dialect_options警告，未跳过或弱化防线。全部最低命令及合同/fixture验证退出0。前序任务/根合同/迁移/generated和部署配置hash保持，manifest除GEO-503条目外逐字不变；没有提交/推送/发布/归档。源码维持geo_analysis377行、推荐规则312行，各自单一职责。文档SHA仅同步本任务四份文档；最终增量和新文件空白检查保留evidence。测试专用环境已通过专属Compose down --volumes --remove-orphans清理（cleanup.json/log，exit0），未触碰其他项目资源。

收尾git-diff-check-final exit0；docs-sha初次exit1：SHA清单路径带./，更新脚本漏匹配本任务四条。已按原路径更新四个摘要，docs-sha-corrected exit0，整包SHA通过；Task上下文六个条目验证通过且无warning。preservation-audit.json确认全部非任务基线文件未变，new文件完全匹配所有权；final-file-hashes.json和candidate.patch保留最终增量。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-503 的实现与测试证据。”据此将 manifest 的 GEO-503 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施交付记录与 evidence 中的 review 状态保留为人工验收前的历史记录；既有测试结果、warning 和未运行检查不改写。本次仅记录 GEO-503 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
