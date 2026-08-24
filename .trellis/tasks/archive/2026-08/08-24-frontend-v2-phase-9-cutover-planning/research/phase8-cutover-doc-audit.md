# Research: Phase 8 归档、Exit Gate 与 Cutover 文档审计

- Query: 核查 Frontend V2 Phase 8 父/子任务是否全部归档，验证 `docs/frontend-v2/07` 与 `08` 的 Phase 8 Exit Gate 证据，并盘点仓库内 staging、production、cutover、rollback、monitoring 文档及 Phase 9/Cutover Gate 缺口。
- Scope: internal
- Date: 2026-08-24

## Findings

### 1. Phase 8 父任务与全部子任务已归档

父任务位于 `.trellis/tasks/archive/2026-08/08-23-frontend-v2-phase-8-workbench-planning/`，`task.json` 为 `completed`，完成日期为 `2026-08-24`（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-phase-8-workbench-planning/task.json:2-6,13-14`）。父任务登记了 13 个 child（同文件 `:21-34`），当前归档目录中按 `parent` 反查得到的集合与该清单完全一致，没有漏项或额外未登记 child。

| 归档子任务 | 状态证据 | 父关系证据 |
| --- | --- | --- |
| `frontend-v2-workbench-aggregate-read-model` | `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-aggregate-read-model/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-workbench-ui` | `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-ui/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-workbench-e2e` | `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-e2e/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-workbench-abstraction-review` | `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-workbench-root-fixture-convergence-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-auth-workbench-request-cancellation-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-auth-workbench-request-cancellation-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-exit-gate-recheck` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-recheck/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-final-verify-environment-isolation-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-final-verify-environment-isolation-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-settings-failure-output-safety-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-settings-failure-output-safety-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-exit-gate-final-recheck` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-final-recheck/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-v1-mvp-flow-delete-selector-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-v1-mvp-flow-delete-selector-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-celery-lifecycle-output-safety-blocker` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-celery-lifecycle-output-safety-blocker/task.json:3-6,14` | 同文件 `:22` |
| `frontend-v2-phase-8-exit-gate-post-blocker-recheck` | `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-post-blocker-recheck/task.json:3-6,14` | 同文件 `:22` |

最终 recheck 自身记录：固定候选 `3c93e8b2…`、A25–A30 全部关闭、九个独立阶段 `9/9 exit 0`、唯一一次 `make verify` exit `0`、cleanup 完整、结果 `MET`（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-post-blocker-recheck/task.json:35-67`）。实施记录进一步给出各套件结果、两轮 cleanup 与敏感输出审查边界（同任务 `implement.md:180-194`）。

### 2. `07` 与 `08` 的 Phase 8 Exit Gate 均明确为 `MET`

- `docs/frontend-v2/07-migration-plan.md:500-506` 定义 Phase 8 目标和退出条件；`:508-512` 记录固定候选、九个独立阶段、唯一最终 `make verify`、两轮隔离/cleanup、A25–A30 closed、open P0/P1/P2=`0/0/0`，最终 `Phase 8 Exit Gate=MET`。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:394-406` 独立记录相同候选、阶段耗时、测试计数、Redis DB 隔离、cleanup、安全输出 owner 和最终 `MET`。
- 两处证据相互一致：候选 SHA、最终耗时 `1180.905s`、backend unit `204`、V1 Vitest `205`、V2 Vitest `463`、integration `120`、V2 real-stack `16`、V1 E2E `52`、V2 fixture `383 passed / 33 skipped / 0 failed` 均一致（`07:508-512`；`08:396-404`）。
- 文档存在一处已过时的生命周期陈述：`07:512` 和 `08:406` 都写“Phase 8 父任务未归档”，但父任务现已实际位于 archive 且 `status=completed`。这不影响 Gate=`MET`，但 Phase 9 规划文档应以当前归档事实修正该句，避免把历史收尾状态当成当前状态。

### 3. 现有 Phase 9 与 Cutover Gate 合同

