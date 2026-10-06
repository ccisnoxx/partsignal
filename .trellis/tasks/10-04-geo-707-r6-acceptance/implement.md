# GEO-707 实施与 R6 验收证据

实施日期：2026-10-04。当前状态：completed；2026-10-05 本会话用户已人工审查并接受实现与测试证据。

## 实现与业务边界

首次真正创建机会追加永久 `geo_opportunity.opened`，与机会、来源和 evaluation 使用同一应用服务事务。必需 keyword `request_id` 仅用于操作追踪，不参与 fingerprint。重放、并发竞争输家和 UPDATED 不增加 opened。所有现有 evaluator 测试和 E2E seed 调用者已迁移。

前端闭合审计消费者登记 opened、既有 `geo.retest.created` 和四个复测字段。未登记字段、复杂值、未知动作仍显式拒绝；不复制原因、回答、产品事实或内容正文。

PG 与真实栈 Playwright 证明五个零提及样本经真实分析和规则生成 TOPIC_COVERAGE_GAP；关联 ContentTask 完成后仍 IN_PROGRESS；五个严格同口径复测样本恢复后仍 NOT_ESTABLISHED、等待人工确认，显式 RETEST resolve 才 RESOLVED。保持首次来源、批准事实、回答、分析修订、冻结比较和处理历史。

## 合同、迁移和并发

无 OpenAPI wire shape、DTO、路由、指标、状态机、错误码、query key 或 URL 状态变化。数据库合同只补永久审计语义，无 DDL、新 Alembic revision 或历史回填；现有 head 为 0062_geo_opportunity_decisions。已有合同/generated/迁移文件相对任务初始快照一致，详见 evidence/contract-migration-scope.json。测试空库真实前滚由集成夹具与 E2E 执行。

沿用 User → Catalog → identity advisory → Opportunity 锁顺序、revision CAS、事务 rollback 与现有错误映射。ContentTask/RETEST 使用既有幂等键；规则阈值、fingerprint 和自动解决行为未改。永久 opened 一旦写入，恢复须保留后端动作登记及前端消费者；可停止新评估写入，不能清除历史或移除其安全读取登记。

## 安全、页面与环境

独占本轮 PostgreSQL16（回环55477）、Redis7.4（回环56477；E2E DB14/集成 DB15）、随机有 owner token 的 E2E 数据库、真实 API/分析 Worker、本地文件服务与虚构人工回答。Redis 消息仍仅稳定 ID。无真实外部 AI、生产凭据、Browser Adapter、生产保留或上线。本轮测试结束后，仅移除geo707-validation容器、网络和测试卷；7个使用端口均已释放。各真实栈日志确认owner限定的随机库、Redis键和临时存储清理，详见evidence/validation-cleanup及final-resource-check.json。

已有页面经 UI 操作：产品事实批准、配置/计划/运行、十次截图上传及真实分析、机会确认、人工内容创建/审核/发布、恢复比较/显式解决、不可变历史与安全审计。当前没有创建 UI 的 ContentTask 行动和 RETEST 使用公共 API；没有新增这两种页面。canonical APP_ENV=test 扫描周期为5秒，生产配置默认60秒不变。trace/video 关闭，截图只保留最终安全审计。

机会评估使用702已有内部应用服务，由归属校验后的测试seed显式调用。没有新增评估HTTP入口或生产自动评估调度，也没有启用生产能力。

## 验证与已诊断失败

