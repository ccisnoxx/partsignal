# GEO-601 preflight 与基线证据

## 当前结果

2026-10-03，进入分支geo/GEO-601，保留所有前序dirty/untracked工作。GEO-507唯一依赖已done，Trellis completed且有人工接受记录；GEO-601原planned。编码前发现Accepted ADR-004/GEO-002 F09明确保留的两项产品分母裁决未完成，PRD与指标方法仍冲突。按用户停止条件标记blocked；没有开始实现，不标review/done，不提交/推送/归档/发布。

两项决定请求已通过本会话用户输入工具提出：首位推荐率分母是全部推荐适用合格运行还是仅可靠排序运行；严重错误运行率分母是全部合格运行还是有可判断声明的合格运行。未收到裁决时不推定选择。具体源位置、50%/100%反例及恢复条件见prd.md §17、evidence/blocking-contracts.json。运行成功率/分析成功率争议留后续数据质量任务，不提前扩大范围。

## 变更与行为边界

只新增本任务prd.md/design.md/implement.md和证据；manifest中仅601改blocked并链接任务/阻断原因；SHA256SUMS只更新manifest条目。起始sha256记录、manifest/hash前像、task-only.diff与scope-audit.json证明没有修改既有源码、OpenAPI、数据库合同、迁移、部署或前端，也没有修改其他任务。

没有Alembic revision、新前滚或数据迁移；测试只操作独占本地测试PG。无锁、幂等、revision、状态机、错误映射、身份、安全、敏感数据或外部调用变化。前端路由/query key/URL/页面保持原行为。当前metric_eligible仍是既有false/null占位，不以本任务基线通过声称公式已实现。

## 实际检查

所有argv和exit_code在evidence同名JSON，完整输出在同名log；根命令均从仓库根运行。`document-hashes-final`从docs/geo-monitoring运行。

| 命令 | 已确认结果 | 证据 |
|---|---|---|
| uv run --project backend pytest backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_recommendations.py backend/tests/unit/test_geo_citations.py backend/tests/unit/test_geo_claims.py backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_review_contract.py backend/tests/unit/test_geo_read_contract.py backend/tests/unit/test_geo_fixtures.py | 退出0，352 passed | baseline-unit.json/log |
| make lint | 退出0，ruff与eslint通过 | lint.json/log |
| make typecheck | 退出0，mypy 177源码及tsc通过 | typecheck.json/log |
| make test-unit | 退出0，后端3341、前端1170通过 | unit.json/log |
| make contract-check | 退出0，runtime/static与generated一致 | contract-check.json/log |
| make test-integration COMPOSE='docker compose -p partsignal-geo601-validation -f .trellis/tasks/10-03-geo-601-metric-formulas/evidence/validation-compose.yaml' | 退出0，973 passed、25 warnings，476.51秒 | integration-baseline.json/log |
| git diff --check | 退出0；新任务文档另行检查无尾随空白 | diff-check.json/log |
| shasum -a 256 -c SHA256SUMS | 退出1，3项开始前已不匹配 | document-hashes-final.json/log |

文档哈希3项为frontend-architecture、requirement-traceability-matrix及README。preexisting-document-hash-mismatches.json用开始时的文件sha256与开始时清单比对，确认不是本任务造成；scope-audit进一步证实三文件当前字节未改。仅同步本任务改变的manifest哈希，不修正前序任务产物。

集成25条警告为既有SQLAlchemy循环FK排序与dialect_options提示，完整详情在日志，未隐藏warning。六项用户最低检查全部实际执行并退出0；新增公式金标未执行，不能据基线通过声称601已验收。

收尾：本任务Compose执行down --remove-orphans退出0，容器与网络已移除；保留本任务测试数据卷供复现，不影响其他项目。最终git diff --check退出0，最终起始哈希对比再次确认只有manifest与SHA256SUMS两份既有文件变化；新增Task Brief/design/implement/task.json和证据均在601目录。没有仍在运行的本任务检查。

首个可选文档哈希命令从错误目录执行而退出2；定位cwd后改为文档目录，得到上述真实3项不匹配，初次输出保留。不把它记成通过。首次范围审计用系统Python缺PyYAML，改用项目uv环境后审计通过；未新增依赖。初次Task Brief patch格式被工具拒绝后使用合法Update，未发生源码修改。

## 验证限制与后续

以上都是当前实现基线，不是GEO-601候选验收。完整金标公式测试未编写或执行：公式分母尚待产品裁决，库未实现。未运行本任务浏览器/E2E、性能、真实供应商或生产迁移；当前无候选运行时变更，且这些能力不在601实施范围。无候选高后果变更，不委派独立代码复核，不把自查称独立复核。

解除阻断后同步唯一指标字典及冲突文档，将601改in_progress，实现纯资格/公式和完整金标，按实际变化重验相关门禁，最终仅交付review。602/603/604/701不实施。


## 恢复实施：两个分母裁决已收到

2026-10-03用户明确答复“两个都采用指标方法口径”。此前的blocked段落是首次preflight历史，不代表当前阻断。已保存denominator-decision.json、ADR-004裁决记录，并把601从blocked转in_progress，开始实现。Trellis task已挂接本会话，implement/check/debug.jsonl记录精确范围与权威合同。仍只实现601，GEO-507 done未变。

