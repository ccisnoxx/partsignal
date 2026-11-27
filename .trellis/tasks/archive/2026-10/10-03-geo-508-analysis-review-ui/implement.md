# GEO-508 实施与验证记录

## 交付范围

详情展示原文、机器四栏结果、声明事实依据、当前有效投影及只读分析/复核历史。结构化人工复核保持既有 API；严重 INCORRECT HIGH/CRITICAL 声明逐项核对、填写说明及明确选择结论后才发写请求。复核草稿只保存在内存。

原文/引用/机器分析与既有历史不改写；CONFIRMED 确认风险判断，不将错误回答伪装为正确。CORRECTED 追加复核，最新完整载荷替换上一条人工覆盖。新分析 supersede 使旧复核失效的行为由既有服务端维护。

## 合同、事务和数据

OpenAPI、generated schema、database.md 和 Alembic 未改变；当前 head 为 0056_geo_run_review。无需新增 revision、数据回填或破坏性迁移。测试隔离数据库从空库前滚到当前 head；成功及资源清理见真实栈日志。

GEO-507 Application Service 的 RC、User→Batch→Run→Analysis 锁顺序、current-analysis 校验、expected_run_revision 乐观并发、append-only review、run revision 增量、batch 投影与审计原子提交保持。409 GEO_REVIEW_STALE_ANALYSIS/REVISION_CONFLICT 和 422 原样显示。前端冻结起点，显式读取并重新核对；未知结果只读历史，禁止重放不具备幂等保证的 review。

## 安全与页面状态

服务端 available_actions 唯一决定复核入口；沿用 Cookie/CSRF、角色/主体边界。主体 epoch、卸载和同步重复提交保护防止迟到 continuation 污染新主体。未知外部产品事实保留失败或 UNJUDGEABLE。回答作为文本渲染，Unicode 位置按 codepoint 读取。日志/产物沿用 secret scanner，不记录凭据或对象存储 capability。测试仅虚构输入、本地服务，无真实 AI 调用。

沿用 /geo/runs 的 run_id/edit/batch_id URL 和 geo/runs query keys。单 detail 包含机器、有效结果及历史；成功取消旧读取并使 canonical root 失效；COLLECTED/ANALYZING 等执行状态轮询。提供加载、空、错误、权限、冻结、未知、dirty 导航、焦点/键盘与窄屏表现。

## 验证证据