- `docs/frontend-v2/07-migration-plan.md:514-524` 规定七个独立 Task：staging 接入、production-like rehearsal、redirect/deep-link、production artifact/静态资源发布、回滚演练、正式切换/观察、最后删除 V1 pipeline 与 `frontend/`。
- `docs/frontend-v2/07-migration-plan.md:526-543` 定义删除/停用 V1 前的 Cutover Gate：核心 E2E、四档响应式、可访问性、权限/服务端重验/revision conflict、production artifact smoke、关键 deep link、chunk/API/fallback/cache/CSP/source map、redirect map、合同/部署脚本、staging rehearsal、rollback，以及 V1 删除必须最后且独立。
- `docs/frontend-v2/07-migration-plan.md:545-566` 提供 V1→V2 顶层路由矩阵，但多数是概念映射；尚未成为逐路由、逐参数、逐 query、逐权限和错误 fallback 的可执行 redirect manifest。
- `docs/frontend-v2/07-migration-plan.md:596-602` 明确 release/cutover 需要完整 `make verify`，且部署脚本测试不包含在其中，必须另跑 `make test-deploy-scripts`。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:408-412` 定义 deployment smoke 路由与 JS chunk、API base URL、SPA fallback、deep link、asset cache、CSP/source map 检查；`:426-428` 给出前端错误观测字段和敏感信息禁记要求。
- `docs/frontend-v2/09-architecture-decisions.md:301-318` 确认 V2 `/` 唯一消费 `/api/v1/workbench`，V1 dashboard 保持到 Phase 9，不得成为 V2 fallback 或第二数据源。这意味着 cutover/rollback 应切换完整前端 release，不应在 V2 页面内加 V1 业务 fallback。

### 4. 仓库内现有 staging / production / rollback / monitoring 文档

| 文件 | 当前用途与证据 |
| --- | --- |
| `docs/operations.md` | 跨环境稳定原则；明确 deploy 事实源、不可覆盖 release、失败保留现场和清理独立授权（`:3-10`）；安全头/CSP/HSTS owner（`:12-17`）；备份与应用/Nginx 回滚边界（`:46-54`）；浏览器验收不能被健康探针替代（`:56-60`）。 |
| `docs/Hostdzire部署上线流程.md` | 自称 `https://geo.962850.xyz` **预发布环境**主 Runbook（`:1-3`）；列明 staging Compose/Nginx/deploy owner（`:20-25`）、共享 `.env.staging` 与 Compose 项目（`:25-46`）、停止条件（`:48-62`）、快速/完整发布入口（`:64-103`）、验收（`:105-118`）和应用/数据库/Nginx 回滚摘要（`:129-137`）。 |
| `docs/Hostdzire部署附录.md` | Hostdzire 预发布首次初始化、完整手工发布、恢复、Nginx、浏览器验收和排障的低频事实源（`:1-35`）；完整发布和隔离恢复验证（`:185-323`）；公网/缓存/安全头/浏览器验收与 `current` 语义（`:362-446`）；应用和数据库恢复边界（`:448-486`）。 |
| `docs/deployed-full-functional-acceptance-plan.md` | 已部署环境业务验收计划，目标写为 `https://geo.962850.xyz`（`:1-32`）；明确不使用真实业务数据/真实账号、不做真实外部发布（`:34-41`）；新建 `E2E-ACCEPT-<run-id>` 测试对象、不得修改历史真实记录（`:532-552`）；停止条件和退出标准（`:591-609,649-681`）。它会写入隔离的测试业务数据，不是只读 rehearsal。 |
| `docs/GEO系统前后端技术与部署方案.md` | 记录旧/总体部署设计：Nginx/API/SPA fallback 结构（`:718-783`）、前端软链接式切换与旧版本保留（`:801-818`）、后端发布/回滚原则（`:820-855`）、健康/日志字段（`:891-925`）、MVP 监控指标清单（`:927-941`）。其中“当前域名问题”等现场陈述（`:788-799`）可能早于现行 Hostdzire Runbook，不能作为 2026-08-24 实际环境事实。 |
| `.trellis/spec/infra/domain-security-operations.md` | DNS/Nginx/TLS/HSTS 的外部写授权、精确快照、`nginx -t`、分阶段观察与回滚合同；任何 Phase 9 外部入口变化都受此约束。 |
| `.trellis/spec/infra/ci-execution.md` | GitHub Actions 仅手动质量反馈，不是 Hostdzire 发布门禁；发布边界仍以 Hostdzire Runbook 为准。 |
| `.trellis/spec/infra/e2e-isolation.md` | 本地/CI real-stack 的独占 PostgreSQL/Redis/storage/process 与精确 cleanup 合同；可作为 rehearsal 测试隔离参考，但不等于已部署环境 rehearsal。 |

### 5. 文档能证明与不能证明的部署现状

仓库文档能证明的是“仓库批准的预发布操作模型”：Hostdzire Runbook 把 `https://geo.962850.xyz` 定义为预发布环境，固定 staging Compose/共享环境文件/发布脚本和验收/回滚流程（`docs/Hostdzire部署上线流程.md:1-3,20-46,64-137`）。它还明确 `current` 只是最后验收 release 的记录，不是流量开关（`:88,129-133`；`docs/Hostdzire部署附录.md:438-446`）。

仓库文档**不能**证明 2026-08-24 的外部实际状态：当前域名实际解析/流量入口、活动 release/commit、运行的是 V1 还是 V2、真实 Nginx 生效配置、容器/镜像、监控平台和告警状态均需远程只读核查；本规划按范围没有连接远程，不能把 Runbook 期望配置写成现场事实。

