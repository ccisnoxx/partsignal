# GEO-502 实施证据

状态：done；2026-10-03 本会话用户已人工审查并接受实现与测试证据，Trellis 为 completed。任务仅 GEO-502 / R4。

## 执行资格与基线

- manifest 的 GEO-501、GEO-106 均为 done；分别由 `.trellis/tasks/10-03-geo-501-analysis-contract/task.json` 和 `.trellis/tasks/10-02-geo-106-catalog-acceptance/task.json` 的人工接受记录佐证。当前分支已是 geo/GEO-502，未创建分支、提交、PR或外部写入。
- 按19节模板创建 [Task Brief](./prd.md)，阅读根/backend AGENTS、Trellis workflow/spec、用户指定19项GEO文档、现有501/106/005记录、当前Catalog/Run/Analysis合同及0054和代码/测试。编码前已输出完整12项preflight，然后仅将GEO-502 planned→in_progress。
- 开始前保存全局工作树路径状态与文件SHA-256；现有大量未提交/未跟踪工作保留。本任务增量以 evidence/before 与 candidate.patch 识别，不把整个git status计入本任务。
- 基线：180定向unit、16真实PG分析input/不可变集成、make contract-check全部通过。精确命令、退出码、日志为 evidence/baseline-*.json/log。

## 实现与合同

- `freeze_subject_aliases` 显式复制已校验SubjectSnapshot到不可变值，保留身份/revision/类型/别名种类/语言，严格检查Catalog规范键；不重读当前字典或猜展示名。当前一致字典读取与完整AnalysisInputSnapshot入库留GEO-506。
- `identify_mentions` 使用NFKC/casefold/水平空白/有限连字符规则，保护英文、数字、下划线和型号前后缀/路径/点号段。基字符/组合符映射保留原始Unicode字符offset；不跨换行或只匹配半个规范展开。
- 同对象重叠/重复规范别名只计一次，多个出现正常计数；跨对象歧义完整保留候选并统一ALIAS_AMBIGUOUS，不按role、语言、类型或顺序选择。共有SHARED_ALIAS、NORMALIZED_ALIAS_COLLISION、OVERLAPPING_ALIASES原因。
- 否定只保留有界同分句词面线索，不删提及，不推导推荐；转折及not only/不仅反例覆盖。答案指令只当原文，不执行工具或网络。
- 无OpenAPI、数据库合同、ORM、Alembic、Router、Worker、状态机、锁顺序、revision、队列、幂等记录或前端变化。无新事务/错误映射；无效字典/答案固定ValueError且不回显输入。当前分析页面仍NOT_IMPLEMENTED。
- Alembic head仍0054_geo_analysis_contract（evidence/migration-head.*）。既有baseline临时库由answer_database执行0049→head后验证分析防线；没有本任务迁移、回填、生产前滚或历史数据写入。

## 金标与反例

- 独立mentions-v1的28场景与共享v1原13场景直接运行算法；共有49项新服务/金标/快照/边界测试。旧v1的格式、原文及推荐/声明预期完全不动。
- 新金标独立编写身份、摘录和否定/歧义预期，不从分析器生成。geo_fixtures.py复用闭合Schema、原文关系与既有敏感扫描；make test-geo-fixtures同时校验两个数据集。无真实客户数据、平台回答或网络调用。
- 首轮46测试通过；接入新金标校验后74项通过。补充参考型号路径/点号及混合类型共享别名两个反例，先确认2项失败，再将边界移到完整匹配键，防止过滤产品候选后误选品牌。evidence/mixed-boundary-red.*保留失败；最终229定向unit通过包含两反例。
- 首次定向ruff发现长行/import排序并已修复；完整lint/typecheck均通过，不将首次失败写为通过。

## 运行命令与结果

所有检查通过evidence/run_check.py保存真实argv、exit_code和完整输出；此处不省略失败或将未运行命令标通过。

