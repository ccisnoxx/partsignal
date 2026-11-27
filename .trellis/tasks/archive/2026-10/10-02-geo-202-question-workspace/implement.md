# GEO-202 实施与验证记录

## 1. 交付状态与实现摘要

2026-10-02，分支 `geo/GEO-202`，发布阶段 R1。直接依赖 GEO-201 已人工接受为 `done`；读取用户列出的全部文档、根/前端 AGENTS、相关 Trellis 规范、GEO-201 记录和当前权威合同后输出了完整十二项 preflight。GEO-202 按 `planned → in_progress → review` 交付，未自行 `done`，未提交、推送、创建 PR 或部署。其他任务状态保持初始值。

已实现 ADMIN/ENGINEER 的问题变体 CRUD、启停、过滤分页、详情和复制新变体工作区；运行入口明确为不可用。后端单元、前端、PostgreSQL 集成和本任务真实 API E2E 通过。全仓真实栈和 fixture E2E 各保留一项前序 GEO-106 已记录的既有失败，不能宣称完整 E2E 门禁通过。

## 2. 修改文件与共享工作树

源文件与文档逐项清单见 [changed-files.json](./evidence/changed-files.json)，任务开始时全部文件指纹见 [initial-files.json](./evidence/initial-files.json)，本任务增量见 [incremental.diff](./evidence/incremental.diff)。仓库进入任务前已有前序 GEO 修改；增量以任务初始指纹/原文比较，不把全部 `git diff` 归为 GEO-202。

- 后端：新建 `services/geo_prompt_variants.py`、`services/geo_prompt_variant_queries.py`、`routers/geo_questions.py`；扩展 `schemas/geo_prompt_variants.py`、注册 router、审计 action/target 及业务关联。
- 前端：新建 `domains/geo-questions/` 十一个源码/测试文件及 `routes/_app/geo/questions.tsx`；更新导航、自动生成路由、generated OpenAPI 类型、审计标签与问题库跳转。
- 验证：新建后端 API/事务/错误测试和集成支持文件；维护严格合同/runtime metadata 测试；新建 `questions-real-stack.spec.ts`，加入真实栈默认入口与 E2E 隔离规范。
- 权威文档：OpenAPI、数据库服务合同、API/前端架构当前实现章节、README、CHANGELOG、manifest、SHA256SUMS；本 Task Brief/design/implement/evidence。

未删除初始文件。身份服务、主题服务、0045 迁移及两项失败的既有 E2E 文件均与初始 SHA-256 相同。缺少的共享初始原文只在逆向移除本任务增量后与初始 SHA-256 逐字匹配时才保存；最终所有修改的既有文件都有原文可比。

## 3. OpenAPI 与数据库合同

公共权威仍为 `contracts/openapi.yaml`，新增七个操作：

| 方法 | `/api/v1` 下路径 | 行为 |
| --- | --- | --- |
| GET | `/geo/prompt-variants` | 列表、过滤、稳定分页 |
| POST | `/geo/query-topics/{query_topic_id}/prompt-variants` | 创建，body/path 主题必须一致 |
| GET | `/geo/prompt-variants/{variant_id}` | 单个详情及当前主题摘要 |
| PATCH | `/geo/prompt-variants/{variant_id}` | 显式更新字段、expected_revision |
| DELETE | `/geo/prompt-variants/{variant_id}` | expected_revision query、成功 204 |
| POST | `/geo/prompt-variants/{variant_id}/enable` | 显式启用 |
| POST | `/geo/prompt-variants/{variant_id}/disable` | 显式停用 |

扩展 closed Out/ListPage：当前 QueryTopic 摘要、ACTIVE/DISABLED/REFERENCED、primary_task、available_actions、HISTORY_REFERENCE 删除条件及 `run_entry.available=false/reason_code=NOT_IMPLEMENTED`。没有运行写入端点。前端只消费生成的公共协议类型，不维护另一套业务状态机。

列表支持 q、主题、intent、点名属性、语言、地区、优先级、启停、UPDATED_DESC/TEXT_ASC、page、page_size=10/20/50。q 最长240、拒绝 NUL；NFKC/Unicode 空白规范化后字面匹配实际问题和当前主题问题，保留大小写/型号，转义 LIKE 通配符，以 UUID 稳定打破并列。

数据库无表/列/约束/索引变更。`contracts/database.md` 只同步服务事务、锁、错误、历史和最小审计合同。当前主题摘要明确不是历史回答快照。

## 4. Alembic、前滚与数据迁移