仓库中存在 `compose.prod`、production Nginx 模板和 production deploy 脚本并不等于已有生产环境。当前找到的权威 Runbook 明确针对“Hostdzire 预发布”，没有一份等价、现行且声明真实 production 域名/宿主/入口的 production Runbook。因此“当前 production 实际部署入口”在仓库内不可确定。

### 6. Cutover gap analysis

1. **缺现场 inventory**：没有经只读核验的 staging/production FQDN、TLS/DNS/Nginx 入口、active release SHA、V1/V2 artifact、容器和静态目录 owner 清单。
2. **缺 production 权威 Runbook**：现有主 Runbook只覆盖 Hostdzire 预发布；production 文件存在不构成外部环境存在证据。
3. **缺 V2 staging 接入变更表**：现有文档没有逐文件说明 staging 的 V1 build/container/static owner 如何替换或并存，也没有 V2-specific smoke/rollback release manifest。
4. **缺安全的 production-like rehearsal 数据方案**：现有全量验收计划会创建测试业务数据；尚未定义生产数据脱敏快照、隔离恢复、只读/写入边界、禁止外部副作用（AI/OSS/第三方发布）和销毁授权。
5. **redirect map 不可执行**：只有顶层路径概念矩阵，缺参数转换、query/hash 保留、权限差异、无对应资源、过期 bookmark、未知路径、browser Back/Forward、refresh 与 redirect loop 验收表。
6. **缺 frontend-specific rollback 演练**：现有回滚以完整应用 release/镜像为单位，并明确 `current` 不是流量开关；尚未定义 V1/V2 入口切换点、前一 V1 release 身份、V2 asset 与 HTML 原子一致性、缓存中的旧 chunk 兼容/失败策略。
7. **缺可判定观察窗口**：Phase 9 只写“错误率/API 观察”；没有时长、采样源、基线、阈值、P0/P1/P2、谁判定、何时停止或回滚。
8. **监控仅有指标建议**：`docs/GEO系统前后端技术与部署方案.md:927-941` 是 MVP 指标清单，没有已部署监控产品、dashboard、alert rule、通知 owner 或保留期证据。
9. **缺 source map 运维合同**：Cutover Gate 要求验证策略，但未决定是否生成、是否公开、上传到何处、与 build SHA 如何关联、访问/保留边界。
10. **V1 删除边界正确但未细化**：`07:194-196,514-524,526-541` 已明确最后独立删除；后续规划仍需把“删除 V1 pipeline/`frontend/`”保持为 Gate 和观察期全部通过后的独立、可回滚 Task，不应与正式切换同 Task。

### 7. 必须由用户确认的外部事实

以下事实无法从仓库确定，且会改变 Cutover 设计，必须在对应子任务的外部只读调查或写操作前由用户确认；本审计不猜测：

1. production 是否已存在；若存在，其真实域名、平台/宿主、入口层、TLS 终止点和权威运维 owner。
2. `https://geo.962850.xyz` 当前是否仍是 staging、当前由哪一 release/SHA 和 V1/V2 artifact 提供服务。
3. staging 与 production 的 DNS、Nginx、容器/静态文件、对象存储、数据库、Redis 和外部 AI 是否完全隔离。
4. 实际流量切换控制点是 DNS、宿主 Nginx、静态目录、Compose 服务、反向代理 upstream 或其他平台能力，以及各控制点的写权限 owner。
5. production-like rehearsal 可使用的数据来源、脱敏规则、隔离恢复位置、允许创建/保留哪些测试记录，以及是否允许触发外部 AI/OSS/邮件或第三方发布副作用。
6. 当前监控/日志/错误收集产品、dashboard/查询入口、告警通知 owner、可接受错误率与延迟基线、观察窗口时长和值班安排。
7. 正式切换维护窗口、可接受中断、用户通知要求、回滚决策人和“不可继续观察”的硬阈值。
8. 已验证 V1 rollback release/image/SHA 是否仍保留、与当前数据库契约是否兼容、所需环境文件和镜像是否可用。
9. source map 是否允许生成、是否允许公网访问、是否上传到受控错误平台，以及保存期限。

## Files Found

- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-phase-8-workbench-planning/task.json`：Phase 8 父任务状态、13 个 child 清单与最终 Gate metadata。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-*/task.json`、`.trellis/tasks/archive/2026-08/08-24-frontend-v2-*/task.json`：13 个 Phase 8 child 的归档状态与 parent 关系；精确路径见 Findings 第 1 节。
- `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-post-blocker-recheck/{task.json,implement.md}`：最终 Gate 的候选、计数、cleanup、安全输出边界与 `MET` 结论。
- `docs/frontend-v2/07-migration-plan.md`：Phase 8 closeout、Phase 9 顺序、Cutover Gate 与 V1→V2 路由矩阵。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：Phase 8 验证证据、deployment smoke 与 observability 字段。
- `docs/frontend-v2/09-architecture-decisions.md`：Workbench/V1 dashboard 的 Phase 9 前所有权边界。
- `docs/operations.md`：跨环境部署、数据、凭据、回滚与验收原则。
- `docs/Hostdzire部署上线流程.md`：Hostdzire staging 日常/完整发布、停止条件、验收和回滚主 Runbook。
- `docs/Hostdzire部署附录.md`：Hostdzire staging 初始化、发布、恢复、Nginx、浏览器验收和排障细节。
- `docs/deployed-full-functional-acceptance-plan.md`：已部署环境的隔离测试数据、业务验收、停止和退出规则。
- `docs/GEO系统前后端技术与部署方案.md`：总体/较早的 Nginx、release、回滚、日志和 MVP 监控设计。
- `.trellis/spec/infra/{index,domain-security-operations,ci-execution,e2e-isolation}.md`：Phase 9 基础设施授权与验证约束。
- `.trellis/spec/frontend/quality-guidelines.md`：production artifact、route/history 和根质量门禁约束。

## Code Patterns

- **完整 release 切换，不加 V2 内部 V1 fallback**：V2 Workbench 使用唯一聚合 owner，旧 dashboard 保留到 Phase 9（`docs/frontend-v2/09-architecture-decisions.md:301-318`）。
- **`current` 是验收记录，不是流量开关**：回滚必须重启已验证旧镜像并重做验收，不能只切软链接（`docs/Hostdzire部署上线流程.md:88,129-135`；`docs/Hostdzire部署附录.md:438-480`）。
- **部署失败保留现场，清理独立授权**：不以静默 fallback 或固定成功隐藏错误，也不在发布/回滚中顺带删除 release、镜像、备份或数据（`docs/operations.md:7-10`）。
- **外部入口写操作逐层授权和验证**：Nginx 变更先快照与 `nginx -t`，reload 后再做业务探针；HSTS 按阶段观察（`.trellis/spec/infra/domain-security-operations.md:1-57`）。
- **生产浏览器行为是必要证据**：健康、CLI 和容器状态不能替代真实入口的认证、渲染、console、direct/refresh/history 验收（`docs/operations.md:56-60`；`docs/frontend-v2/08-testing-quality-and-acceptance.md:408-412`）。
- **V1 删除最后独立执行**：Phase 0–8 保留 `frontend/`，Phase 9 最后一项才删除 V1 pipeline/frontend（`docs/frontend-v2/07-migration-plan.md:194-196,514-541`）。

## External References

无。本研究为仓库内只读审计，未连接 staging/production，也未使用互联网资料。外部环境事实必须在后续获得明确只读授权后现场核验。

## Related Specs

- `.trellis/spec/infra/index.md`：基础设施任务的授权、快照、验证与回滚总入口。
- `.trellis/spec/infra/domain-security-operations.md`：DNS、Nginx、TLS、HSTS、API upstream 与外部写授权边界。
- `.trellis/spec/infra/ci-execution.md`：手动 CI 与 Hostdzire 发布边界。
- `.trellis/spec/infra/e2e-isolation.md`：real-stack 测试的数据、Redis、存储、进程与 cleanup 隔离。
- `.trellis/spec/frontend/quality-guidelines.md`：V1/V2 根质量入口、production artifact Playwright、direct/refresh/Back/Forward 和未声明请求失败边界。
- `.trellis/workflow.md`：复杂规划必须先形成可 review 的 `prd.md`、`design.md`、`implement.md`，每个 child 独立规划、验证和回滚。

## Caveats / Not Found

- 没有执行 Git、SSH、DNS、浏览器、部署、rehearsal 或远程 API 操作；所有结论仅代表当前仓库证据。
- `07`、`08` 和最终 recheck 的历史句子仍写“父任务未归档”，与当前 archive 事实不一致；Gate=`MET` 的验证数字和结论本身没有发现漂移。
- 父任务 `task.json:63,85` 仍保留“等待提交、不要归档”的历史 next action，但同一文件当前已在 archive、`status=completed`。规划应把这些字段视为历史执行记录，不作为当前 blocker。
- 未找到声明真实 production 域名/宿主/入口且与 Hostdzire staging Runbook 同等权威的 production Runbook。
- 未找到已部署错误监控平台、告警阈值、观察窗口、正式 Cutover 失败判据或 V1/V2 专用回滚演练报告。
- `docs/GEO系统前后端技术与部署方案.md` 包含可能过时的现场描述和较早软链接部署设计；涉及当前环境时应优先使用现行 Hostdzire Runbook，并在后续获授权后以远程只读证据裁决。
