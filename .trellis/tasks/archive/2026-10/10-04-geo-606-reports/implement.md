# GEO-606 交付记录

## 状态与授权

2026-10-04，GEO-606 / R5，分支 `geo/GEO-606`。入口核对 manifest 中 GEO-605 为 done，Trellis completed，人工接受记录存在；允许进入执行。开始时已更新 in_progress，完成实现和本地验证后仅更新 review，等待人工验收。GEO-607 仍 planned；没有提交、推送、归档、生产迁移或生产启用。

Task Brief 为 [prd.md](prd.md)，设计为 [design.md](design.md)，实施/检查上下文为 implement.jsonl 和 check.jsonl。已读取用户指定全部文档、根/backend/frontend AGENTS、作用域 spec、当前 OpenAPI/数据库/迁移/调用者/测试，并在编码前输出 12 项 preflight。基线为后端 24、前端 23 项通过，见 evidence/baseline-backend.log 与 baseline-frontend.log。

## 最终行为

- `/geo/reports` 预览与 `/geo/reports/print` 独立打印路由，继承总览/回答洞察的完整 URL 基础筛选。服务端一次洞察快照输出，前端只消费 generated OpenAPI，不重算指标。
- 同页显示所有筛选、as_of、数据库生成时间、LIVE 方法说明、公式/版本、分子分母/样本、完整冻结维度、当前/前周期趋势及不可比较原因、主题、引用、声明风险、排除/质量、费用未知和分币信息。
- 0 候选为 NO_DATA，0 合格为 NO_ELIGIBLE_RUNS，保留真实质量；不可用时没有打印入口。权限/不可恢复参数错误移除旧数据、下载和刷新入口；暂时网络/5xx/429 错误保留上次快照并明确提示。
- 三类已存在数据 CSV（runs/citations/claims）使用原生浏览器下载，服务端流式发送，不在前端累计全文件 Blob。每次独立实时快照，明确不声称客户端下载完成。
- opportunities.csv 已建立公共操作并明确 501 NOT_IMPLEMENTED；页面无可用下载入口。当前没有 Opportunity 模型或生成数据，不能越过 GEO-702 创建模型/行动闭环，也不能用 header-only CSV 假装成功。
- CSV 为空返回 409 GEO_REPORT_EMPTY，首条成功编码和审计提交均先于 HTTP 200；流中错误终止连接且释放资源，不补空行或静默成功。

## 合同与迁移

`contracts/openapi.yaml` 仅新增 `/api/v1/geo/reports/{preview,print,runs.csv,citations.csv,claims.csv,opportunities.csv}` 六个 GET 和 GeoReportFormula / GeoReportExport / GeoReportPreview 三个 Schema；既有 paths/Schema 保持语义不变。CSV `text/csv`、UTF-8/BOM、Content-Disposition、X-Report-As-Of、no-store；沿用统一认证、Request ID 和错误响应。前端 generated schema 与 routeTree 经正规生成命令同步。

`contracts/database.md` 只补充读取一致性、白名单、空/未实施和审计语义；不改变 DDL。无新增 Alembic revision、回填或历史数据迁移，head 仍 `0056_geo_run_review`。隔离 PostgreSQL 的完整集成与真实栈从空库执行既有链条前滚至 0056 成功。恢复路径是移除新增路由/模块并保留 append-only 审计，无需破坏性迁移或修改历史记录。

## 不变量、并发与错误

PostgreSQL 是业务状态唯一来源；没有 Redis 消息、provider 调用、业务状态转换、revision 变化或 business row lock。Router 只解析/认证/响应，Application Service 拥有 RR 快照、CSV 专有 session 及审计事务。

同筛选的冻结 binding、latest attempt、当前成功 analysis 和最新 review 与现有指标输入一致。runs 包含失败候选和资格/原因；citations 按现有引用资格和 run/citation 去重；claims 保留 UNJUDGEABLE 但不充当可判断分母。原 load_inputs 只增加 keyword-only run_ids；默认行为保持不变，空 ID 集不回退全表。