无 GEO-202 Alembic revision；head 仍 `0045_geo_prompt_variants`。在专用空 PostgreSQL 实例执行 `alembic upgrade head` 和 `alembic current`，真实前滚0001→0045成功，见 [alembic-upgrade.log](./evidence/alembic-upgrade.log)。0045源码与初始指纹一致，无新回填，无旧 QueryTopic.variants 数组导入，无生产数据库操作。沿用 GEO-201 的不可破坏历史表安全停止/前向恢复合同，不新增降级路径。

## 5. 关键业务不变量

PromptVariant 的 Application Service 是业务变更权威，Router 只处理 HTTP/依赖并调用服务，不持有事务、行锁或 ORM 写入。PostgreSQL 是唯一业务状态来源，本切片不发队列消息。

mention_mode 必须显式提供 BRANDED/UNBRANDED，表单无默认猜测；即使文本包含 PartSignal 仍可显式选择 UNBRANDED。语言、地区、优先级同样显式，服务端规范化并维护语义唯一键。主题绑定不可修改，created_by 来自锁后权威身份。

首次引用锁存沿用 GEO-201，历史语义不可改、不可重新启用、不可删除；只能停用，复制新语义创建新身份。数据库历史约束与应用门禁共同维护；测试用 SQL 锁存历史标记，不创建回答级 Run。服务端投影决定 UI 动作与删除条件。运行占位不会创建 Batch/Run、外部采集或指标。

完整 AC-TOPIC-02 的“至少一个活动变体”的使用门禁属于后续计划/运行能力；当前允许配置空主题和停用最后变体。本任务只验收其变体配置部分，不宣称完成总体 AC-TOPIC-02。

## 6. 事务、锁、revision、并发与错误

命令锁序为 User → QueryTopic → PromptVariant。User 使用 PostgreSQL FOR NO KEY UPDATE（SQLAlchemy 已安装版本 `.with_for_update(key_share=True)`），阻止资格更新/删除，兼容审计 actor 外键 KEY SHARE；Topic/Variant 使用 FOR UPDATE。锁后重新加载用户权限、临时密码要求、主题归属与 revision。创建锁父主题避免与主题删除形成孤儿；唯一约束仲裁并发创建，revision CAS 使并发修改仅一方成功。

独立只读复核确认两个 P1 锁环：同账号旧主题命令的 Topic→审计actor FK 与新命令 User→Topic；同 Cookie 改密的 Session→User 与认证活动提示自动 flush 形成 User→Session。三个真实 PostgreSQL 用例修前均出现 DeadlockDetected；修正 User 锁和命令入口舍弃同actor pending Session.last_seen_at 后13项定向集成通过。只舍弃不参与过期/撤销安全裁决的活动提示，不改变 expires_at、revoked_at、认证或 CSRF。修前证据：[same-actor-before.log](./evidence/same-actor-before.log)、[same-cookie-before.log](./evidence/same-cookie-before.log)。

有效变化 revision 加一；规范化后的 no-op 不改变 revision、updated_at 或成功审计。启停的相同状态请求也保持 no-op；重复创建返回409，成功删除后再读为404，不提供假幂等成功。没有自动重放、隐藏重试或未知错误降级。

业务写入和五类白名单成功审计同事务。审计失败回滚业务；仅精确 SQLSTATE+constraint 映射重复语义与历史锁，未知数据库错误显式失败。revision冲突409、历史编辑/重启409、历史删除409、资源消失404、body/path不一致422；身份/CSRF错误沿用标准401/403/422。

读取在认证前建立 REPEATABLE READ 并关闭 autoflush。详情单join，列表count/page同快照；完整列表请求固定3条SQL（认证关联查询、count、page），无逐项查询。跨事务读取稳定性、rollback/no-op、同账号/同Cookie交错均已在真实PG验证。

## 7. 安全、隐私、外部调用与敏感信息

沿用现有全局配置资源归属：ADMIN/ENGINEER 可管理，用户主体必须有效且完成临时密码修改；没有引入租户或第二身份系统。所有写操作使用现有会话与 CSRF，服务端资格重读，不依赖前端隐藏按钮。非法 revision、未知字段、路径/body不一致、维度与文本输入均按权威边界校验。

审计仅保存稳定目标ID、revision、is_active、动作/请求上下文，不保存问题正文或凭据。无真实外部 AI 调用；E2E 使用 fake AI/本地OSS，未放宽生产TLS、SSRF、凭据、CSRF、历史或审计合同。三次真实栈及 fixture 的 secret scanner 均执行；最终 targeted/full real/full fixture为 clean。首次新增E2E错误上下文曾包含测试seed默认值，已改为环境配置，不放宽scanner。

## 8. 前端路由、URL、query key 与页面状态

新增 `/geo/questions` 问题库，保留 `/geo/topics`。URL规范化恢复 q/维度/排序/分页及 selected/new/copy；不将草稿内容写入URL或query cache。`questionKeys` 为唯一cache owner：`['geo','questions','list',params]`、`['geo','questions','detail',id]`。