| 检查 | 结果 | 证据 |
|---|---|---|
| 基线定向unit | 180 passed | baseline-unit.json/log |
| 基线PG分析及input | 16 passed | baseline-integration.json/log |
| 基线make contract-check | exit0 | baseline-contract.json/log |
| 型号/混合类型反例（修复前） | 2 failed，预期红测 | mixed-boundary-red.json/log |
| 最终定向unit | 229 passed | mention-unit-final.json/log |
| git diff --check | exit0 | git-diff-check.json/log |
| make lint | exit0，后端ruff与前端eslint | make-lint.json/log |
| make typecheck | exit0，mypy161文件与前端tsc | make-typecheck.json/log |
| make test-unit | 后端3106 / 前端1141 passed，exit0 | make-test-unit.json/log |
| make test-integration（本任务独占Compose） | 906 passed / 23既有SQLAlchemy warnings，443.77s，exit0 | make-test-integration.json/log |
| make contract-check | exit0 | make-contract-check.json/log |
| make test-geo-fixtures | 28新增/13共享金标离线校验通过，exit0 | make-geo-fixtures-final.json/log |
| Alembic heads | 0054_geo_analysis_contract，exit0 | migration-head.json/log |

命令全文由对应json保留；最低五项命令全部实际运行并通过。
集成的唯一覆盖参数为 `COMPOSE=docker compose -p partsignal-geo502-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-502-mention-matching/evidence/validation-compose.yaml`，不改仓库部署配置。

诊断记录：一次psql版本查询指向Compose默认空库，报不存在alembic_version；fixtures使用自己的临时库，默认库未被迁移。分类及命令保留default-database-probe.json，不把它误报为前滚失败或成功。

## 增量审查与限制

主代理完成候选源码、金标和原始工作树增量核对；本任务无高后果公共/持久化/权限/并发保证变更，未委派、不将自查称为独立复核。稳定规则记录于Worker架构，执行过程只留本任务。

否定规则仅80字符同分句词面证据，不承诺通用NLP/指代/跨句语义。共享别名保守进入复核，不利用邻近唯一名称推测身份。匹配只消费所给冻结范围，不重新选择当前Catalog或事实。

未运行make e2e、浏览器矩阵、make build、真实平台或Worker/复核完整旅程：本任务无运行时接线、页面、协议、打包或外部传输变化，不能证明尚未实现的后续任务。用户最低五项门禁全部执行。运行详情分析区仍NOT_IMPLEMENTED。

后续GEO-503、504、505分别实现推荐/引用/声明；GEO-506将原子提交与Worker接线并消费ALIAS_AMBIGUOUS推进NEEDS_REVIEW；507/508提供复核与页面，本任务不提前实现它们。

## 最终交付状态

- manifest仅GEO-502 planned→in_progress→review；其他task entry逐字不变。Trellis task.json=review、completedAt=null；6项有效上下文通过task.py validate。大文档的已读完整合同由Task Brief/design定位，避免hook截断关键任务行。
- 全部门禁通过，23条integration warnings来自既有SQLAlchemy表排序/dialect_options迁移反射路径，没有失败或skip被写成通过。
- docs/geo-monitoring仅更新本任务涉及4份文档的SHA256SUMS条目，最终整包校验exit0（evidence/docs-sha.json/log）；候选增量及初始hash核对保留既有未提交/未跟踪工作。
- 本任务专用Compose容器/卷在测试结束后清理，保留已有Docker引擎和其他任务资源；实际清理exit0，见evidence/cleanup.json/log。

## 最终精确验收命令

```bash
git diff --check
make lint
make typecheck
make test-unit
make test-integration COMPOSE='docker compose -p partsignal-geo502-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-502-mention-matching/evidence/validation-compose.yaml'
make contract-check
make test-geo-fixtures
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_fixtures.py backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_catalog_policy.py backend/tests/unit/test_geo_catalog_schema.py backend/tests/unit/test_geo_run_contract.py
UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini heads
# 此项在 docs/geo-monitoring 目录执行
shasum -a 256 -c SHA256SUMS
```

基线精确argv见baseline-unit.json与baseline-integration.json；测试与清理均确认退出码后才进入review。最终incremental-files.json、preservation-audit.json与candidate.patch包含本任务增量，既有根合同/迁移/generated和其他修改hash保持不变。候选新文件也单独检查末尾换行与行尾空白，避免git diff --check漏掉未跟踪文件。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-502 的实现与测试证据。”据此将 manifest 的 GEO-502 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施交付记录与 evidence 中的 review 状态保留为人工验收前的历史记录；既有测试结果、warning 和未运行检查不改写。本次仅记录 GEO-502 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