精确 argv、退出码、耗时及完整输出见 evidence/*.json/log；失败保留，不覆盖为通过。

- 当前基线：make test-unit 后端3658/前端1265通过；行动/复测/比较42项PG通过。
- 新审计消费者和 opened 测试先红后绿：前端23项通过；纵向PG、rollback及702重放/并发/更新13项通过。
- 候选单元：后端3658/前端1266通过；lint、typecheck、contract-check已通过。
- 首轮完整集成：1123通过、2失败。两处旧审计断言未包含 opened，已修正；对应工作台7项通过；随后完整集成结果见下一项。
- 修正后make verify的test-integration目标：1125通过、35条既有SQLAlchemy警告，退出该目标成功；首轮失败继续保留，不覆盖原结果。
- 首轮定向浏览器：生产默认60秒扫描令逐次采样耗尽300秒。测试栈改5秒扫描；首轮运行中修改脚本导致尾段读取偏移、EOF，随后语法检查通过。日志确认其随机数据库、Redis、端口与存储已清理，秘密扫描clean。
- 第二轮：发布表单漏填必填备注，未发送结果请求而等待超时。补填虚构备注，保留既有业务校验。
- 第三轮：已经显式解决，历史断言把临时下载签名/到期时间作为不可变数据。仅排除每次读取生成的 download，继续完整比较证据身份、摘要、来源、回答和分析历史；日志临时下载签名已遮蔽，记录于 evidence/artifact-redaction.json。
- 第四轮：本闭环的审计详情正常，但全局筛选存在其他前序任务未登记动作的隐藏提示。断言收敛到本闭环列表、当前动作和详情；其他动作的既有安全拒绝保留，未扩大本任务补齐范围。
- 第五轮：全部业务、历史和审计页面断言通过后，网络检查记录十个已经返回204的文件PUT产生Chromium空响应结束事件。沿用项目真实上传验收，仅在具体路径收到真实204后登记该事件；文件仍逐项验证VERIFIED、字节数和SHA-256，不允许未知写失败。
- 最终定向707浏览器：e2e-loop-verified-upload退出0，1项通过，秘密扫描clean；随机PG/Redis键/端口/临时存储均清理。
- 首轮make e2e：29项通过、2项失败，秘密扫描clean；canonical失败后GEO三模式和fixture阶段未执行。失败为前序机会用例漏登记706新增comparison GET取消，以及问题用例删除后列表GET取消。仅补具体读取路径/阶段，写响应、权限、持久化和业务断言保持。两个用例各自定向重跑均通过，秘密扫描clean；不把首轮make e2e记为通过。修正后make verify内完整真实栈31项通过，GEO enabled/API-disabled/monitoring-disabled三阶段各1项通过、1项条件跳过，秘密扫描clean。

- 完整make verify：退出2、耗时2060.717秒。contract/lint/type、3658后端+1266前端单元、1125完整PG、十万Run性能、镜像build、31真实栈及GEO三阶段全部通过；页面fixture为497通过/72条件跳过/1失败，因此尚未执行部署脚本和最后Compose检查。
- fixture失败的trace显示1440px视口已生效但工作区仍为窄屏Tab，focus之后布局切换替换编辑器节点。既有测试加入对应宽度的工作区Tab有/无断言及编辑器可见断言，等待可观察的响应式布局；未改生产UI。保留焦点、横向溢出、单次workspace读取和刷新断言。定向两个项目2项通过，秘密扫描clean；诊断见evidence/fixture-focus-diagnosis.json。
- make verify剩余目标续跑（evidence/verify-remaining.json）：退出0、耗时57.356秒。显式复用已通过目标，完成frontend容器、collector/fixture/config、E2E进程与数据库生命周期、secret-artifact、staging/production脚本和两种Compose检查。它不代表再次从头执行全部门禁；原make verify退出2保留。
- 最后测试文件修改后的frontend lint/typecheck均退出0。本轮没有再重复十分钟PG和九分钟性能目标，代码、依赖、配置与对应输入未改变，复用已经通过的证据。

## 最低命令实际结果

本轮COMPOSE使用独占测试配置，URL等环境记录于evidence/validation-environment.json；`make test-integration`的实际argv带同一COMPOSE覆盖。所有精确argv/exit/耗时在对应json，完整输出在同名log。

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| `git diff --check` | 最终差异检查退出0 | `final-diff-check.json/log` |
| `make lint` | 退出0；最后E2E修改另做frontend lint退出0 | `lint`、`final-read-cancellation-static`、`final-fixture-static` |
| `make typecheck` | 退出0；最后E2E修改另做frontend typecheck退出0 | `typecheck`、`final-read-cancellation-static`、`final-fixture-type` |
| `make test-unit` | 退出0，后端3658/前端1266通过；完整verify再次通过 | `unit`、`verify.log` |
| `make test-integration` | 首轮退出2，1123通过/2处旧审计断言失败；修正后verify同一目标1125通过 | `integration`、`workbench-audit-contract`、`verify.log` |
| `npm --prefix frontend run test` | 由make test-unit实际执行，1266通过；verify再次执行通过 | `unit.log`、`verify.log` |
| `npm --prefix frontend run typecheck` | 独立退出0，末次文件修改后再次退出0 | `frontend-typecheck`、`final-fixture-type` |
| `make e2e` | 首轮退出2，29通过/2处旧读取取消断言失败；修正后verify内真实栈31通过、GEO三阶段通过；fixture497通过/72跳过/1布局时序失败，修正后定向2通过 | `e2e`、`verify.log`、`e2e-fixture-focus` |
| `make verify` | 完整命令退出2，原因如上；成功目标复用，焦点修正定向通过后续剩余门禁退出0 | `verify`、`verify-remaining` |
| `make contract-check` | 退出0，FastAPI/generated一致 | `contract`、`verify.log` |
| `make test-geo-performance` | verify目标通过，100000虚构Run，5场景P95为0.150/0.257/0.256/2.883/1.539秒 | `performance-summary.json`、`verify.log` |
| 审计脱敏 / E2E secret scan | 五段审计无正文/原因/凭据；成功及失败浏览器阶段均secret_scan=0，最终定向clean；临时下载签名诊断日志已遮蔽 | `test_geo_opportunity_loop.py`、`geo-loop-real-stack.spec.ts`、`artifact-redaction.json`、对应E2E日志 |

续跑命令保留所有显式旧目标选项：

```sh
make 'COMPOSE=docker compose -f .trellis/tasks/10-04-geo-707-r6-acceptance/evidence/compose.yaml' -o contract-check -o lint -o typecheck -o test-unit -o test-integration -o test-geo-performance -o build -o build-frontend -o e2e verify
```

没有在最后测试断言修改后再次完整执行make e2e或无跳过make verify；测试断言改动不改变应用产物，未改范围的成功结果复用，受影响焦点断言两个项目定向通过。没有真实外部AI、生产数据迁移、生产部署或无关浏览器矩阵；fixture中的72项由real-stack/运行模式条件跳过，真实栈及GEO阶段已另行执行。上述边界不等于未执行检查通过。

## 独立复核和限制

fresh critical_reviewer 独立核对永久审计候选和PG原子性，未发现确认缺陷；明确未覆盖最终浏览器和全门禁。异常测试注入 append_audit 入口，未单独注入实际 AuditLog INSERT/commit 失败；后者的回滚由未变的应用服务事务机制及现有PG边界证据支撑。没有生产迁移、历史回填或真实外部平台覆盖。

全局审计筛选仍可能对其他前序 GEO 动作提示“部分动作筛选项无法安全投影，已从可选项中隐藏”；707 的五段动作列表和详情单独验证，不代表全部历史动作消费者均已补齐。

Task context验证退出0，提示大型OpenAPI/数据库文档的自动注入会截断；本任务另外按相关完整权威单元人工读取，未依据截断注入编码。文档包初始SHA清单已有核心PRD一处漂移，本轮PRD正文未改，保留该前序差异，只更新707实际修改的文档哈希；精确对照见evidence/preexisting-checksum-drift.json。

GEO-901/902 未实施，状态保留。validated子代理Digest已形成，3计划/3交付验收/1独立复核，无异常或活跃Worker；audit-finalize与audit-verify通过，audit_id=20261005T052438Z-geo-707-fec164e9。验证结果和本轮文件范围已定稿；不把原始失败门禁改称退出0。

## 本轮修改文件

以下为相对本任务初始文件快照的增量，保留工作树既有的前序GEO改动。共32个维护文件的增量，完整SHA256见evidence/candidate-changed-files.json；final-scope-check.json确认无计划外维护源变化、未删除初始文件或修改前序PRD。

- `.trellis/tasks/10-04-geo-707-r6-acceptance/check.jsonl`（修改）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/debug.jsonl`（新增）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/design.md`（新增）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/implement.jsonl`（修改）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/implement.md`（新增）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/prd.md`（修改）
- `.trellis/tasks/10-04-geo-707-r6-acceptance/task.json`（修改）
- `backend/app/audit_types.py`（修改）
- `backend/app/services/geo_opportunities.py`（修改）
- `backend/tests/geo_loop_e2e_seed.py`（新增）
- `backend/tests/geo_opportunity_e2e_seed.py`（修改）
- `backend/tests/integration/geo_loop_support.py`（新增）
- `backend/tests/integration/test_geo_opportunities.py`（修改）
- `backend/tests/integration/test_geo_opportunity_loop.py`（新增）
- `backend/tests/integration/test_geo_opportunity_workbench.py`（修改）
- `contracts/database.md`（修改）
- `deploy/scripts/e2e-local.sh`（修改）
- `docs/geo-monitoring/02-business/01-business-architecture.md`（修改）
- `docs/geo-monitoring/03-technical/07-testing-and-quality.md`（修改）
- `docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md`（修改）
- `docs/geo-monitoring/04-delivery/10-r6-opportunity-acceptance.md`（新增）
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`（修改）
- `docs/geo-monitoring/CHANGELOG.md`（修改）
- `docs/geo-monitoring/README.md`（修改）
- `frontend/src/domains/audit/audit.model.test.ts`（修改）
- `frontend/src/domains/audit/audit.model.ts`（修改）
- `frontend/tests/e2e/fact-workspace.spec.ts`（修改，等待断点工作区布局后验证焦点；不改变生产UI）。
- `frontend/tests/e2e/geo-loop-real-stack.spec.ts`（新增）
- `frontend/tests/e2e/geo-loop-support.ts`（新增）
- `frontend/tests/e2e/opportunities-real-stack.spec.ts`（修改，补706比较GET主动取消的精确路径）。
- `frontend/tests/e2e/questions-real-stack.spec.ts`（修改，补删除后列表GET主动取消的两个具体阶段）。
- `docs/geo-monitoring/SHA256SUMS`（仅更新本轮6条和新增R6报告；保留前序PRD漂移）。

## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-707 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；完整make verify退出2、受影响用例定向通过和剩余门禁续跑退出0的证据不改写。本次只记录人工验收，不重新实现或重复运行功能门禁。

本次仅收尾GEO-707，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