主题选择显示业务名称；详情Sheet展示完整提问、显式维度、revision、历史/动作/删除条件。创建/编辑、启停/删除确认、复制新身份、空/筛选空、加载、错误、重试、真实404/不可访问和完成反馈均有可达状态。运行按钮禁用并显示 NOT_IMPLEMENTED。

RHF草稿基线独立于后台query；后台成功/失败与409均保留本地输入。显式reload只合并revision，用户核对后再次提交，不自动重放。principal epoch、卸载和dirty守卫防止旧响应写回、无效导航及草稿丢失；同资源编辑动作不会重挂表单。删除成功清理选中/缓存，不再GET已删除详情。

最终自查补齐主题/点名/优先级三个Select的 aria-required，组件测试直接观察屏幕阅读器必填合同。真实E2E已检查375/768/1024/1440无根级横向溢出；截图见 [questions-real-api.png](./evidence/questions-real-api.png)。最终无障碍小修由主代理完成，worker执行记录不作为该修改的证据；修后组件10项、完整前端940项、lint/typecheck通过。

## 9. 实际运行的命令与结果

最低要求八项全部执行，未将未执行的步骤写为通过。日志都在 evidence 中，完整结构化结果见 [validation-results.json](./evidence/validation-results.json)。

| 命令 | 最终证据与结果 |
| --- | --- |
| `git diff --check` | 0，无格式错误；最终日志 git-diff-check-final.log |
| `make lint` | 0，Ruff + ESLint；make-lint-candidate.log。首次新SQL行过长已分行修复，失败日志保留 |
| `make typecheck` | 0，后端95文件 + 前端；make-typecheck-final.log |
| `make test-unit` | 0，后端987 + 前端940；make-test-unit.log。最后仅Select a11y修改，修后前端完整940再次通过，后端未变复用证据 |
| `make test-integration` | 0，495 passed、4项既有metadata warning；make-test-integration-final.log |
| `npm --prefix frontend run test` | 0，99文件940 passed；frontend-test-final.log |
| `npm --prefix frontend run typecheck` | 0，frontend-typecheck-final.log；最终make typecheck也执行同一命令通过 |
| `make e2e` | 2，真实栈22 passed/1既有上传断言failed，Questions通过；make-e2e.log。make因真实栈失败未进入后续fixture recipe，已单独补跑 |

`make test-integration` 以 COMPOSE override 指向任务专用 `evidence/compose-validation.yaml`，日志首行保存展开后的准确命令；相同目标/真实全部集成，非mock替代。PostgreSQL16/Redis7.4与fake OSS只用于本地专用栈，宿主PG127.0.0.1:55441、Redis127.0.0.1:56381；集成Redis DB15，真实E2E DB14及唯一临时数据库/存储，环境配置见该文件（仅测试假值）。

额外已执行：

| 命令/边界 | 结果与日志 |
| --- | --- |
| `make contract-generate` | 0，生成类型；contract-generate.log |
| `make contract-check` | 0，183个runtime操作完整一致、generated无漂移；contract-check-final.log |
| 后端本任务/严格合同定向unit | 426 passed；targeted-contract-final.log |
| 新API/事务集成两文件 | 13 passed；targeted-api-final.log |
| `npm --prefix frontend run test -- src/domains/audit/audit.model.test.ts` | 16 passed；targeted-audit-final.log |
| `npm --prefix frontend run test -- src/domains/geo-questions/questions-page.test.tsx` | 最终10 passed；a11y-component-final.log |
| `PARTSIGNAL_E2E_SPEC=tests/e2e/questions-real-stack.spec.ts deploy/scripts/e2e-local.sh` | 0，1 passed、secret clean、四类cleanup成功；questions-e2e-final.log |
| `npm --prefix frontend run e2e` | 1，497 passed/48 skipped/1既有焦点失败、secret clean；fixture-e2e.log |
| `alembic upgrade head` / `alembic current`（专用空DB） | 0，head=0045；alembic-upgrade.log |
| 文档SHA256全条目核对 | 114项均匹配；documentation-hashes.json |
| multi-agent audit-finalize / audit-verify | 通过，14个审计artifact、零异常；验证digest见下节 |

当前基线：后端相关unit103、PG15、相邻前端9通过，见 baseline-unit/postgresql/frontend.log；PG基线已有2项metadata warnings。首次新E2E定位器同时匹配搜索框与文本框，已加exact；新spec初期取消请求漏登记已修复，仅登记精确资源/阶段/方法ERR_ABORTED且另有成功响应或持久化结果。未知请求失败继续阻断，无通配容错。

## 10. 未执行项与失败分类

