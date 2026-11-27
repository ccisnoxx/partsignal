# GEO-506 执行与证据

## 当前交付

分支 `geo/GEO-506`。仅实现506：采集→分析接线、冻结输入/hash/revision、一次claim、四阶段规则结果/引用分类/review reasons、首次Run/Batch状态、原子current pointer、内部管理员reanalyze及数据库恢复。507公共查询/命令/复核与页面、指标/Opportunity/Browser均未实施。

主要生命周期由`geo_analysis_runs`拥有，输入/纯计算/投递/管理员命令按真实职责分离；原纯规则`geo_analysis.py`未引入生命周期或循环依赖。完整变更文件与相对任务开始的差异见`evidence/changed-files.json`和`evidence/task-only.diff`。

## Preflight 与基线

- 已读取根/后端AGENTS、适用Trellis规范、全部用户指定目标文档、WBS完整任务行、Accepted ADR-002/003、当前根合同/迁移/相关代码测试与既有任务记录。详细权威单元定位见`research.md`。
- GEO-502/503/504/505/405全部done，506初始planned，允许进入R4执行。506随后in_progress；依赖与其他任务状态不改。
- 已有工作树包含此前GEO任务大量未提交改动。`evidence/baseline-files.json`保存其起始哈希；`before`保存源/合同/文档；缺失测试文件的原始文本仅在重建SHA256与起始哈希完全相等后记录，不覆盖工作树。
- 当前基线：`baseline-unit`737 passed，`baseline-pg`21 passed；完整argv/退出码与日志见对应JSON/log。
- 每项检查由`evidence/run_check.py`保存真实命令、结果和完整日志，失败不自动重试。

## 事务、状态和幂等

- 创建使用REPEATABLE READ，Batch→Run锁内冻结首轮Run字典或显式重分析当前同身份/角色字典，选择同产品最高合格APPROVED事实；PG hash唯一权威。同hash PENDING/COMPLETED复用，FAILED可显式追加。40001/40P01不猜测成功；扫描下一周期重新读事实。
- claim/提交锁Batch→Run→Analysis→Job。revision是唯一分析状态源，Job只有执行/投递元数据，每revision最多一次claim，300秒lease；计算在事务外，无外部AI/HTTP。
- 首次COLLECTED→ANALYZING；结果、Job lease释放、COMPLETED revision/reasons、首次Run终结/lease释放、pointer-only更新、Batch刷新同事务commit。无原因→COMPLETED，有原因→NEEDS_REVIEW。unknown confidence保留NULL。
- 结果写入失败回滚，再以有效token安全记录FAILED/ANALYSIS_FAILED；AnswerSnapshot/原始Citation不删改。后续分析失败不改变采集终态或旧pointer；最新成功版本才发布，迟到旧成功可保留历史但不倒退current。提交端直接拒绝错误/过期token，不依赖扫描及时性。
- 0055三侧deferred约束按最终行仲裁：revision-only终结、Run-only替换lease或退出ANALYZING但仍有活动Job均不能提交。正常同事务多次Run UPDATE与旧0054无Job历史相容。
- 若失败记录事务本身DB故障，Worker明确抛出安全RuntimeError；只记ID/异常类型，原lease等数据库恢复后过期扫描终结，不宣称FAILED落库。traceback不串入原异常正文/SQL参数。
- Collector Celery提交后只投递Run UUID；扫描覆盖人工COLLECTED及commit后投递丢失。revision派发先提交次数/时刻再发UUID，Broker不可用停止该轮，重复消息由claim仲裁。关闭总开关不新claim/派发，仍允许过期安全终结。

## 契约、迁移和数据

OpenAPI与generated前端类型相对本任务起始字节不变，无新operation、Router写入、路由/query key/URL状态。既有Run读模型可以观察首次状态推进；分析详情、reanalyze HTTP/复核接线留给507。

数据库权威增加`geo_analysis_jobs`与`geo_citation_classifications`及约束/锁/恢复合同。Alembic `0055_geo_analysis_worker`，down_revision=`0054_geo_analysis_contract`；仅加表/索引/guard，无存量回填，不修改旧迁移。

0055实际验证：空库逐级前滚和非空0054含PENDING/COMPLETED/FAILED、绑定、原始回答/引用、current pointer与review历史前滚；全部历史行保持相等，新两表空，ORM compare_metadata无差异，旧无Job ANALYZING后续正常终结。downgrade以55000明确停止，版本仍0055；停止新Worker/beat、保留表与历史并前向修复。不操作生产数据库。

历史迁移测试分开维护：current-head测试跟随0055；0054专项测试显式升级0054。没有为迁移测试修改或放宽生产guard。

## 安全和敏感数据

内部reanalyze锁最新User，重新验证active、ADMIN、改密门禁、expected_revision、已结束首次分析且保有Answer；拒绝客户端自报权限。创建/受控成功审计同事务，只有ID与闭合reason_code，commit后Broker失败不撤销已接受ID。最新账号停用/强制改密/降权的过期actor负例均有实际证据。

分析只有本地确定性规则，不新增凭据/外部模型/SSRF/TLS能力；冻结事实强绑定不随后来RETIRED替换，正文/分类不可变。不保存未知补零、第二正文或自由审计文本。日志/固定错误不保存答案、事实、凭据、SQL或原始异常。普通测试仅虚构数据、fake provider/本地模拟及独立Redis，不使用真实外部AI。