CSV 固定 100 个候选 keyset 批次，排序 created_at DESC / id ASC；同一 RR 内分页读取，不使用全量缓存或 OFFSET 扫描。专有流资源以 RLock 串行化整个 next/close，处理 ASGI 2.4 原生 asyncio.Task.cancel 与工作线程 next 的交错；异常可重入关闭，会话/生成器一次释放，CancelledError 保留。此锁不影响业务数据库锁序。

报告/CSV 为实时只读 GET，没有幂等业务命令。重复打印准备/导出会独立审计；审计为独立应用事务，重新检查 User 活动、角色、首次改密限制，提交失败阻止交付。新增 geo_report.print_prepared / geo_report.export_started；分别表示打印数据准备和开始传输，不表示 OS 已打印或客户端全量收齐。主读取事务不提交 heartbeat 或业务变更。空集 409、未实施 501、非法筛选 422、权限 401/403，沿用现有错误映射和安全消息。

## 安全与敏感数据

CSV 每类固定字段白名单，不接受 fields/任意选择器。csv.writer 正确处理引号、逗号和换行；文本检查前导 Unicode 空白/控制后，对 = / + / - / @、制表和换行等公式风险加单引号，源数据不被修改。100k 合成行验证峰值内存低于 1 MiB，验证的是流式序列化，不声称已通过 100k 数据库查询/P95。

导出稳定 run/batch/analysis/review/citation ID、必要冻结维度和版本。不会导出完整回答、raw、FactVersion excerpt、内部 explanation、profile 配置、凭据或签名下载链接。引用原 URL/规范 URL 可能含秘密 query，白名单保留 SHA-256 指纹和 hostname/title/occurrences/category/归属；可按 citation ID 在授权详情追溯，不改既有 URL 规范化。审计只保存 export_type、as_of、完整规范筛选 SHA-256，不能保存原筛选或正文。认证、CSRF、SSRF、TLS、不可变和审计边界均未放宽。

## 验证命令与结果