用户最低八项无未运行项。完整 `make e2e` 未顺序进入fixture阶段，但相同fixture命令已独立执行，真实结果如上。两个完整套件失败均与GEO-106原记录相同，失败文件SHA-256与本任务初始值一致：

- `frontend/tests/e2e/geo-real-stack.spec.ts` 既有Flow A 上传字节断言：helper第292行postDataBuffer返回null，调用处367。22个其他真实用例通过，包含本任务问题库；未确认上传实现深层根因，不扩大修改范围。
- `frontend/tests/e2e/fact-workspace.spec.ts:43` 既有桌面Markdown编辑器focus断言仍inactive；497通过。48跳过为真实栈spec在fixture模式按环境显式跳过，Questions已在真实栈执行两次成功，不能将跳过记为通过。

未运行 `make verify`、生产部署门禁或真实外部平台：本任务未修改Makefile targets/部署配置，没有新的整体发布范围；make verify会重复已执行项并增加无关镜像/部署脚本门禁，且其E2E已明确失败。未执行未来Batch/Run、计划、指标、机会或外部采集测试，这些能力未实现。

专门的用户删除并发用例未新增/执行；该边界主要由独立复核的锁/FK/既有删除集成证据覆盖。后端独立复核不覆盖前端/E2E或未来Run；前端由主代理实际源码/差异、组件及真实E2E检查。最后aria-required修正之后未重跑真实栈，已由直接组件观测、完整前端测试和静态检查验证。

## 11. Task Brief、状态与可审计证据

[prd.md](./prd.md) 按19节模板，配套 [design.md](./design.md)、本记录、task.json；`.trellis/.current-task` 保持本任务，状态review，等待人工接受，不归档。manifest新增本Task关联与真实验证说明；初始manifest对比只有GEO-202状态planned→review，GEO-201保持done、GEO-206保持planned。文档包SHA256只维护实际修改条目，114条全核对一致。

分工审计id：`20261002T131356Z-geo-202-071a4d6c`。frontend implementer与fresh critical_reviewer均验收通过；reviewer只读且未写文件。审计已关闭，digest校验通过，零活跃Worker、零ready未执行任务、零异常。独立后端复核最终无未解决确认finding，服务复核SHA-256见 [independent-review.md](./evidence/independent-review.md)；worker交付见 [frontend-delivery.md](./evidence/frontend-delivery.md)。下面直接复用工具生成摘要，不从runtime状态推测验收或统计。

### 子任务执行概览

| `agent_type` | 模型（Agent TOML） | 推理档位 | 执行尝试 | 验收通过 | 独立复核 |
|---|---|---|---:|---:|---:|
| `critical_reviewer` | `gpt-6.1-sol` | `xhigh` | 1 | 1 | 1 |
| `implementer` | `gpt-6.1-sol` | `xhigh` | 1 | 1 | 0 |

计划校验：2/2 通过；执行尝试：2/2 验收通过；独立复核：1；fresh 派发：2；Worker 复用：0；隔离上下文派发：2；父代理 follow-up：5；Worker 中途消息：5；等待调用/超时：1/1；状态轮询：1；未执行 ready task：0；残留活跃 Worker：0；写入观测：1 有写入、1 无写入、0 未知。

**异常：** 无。

模型和推理档位来自 Agent TOML 的固定配置快照，属于配置证据，不表示运行时接口已单独回报并验证这些值。
验收通过仅按执行记录中的 `task_outcome=accepted` 统计；`final_status` 只表示 Worker 运行时状态。

## 12. 环境清理与已知限制

E2E临时数据库删除、Redis DB14清理、8000/9001/4174/19009端口释放、临时存储删除均由脚本确认。专用Compose down --volumes成功；docker ps无残余容器；Colima stop成功恢复任务初始停止态，日志 cleanup-compose/remaining-containers/cleanup-colima.log。不清理其他任务资源，不改用户原有工作树。

交付可供review，完整E2E门禁仍有两项既有失败。无运行执行、回答历史实体、计划、评估、导出或指标；旧variants数组不自动导入。当前详情主题摘要只表示当前配置，历史回答快照要由后续Run实现。至少一个活动变体的使用门禁尚未实施；不向用户假装运行成功或完整AC-TOPIC-02已完成。

## 13. 后续任务（未实施）

GEO-206 实施计划能力；GEO-301/303 在其获准范围内建立真实Run引用、首次锁存和不可变快照，复用当前变体资格/锁合同。完整套件上传/编辑器焦点失败可在明确授权的独立修复任务定位。其他任务状态不因本次交付改变。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-202 的实现与测试证据。”据此仅将 manifest 的 GEO-202 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

以上实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果及已知限制，不将既有 E2E 失败或未运行检查改写为通过。本次只记录 GEO-202 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