## 实际检查

| 命令/证据 | 结果 |
|---|---|
| baseline-unit / baseline-pg | 737 / 21 passed |
| make lint，最新lint-candidate | 退出0，Ruff/ESLint通过 |
| make typecheck，最新typecheck-final | 退出0，mypy172源文件/tsc通过 |
| make test-unit，unit | 后端3327、前端1141（121文件）通过 |
| make contract-check，contract | 退出0；OpenAPI/schema检查通过 |
| run-lease-final，六个相关PG集成文件 | 96 passed |
| migration-targeted，0055及关联迁移4文件 | 4 passed |
| security-targeted，Worker文件 | 16 passed |
| failure-record-final，Worker及guard两文件 | 30 passed；含最后安全错误保护 |
| make test-integration，integration-final | 退出0，944 passed，25个ORM metadata既有类别警告 |
| git diff --check，diff-final | 最终状态更新后退出0；13个新文件另查无空白诊断 |
| Trellis task.py validate，trellis-context | 退出0，implement/check各5项，无注入截断警告 |
| WorkPlan summary/digest/audit-finalize/audit-verify | 通过，2个fresh只读复核，无异常 |

完整集成使用本任务隔离环境：

```sh
make test-integration 'COMPOSE=docker compose -p partsignal-geo506-validation -f .trellis/tasks/10-03-geo-506-analysis-worker/evidence/validation-compose.yaml'
```

定向命令都是同一Compose `run --rm backend-test pytest <明确文件> -q`；精确文件列表、参数、退出码在对应JSON。完整集成第二轮开始后，主代理增加最后一处失败记录安全错误保护，相关两文件30项使用最新补丁复验；不把新增故障用例算作该轮完整集成的用例。

未执行：浏览器E2E/浏览器矩阵、make verify/build、真实外部AI和生产迁移。无前端/HTTP操作变化，不重复其他发布阶段的全门禁；完整后端集成与真实Redis/Celery及定向PG直接观察本次合同。未穷举任意直接SQL并发交错。

## 初次失败与修正

- worker-first：1失败；测试错误期待FORBIDDEN，当前权威码PERMISSION_DENIED。修正期待，未放宽权限。
- worker-targeted：1失败；扫描起始时钟早于本周期新建revision。派发改为新事务PG时钟，74项通过。
- run-lease-review-fix：1失败；新增Run deferred约束可能先于Job约束报错。负例仅接受两种明确有效约束，96项通过。
- 首轮完整集成：5 failed、933 passed。3项是旧head/降级错误断言；1项是上述旧约束期待（测试模块在修正前已加载）；另1项因前项失败遗留lease导致扫描2条。修正迁移测试与guard期待，4项迁移和相关96项定向通过，完整集成重新执行。
- 最后故障回归`failure-record-red`：在修复前因数据库失败异常链带出canary且缺少安全RuntimeError而失败；补丁后`failure-record-final`30项通过。故障canary是虚构标记，不是真实敏感数据。
- 初次新增迁移测试Ruff报告长行/导入格式，局部修正后最新make lint通过。没有盲目重试或以mock固定成功替代数据库边界。

## 独立复核和审计

两阶段critical_reviewer的发现、处理和覆盖缺口见`evidence/independent-review.md`。第二次专门复核最终Run侧守卫，无新确认阻断；旧历史前滚由主代理实际补验。最后安全错误保护是主代理定向验证，未额外独立复核。

Validated SUBAGENT_EXECUTION_DIGEST已生成，Bundle关闭且audit-verify通过，无未执行ready task、残留活跃Worker或未知写入证据。audit_id=`20261003T203423Z-geo-506-59295c7a`；Task中保存Digest副本，正式Bundle可由audit-show定位。模型/档位是Agent TOML快照，业务验收不由代理completed推断。

## 交付状态与限制

本地验证已完成，manifest和Trellis已从in_progress进入review，等待用户人工验收；不自行done，不提交/push/创建PR/发布。SHA256SUMS同步实际修改文档。最终候选相对起点共31个源码/测试/合同/文档文件；1342个非本任务起始文件字节保留，无越界修改。OpenAPI、generated类型、全部前端文件与旧0054迁移未改。检查过实际task-only.diff，未发现覆盖/平行状态/隐式回退/秘密/无关格式变化。最终哈希与范围证据见scope-verification/candidate.sha256；13个新文件空白检查无诊断。SHA256SUMS共116项校验通过；本任务隔离Compose网络/卷已清理，未操作其他环境。

确定性本地规则、固定300秒执行lease、无第三方来源登记（未匹配UNKNOWN）是当前能力边界。分析失败需显式reanalyze，不做同revision无限重试。没有强制回填旧0054分析的机器引用结果。

现有人工提交公共回执的analysis_dispatch仍按合同固定NOT_IMPLEMENTED；提交服务不直接派发分析，由独立COLLECTED扫描处理，回执不代表当前进度。现有详情分析区也仍属507读取接线范围；实际Run状态与数据库结果可观察。未改写旧回执或引入新的HTTP/UI字段。

后续仅记录GEO-507复核策略/API/当前结果读取，以及GEO-508页面；未实现。

### 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-506 的实现与测试证据。”据此将 manifest 的 GEO-506 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录；既有测试结果、独立复核范围和验证限制不作改写。本次只记录 GEO-506 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