实现三份内部源码（types / snapshot转换 / metrics），18个字典公式和125项定向金标/边界/转换测试。结果包括cell、scope集合、value/分子/分母/样本、合格/排除数、原因码、合格运行ID与UNJUDGEABLE数。没有OpenAPI、数据库合同、Alembic、生产数据、前端或发布变化；资格占位接线留602。

首轮诊断：mypy发现推荐枚举实际名称为GeoRecommendationKind，修正命名；金标维度反例清空subject binding违反输入合同，改为改变revision来测试可比性；转换夹具完成时间早于创建时间，统一夹具时间。未弱化实际schema或业务守卫。随后针对125项定向最终退出0。

自查补强：逻辑样本的多active attempt检查移到通用资格之前，即使其中一个失败也不能择优。完整unit已在该补强前通过3465后端/1170前端；补强后新增一个真实反例，125项定向重新通过，受影响公式范围全覆盖。完整integration不调用新纯库、既有API/ORM/迁移字节不变，其实际结果待完成后记录。未把运行中检查写成通过。

纯计算非法输入抛ValueError，未新增HTTP错误映射。无事务/行锁/幂等键/状态/revision/队列变化，稳定ID业务消息不变。库不进行身份或租户查询，未来调用方必须传入已有授权且一致读取的服务端事实。测试全部虚构，无真实外部AI，无凭据或敏感正文写入日志。

自查覆盖新算法和转换，不是独立代码审查；本任务未改变公开运行时合同、持久化、安全、并发或迁移保证，不触发高后果独立复核。完整金标预期由手工常量给出，不由待测公式计算。


## 候选验证及交付 review

所有根命令在仓库根执行；JSON记录argv/exit_code，log保留完整输出。实现只改了纯计算库；在完整unit之后补强一个重试守卫时，直接受影响的完整公式/转换125项定向重新通过，最终lint/typecheck也重新通过；集成覆盖的既有API/ORM/迁移在这期间字节未变，没有把补强前的unit次数写成新增测试已跑。

| 实际命令 | 结果 | 证据 |
|---|---|---|
| uv run --project backend pytest backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_metric_inputs.py | 125 passed，退出0 | candidate-formula-latest.json/log |
| make lint | 最终退出0，后端ruff/前端eslint通过 | candidate-lint-final.json/log |
| make typecheck | 最终退出0，mypy 180源码及tsc通过 | candidate-typecheck-final.json/log |
| make test-unit | 退出0，后端3465、前端1170通过（后端含补强前124项601测试） | candidate-unit.json/log |
| make test-integration COMPOSE='docker compose -p partsignal-geo601-validation -f .trellis/tasks/10-03-geo-601-metric-formulas/evidence/validation-compose.yaml' | 退出0，973 passed、25既有warning，479.00秒 | candidate-integration.json/log |
| make contract-check | 退出0，runtime/static及generated OpenAPI一致 | candidate-contract.json/log |

integration的25条SQLAlchemy warning与基线同类（循环FK排序/dialect_options），未过滤。不存在本任务未运行的必要公式、静态、单元或集成检查。没有运行Browser/E2E、真实AI或生产迁移：无浏览器路径、外部集成或数据库变化，不属于601，完整E2E亦不是本任务指定门禁。公共metric_eligible占位未接线库；后续602负责Overview/资格投影，603趋势与矩阵，604引用/事实洞察明细，701管理员配置。

task-manifest和task.json从in_progress改review；未done，未归档、提交、推送、发布。原先两个分母阻断已解除，其他任务不变。最终scope audit以起始hash逐文件比较，证明仅6份任务相关既有文档变化及6份新源码/测试；无删文件/意外变更，根合同、迁移、前端字节均不变。完整Task Brief/design/JSONL/决策、金标、测试及before/diff/hash证据均保留本任务目录。

最终文档SHA256SUMS只同步本任务实际修改的PRD、方法、ADR、manifest、README；README起始已有错误hash因本任务实际修改而同步。原先frontend-architecture及requirement-traceability-matrix两项不匹配继续保留，是开始前已确认的不匹配，不能当成通过或擅自修改其内容/条目。


收尾命令实际结果：git diff --check退出0（candidate-diff-check）；task-only.diff新增行含未跟踪源码/文档的尾随空白检查退出0（candidate-added-whitespace）。完整文档hash校验退出1，仅上述两项起始不匹配，五份本任务文档hash均OK（candidate-document-hashes）。scope audit退出0，GEO-507 done、601 review，其他manifest项/既有源码/根合同/迁移/前端无变化（candidate-scope-audit）。Compose down --remove-orphans退出0，独占容器和网络已清理，数据卷保留复现；没有运行中的本任务检查（candidate-cleanup）。最终命令汇总在candidate-validation-summary.json。


### 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-601 的实现与测试证据。”据此将 manifest 的 GEO-601 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、execution_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录；既有测试结果与验证限制不作改写。本次只记录 GEO-601 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