逐项 argv、退出码及完整日志保存在 evidence/*.json 与 *.log。分析器金标 270 项已通过，复核 PG 基线 26 项及新增 R4 严重错误验收 1 项已通过。最终候选在 make verify 中已通过 make lint、make typecheck 和 make test-unit（backend 3341 项 + frontend 124 文件/1170 项）；此前 npm 全量命令也已通过，后续回执修订由28项定向和最终1170项覆盖。真实复核定向 E2E 1 项及 R4→plans 组合2项通过。最终 make e2e 与 verify 续跑已收敛，详见末节最终命令表和复用说明。

首轮基线 E2E 缺 DATABASE_URL（启动前失败）；随后使用任务独占的 PostgreSQL/Redis/对象存储完成原人工流程基线。测试代码首轮类型错误与三处 Python 长行已定位修正；保留原失败和后续验证结果。

## 任务状态与边界

manifest planned→in_progress→review；task.json同步review，completedAt保持null，等待人工接受，主代理不标done。Task Brief、设计、基线快照、任务 diff、金标 JUnit/哈希及独立复核审计归档到本目录。未提交、发布或修改生产数据。

GEO-601 指标资格/汇总、后续洞察/Opportunity、Browser Collector、公共 reanalyze 均留待后续任务；当前 metric_eligible 未计算时保持 null/NOT_IMPLEMENTED。分析器质量及覆盖边界详见 docs/geo-monitoring/04-delivery/09-r4-analysis-acceptance.md。

验证环境：任务专属 Compose project partsignal-geo508-validation；PG 127.0.0.1:55468，Redis 127.0.0.1:56408。基线 E2E 使用 DB 15；最终 E2E 独占 DB 14、integration 使用 DB 15，GEO_RECOVERY_SCAN_SECONDS=5（允许的最小恢复间隔）。确切环境保存在 evidence/validation-env.sh 和 validation-compose.yaml；make verify 的 COMPOSE 命令行覆盖只改变本地验证隔离，不改部署配置。

## 独立复核修订

首轮 critical_reviewer 确认 P2：旧回执仅检查 correction_payload 非 undefined，CORRECTED null/17 可能错误关闭草稿。主代理在 runs.api 的信任边界加上 comment 合同与请求相等、correction_payload 完整结构相等；服务端原样保存已验证请求，因此复用已安装 replaceEqualDeep 不复制四栏 DTO 或业务状态机。追加 API/组件语义负例，27 项定向通过；畸形回执保留 unknown、草稿与 journal，不显示成功或重发。第二个 fresh critical_reviewer 复核确认旧缺口已解除，另指出 Unicode 长度口径问题；按建议改为 codepoint 并添加 2000 emoji 成功例，定向 28 项通过。最后这一小修按明确审查建议完成，未声称第三次独立复核。

首轮 make e2e 返回非零：25 项通过，新增原生刷新保护测试在取消导航后继续等待 reload 完成导致测试超时，计划真实流程另有超时。前者已改用 Playwright 文档定义的 runBeforeUnload 原生离开且显式取消，不等待不可能完成的导航；最新定向真实 R4 E2E 1 项通过并完整清理。第二轮完整重跑新增 R4 流程通过，既有 plans 流程仍失败；原因、修订及组合通过证据见下文。两个非零 make e2e 结果均保留，不将其改写为通过。

既有 manual-submit 回执的 analysis_dispatch 枚举仍为 NOT_IMPLEMENTED（合同沿用早期字段）；实际采集后由已接受分析恢复扫描执行，页面跟随 canonical detail 的分析进度。GEO-508 不改变这一既有公共字段。

## E2E 共库隔离修订

第二轮完整 E2E 的 R4 新流程通过，但既有 plans flow 仍超时。已定位：plans-real-stack.spec.ts 在 375px 检查“暂无监测计划”布局，依赖全库为空；新 R4 flow 先创建自己的计划，canonical suite 同轮共库使此假设失效。测试改为按自身唯一 suffix 筛选，并使用服务端筛选空态“未找到匹配计划”；保留移动端 bounds/overflow 和后续生命周期断言，未改 plans 运行时。组合 R4→plans 真实 E2E 2 项/19.4秒通过，数据库、Redis、端口、存储全部精确清理。首个组合重跑在筛选后仍用旧空态标题失败；精确标题修正后通过，不进行无依据重试。

审计 Bundle 20261004T034920Z-geo-508-79651e93 已关闭并 audit-verify=passed；SUBAGENT_EXECUTION_DIGEST JSON/Markdown 在 evidence。5次执行，4次任务验收通过，2次独立只读复核；1次 implementer role_mismatch 未写入，随后 deep_engineer 完成；残留 active Worker=0。角色/模型证据只来自 Agent TOML，不代表运行时模型确认。

## R4 后的重复消息验收前置条件

首轮 make verify 的 contract/lint/typecheck、3341后端unit/1170前端Vitest、973 PG集成、前后端构建及canonical 27真实E2E均通过；随后GEO enabled失败：duplicate测试CLI仍要求COLLECTED，而R4页面已等待COMPLETED。已读取完整测试装配和唯一调用者，改为只允许COMPLETED；独占环境/实际DB归属、虚构输入/精确回环、broker late-ack/两条SUCCESS回执与30秒截止保持，生产服务无变化。新的定向enabled E2E 1项通过（1项相斥mode按设计skip），重复消息后provider保持1次且Run无变化；测试装配unit30项及Ruff通过。初次verify非零保留，最终完整命令另行记录。

## 最终命令与结果

| 用户指定命令 | 实际结果与最终候选证据 |
|---|---|
| git diff --check | 退出0（diff-check-final.json）；任务前像生成的33文件diff及空白检查通过 |
| make lint | 独立命令退出0；最新候选在verify续跑内再次执行Ruff/ESLint退出0 |
| make typecheck | 独立命令退出0；最新候选verify内mypy/前端tsc再次退出0 |
| make test-unit | 独立命令退出0；最新候选verify同目标后端3341、前端124文件1170项通过 |
| npm --prefix frontend run test | 独立命令退出0；最新候选verify内实际同命令1170项通过 |
| npm --prefix frontend run typecheck | 独立命令退出0；最新候选verify内实际同命令退出0 |
| make e2e | 最终make-e2e-candidate.json退出0：canonical27，GEO三mode各1，UI498通过/60模式专属skip；三mode另各有1个相斥skip，敏感扫描通过 |
| make verify | 首轮无参数退出2（GEO duplicate旧COLLECTED测试前置）；修复后全E2E退出0，verify续跑退出0，精确命令如下 |

```sh
make verify -o contract-check -o test-integration -o build-frontend -o e2e 'COMPOSE=docker compose -p partsignal-geo508-validation -f .trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/validation-compose.yaml'
```

`-o`复用已经实际通过且相关输入未变化的目标：合同检查、973项PG集成、前端Docker构建，以及修订后完整make e2e。首轮全门禁输出make-verify.log证明上述前置通过，make-e2e-candidate.log证明最终E2E通过。不是把未执行检查记为通过，也不声称最后再次无参数重跑所有前置。后续唯一后端修订是tests/geo_e2e_runtime.py，integration没有此模块调用，服务/迁移/集成用例/依赖/验证环境未变；测试装配定向unit30与真实enabled流程已通过。后端Docker COPY包括测试入口，所以本次后端镜像重新构建，只有前端构建复用。

续跑实际执行最新lint/typecheck/test-unit、后端build、前端容器fallback/cache/source-map、collector契约194项、fixture/配置门禁、E2E进程与DB生命周期、敏感产物、staging/production部署脚本自检、development/production Compose config，全部退出0。详细复用理由见evidence/validation-reuse.json；命令和原始结果见validation-summary.json与对应JSON/log。

所有指定命令均已实际执行。没有再次执行无参数verify所有前置，原因是复用有效通过证据。未操作生产环境、未使用真实AI平台；金标没有未批准的precision/recall/F1阈值，因此不报告推断的百分比分数。最终Unicode单行与测试入口前置小修未新增独立复核，已自查、定向及完整相关门禁验证，独立审查覆盖详见independent-review.md。

## 交付状态

GEO-508 manifest/task.json均review；GEO-507保持done，其他任务状态未变。33个维护文件完整清单和任务前像diff见evidence/changed-files.json、task-only.diff；既有3218个任务前文件没有缺失，253个合同/generated/后端运行时/迁移文件与前像一致，9个金标输入哈希一致。任务专属Compose测试栈已停止并移除容器/网络，infra-stop.json退出0；未删除数据卷或操作其他服务。R4质量报告位于docs/geo-monitoring/04-delivery/09-r4-analysis-acceptance.md，等待人工验收。

### 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-508 的实现与测试证据。”据此将 manifest 的 GEO-508 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录；既有测试结果、verify 续跑/复用说明、独立复核范围和验证限制不作改写。本次只记录 GEO-508 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。收尾运行 git diff --check，实际结果在本次最终回复报告。