完整原始命令及退出码在同名 evidence/*.json，输出在 *.log。PostgreSQL/Redis/fake-oss 使用本任务独立 compose 项目 geo606-validation；E2E 使用独立数据库、Redis DB 14 和准确清理，集成使用 DB 15。表内 compose override 与 env 参数是实际执行参数，未使用共享 `.env` 或真实 AI。

| 实际命令 | 结果 | 输出 |
|---|---|---|
| `git diff --check` | 通过（exit 0），最终文档/状态后 | [git-diff-check-final.log](evidence/git-diff-check-final.log) |
| `make lint` | 通过（exit 0）；后端 lint/格式和前端 ESLint | [make-lint-delivery.log](evidence/make-lint-delivery.log) |
| `make typecheck` | 通过（exit 0）；后端/前端类型检查 | [make-typecheck-final.log](evidence/make-typecheck-final.log) |
| `make test-unit` | 通过（exit 0）；后端 3553；前端 128 文件、1197 项 | [make-test-unit-final-source.log](evidence/make-test-unit-final-source.log) |
| `make test-integration COMPOSE=docker compose -p geo606-validation -f .trellis/tasks/10-04-geo-606-reports/evidence/validation-compose.yaml` | 通过（exit 0）；PostgreSQL 集成 1004 项，25 条既有 SQLAlchemy warning | [make-test-integration-final.log](evidence/make-test-integration-final.log) |
| `npm --prefix frontend run test` | 通过（exit 0）；前端 128 文件、1197 项 | [frontend-test.log](evidence/frontend-test.log) |
| `npm --prefix frontend run typecheck` | 通过（exit 0）；最终前端类型检查 | [frontend-typecheck-delivery.log](evidence/frontend-typecheck-delivery.log) |
| `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55469/partsignal REDIS_URL=redis://127.0.0.1:56409/14 make e2e` | 通过（exit 0）；完整门禁退出 0：canonical 28；GEO 三阶段各 1；页面 498/条件跳过 64 | [make-e2e.log](evidence/make-e2e.log) |
| `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55469/partsignal REDIS_URL=redis://127.0.0.1:56409/14 deploy/scripts/e2e-local.sh` | 通过（exit 0）；最终默认选择含报告：canonical 29，secret scan clean | [canonical-e2e-delivery.log](evidence/canonical-e2e-delivery.log) |
| `make contract-check` | 通过（exit 0）；OpenAPI/generated 同步和运行时合同 | [make-contract-check-final.log](evidence/make-contract-check-final.log) |
| `env APP_ENV=test DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55469/partsignal REDIS_URL=redis://127.0.0.1:56409/15 uv run --project backend pytest --import-mode=importlib backend/tests/unit/test_geo_reports.py backend/tests/integration/test_geo_reports.py -q` | 通过（exit 0）；CSV 后端 35 单元 + 9 PostgreSQL 集成 | [asgi24-backend-target.log](evidence/asgi24-backend-target.log) |
| `npm --prefix frontend run test -- src/domains/geo-reports` | 通过（exit 0）；最终报告组件 4 项 | [report-front-final.log](evidence/report-front-final.log) |
| `env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55469/partsignal REDIS_URL=redis://127.0.0.1:56409/14 PARTSIGNAL_E2E_SPEC=tests/e2e/reports-real-stack.spec.ts deploy/scripts/e2e-local.sh` | 通过（exit 0）；报告真实栈定向 1 项 | [report-print-e2e-candidate.log](evidence/report-print-e2e-candidate.log) |

最终文档/状态更新后的 git diff --check、task.py validate 和 scope-audit 均退出 0。Task 上下文校验提示两项文件超过 32 KiB 自动注入截断上限（API 设计及数据库合同）；本任务已经直接完整读取所需权威单位，未把自动注入当作完整证据。validation-summary.json / scope-audit.json 记录结果。独立 compose 项目 down -v 退出 0，仅删除本任务容器、网络和卷。用户要求的所有最低命令已运行；没有把未执行的命令记为通过。完整 make e2e 最初默认列表未包含新报告用例；补充唯一报告 spec 行后，默认 canonical 全套重新执行 29 项通过。未变化的其他 E2E 阶段复用完整门禁证据。

## 早期失败与处理

- 首次集成 950 通过/54 失败：隔离 compose 缺少 fake-oss，存储连接被拒绝。补充测试专用 fake-oss 后相关存储 smoke 2 项通过，随后全套 1004 通过；没有修改生产存储行为。
- 初次单元包含公开路径/Schema 计数冻结断言差异和一项 fake TCP 连接 1 秒超时。精确更新新增 6 操作/3 Schema 的合同期望；fake provider 独立诊断通过，后续完整单元通过。未放宽 provider 超时或吞错。
- 打印 E2E 初次分别因文件名 UTC 分隔符和服务器 datetime 微秒规范化断言失败。断言按公开语义修正，真实下载/打印最终定向和 canonical 通过；不改变日期或文件名业务约定。
- 独立复核确认 ASGI 2.4 原生任务取消存在 generator already executing。新增精确事件交错回归先失败，再由 RLock 修复通过；35 unit / 9 PG 通过，复核者独立重放确认释放一次。修前/后证据均保留。
- 前端开发期的类型/显示断言以及临时 OpenAPI 生成排版/响应 ref 问题已修正；最终 contract、lint、typecheck 和测试均通过。OpenAPI 恢复基线文本后只插入新增块，避免全文件重排。

## 独立复核与证据

[独立复核](evidence/independent-review.md) 覆盖公共合同、权限、RR、资格、白名单、审计及断连生命周期；上述 P2 已解除，无剩余确认阻断。前端最后收紧不可恢复错误的页头刷新入口由主代理定向和完整前端验证。

审计 Bundle ID：`20261004T103135Z-geo-606-2b03c076`。工作包计划/执行 v6 均已校验、关闭；2/2 验收，独立复核 1，残留 Worker 0，异常 0。固定 TOML 模型是配置证据，不声称运行时单独验证；详情见 [SUBAGENT_EXECUTION_DIGEST.md](evidence/SUBAGENT_EXECUTION_DIGEST.md) / JSON。

[A4 打印示例](evidence/geo606-print-example.pdf) 来自本地 fake/手工真实栈固定虚构数据；通过 window.print 调用、print media、表格完整信息和无横向裁切检查。没有操作真实 OS 打印对话框或打印机，也未把 PDF 作为生产报告归档。

## 本任务修改文件

以下按开始前 baseline-files.json 识别，与 Git HEAD 上的历史 GEO 脏工作无关，共 34 个 maintained 文件。Trellis Task Brief、设计、本文、上下文 JSONL、task.json 和 evidence 为本任务新增证据；未改其他任务实现。

- [backend/app/audit_types.py](/Users/sc/PycharmProjects/partsignal/backend/app/audit_types.py)
- [backend/app/main.py](/Users/sc/PycharmProjects/partsignal/backend/app/main.py)
- [backend/app/services/geo_overview_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_overview_queries.py)
- [backend/tests/unit/test_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_contract.py)
- [backend/tests/unit/test_runtime_response_metadata.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_runtime_response_metadata.py)
- [frontend/src/routeTree.gen.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/routeTree.gen.ts)
- [frontend/src/app/navigation.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.test.ts)
- [frontend/src/app/navigation.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.ts)
- [frontend/src/styles/global.css](/Users/sc/PycharmProjects/partsignal/frontend/src/styles/global.css)
- [frontend/src/domains/geo-insights/insight-page-frame.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-insights/insight-page-frame.tsx)
- [frontend/src/domains/audit/audit.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/audit/audit.model.ts)
- [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts)
- [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml)
- [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)
- [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md)
- [docs/geo-monitoring/03-technical/04-frontend-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/04-frontend-architecture.md)
- [deploy/scripts/e2e-local.sh](/Users/sc/PycharmProjects/partsignal/deploy/scripts/e2e-local.sh)
- [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)
- [backend/app/routers/geo_reports.py](/Users/sc/PycharmProjects/partsignal/backend/app/routers/geo_reports.py)
- [backend/app/schemas/geo_reports.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_reports.py)
- [backend/app/services/geo_reports.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_reports.py)
- [backend/app/services/geo_report_formulas.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_report_formulas.py)
- [backend/app/services/geo_report_csv.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_report_csv.py)
- [backend/tests/unit/test_geo_reports.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_reports.py)
- [backend/tests/integration/test_geo_reports.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_reports.py)
- [frontend/src/domains/geo-reports/report-content.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-reports/report-content.tsx)
- [frontend/src/domains/geo-reports/reports.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-reports/reports.test.tsx)
- [frontend/src/domains/geo-reports/reports.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-reports/reports.model.ts)
- [frontend/src/domains/geo-reports/reports.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-reports/reports.api.ts)
- [frontend/src/domains/geo-reports/report-page.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-reports/report-page.tsx)
- [frontend/src/routes/_app/geo/reports/index.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/geo/reports/index.tsx)
- [frontend/src/routes/_app/geo/reports/print.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/geo/reports/print.tsx)
- [frontend/tests/e2e/reports-real-stack.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/reports-real-stack.spec.ts)

## 限制与后续

- 报告 source_mode 为 LIVE，各次打印/CSV独立 as_of；没有归档冻结、持久化报告或跨请求快照 token。
- opportunities 尚无模型/数据来源，公开 CSV 操作 501；待 GEO-702 明确实现后再按相同白名单/事务规则接线，不提前实现。
- 未执行 GEO-607 的 P95、100k Run 数据库 fixture/索引和 R5 接受门禁；本任务的大数据证据限于 100k 流式合成序列化。
- 完整 E2E 的条件 skip 来自真实栈/fake/GEO 开关阶段选择，保留原日志；不是未通过的报告路径。
- 生产启用、Browser Collector、机会行动闭环不在本任务。下一直接任务 GEO-607 保持 planned，待 GEO-606 人工接受后进入，不在本次实施。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-606 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为 2026-10-04；既有 review 证据与验证限制保留为验收前历史。本次仅收尾 GEO-606，不修改其他任务状态、不实施后续任务，不提交或归档。

保留既有 execution_note、review_note、Task Brief、实施过程及 evidence 的历史状态与真实测试结果；SHA256SUMS 仅同步 manifest 条目。本次收尾运行 git diff --check，实际结果在最终回复报告。
