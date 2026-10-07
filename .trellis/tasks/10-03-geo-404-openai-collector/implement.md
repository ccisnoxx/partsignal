# GEO-404 实施与本地验收证据

状态 done（Trellis completed）；2026-10-03 本地实现及验证完成后进入 review，同日本会话用户人工审查并接受实现与测试证据，现记录验收完成。进入时已在 geo/GEO-404，未创建/提交分支、PR、部署或真实AI请求。根工作树已有大量改动，起点状态/受保护哈希/修改前副本在 evidence；本记录只描述本任务增量。

## 1. 依赖、范围与目标

manifest 的 GEO-401/GEO-403 均为 done，并有2026-10-03人工接受记录；GEO-404 planned 可进入执行，开始时更新 in_progress。本任务仅实现同步 OpenAI-compatible GEO Collector 与解析/安全传输/测试。无 GEO-405/406/407/408、Worker、分析、指标、机会、Browser 或生产授权接线。Task Brief 按05-task-template的19项建立，完整preflight在编码前输出；prd/design保留不变量与决策。

## 2. 实现摘要

OpenAICompatibleGeoCollector 由可信调用方装配一次调用内存配置，UUID绑定与adapter key/version严格一致。仅原始一个user prompt、stream=false，参数仅非指令数值白名单，Profile显式覆盖temperature/output token limit。纯 validate_profile 和 unknown estimate 不做网络。独立 openai_response 读取单个string回答，原文保留；结构化引用按实际位置，URL重复不消除；标准url_citation annotations按字符位置转为序号。搜索只读取bool/null；usage字段独立、费用Decimal只在有效完整金额/币种时报出；未知/部分不推算，不用配置猜模型/版本。

拒绝非法JSON/UTF8/surrogate/重复键/NaN、空/NUL/超长正文、截断或工具输出、非法已报告引用/usage/cost。安全摘要仅既有四字段；debug、Header、Cookie、raw bytes与截图不落结果。独立于GeneratedDraft解析，只复用既有Header校验和pinned transport。

## 3. 修改文件

- 新增 backend/app/collectors/openai_compatible.py、openai_response.py。
- 扩展 backend/app/services/pinned_http.py：可选发送回调、每请求较小byte cap、细阶段错误、编码/声明长度完整性失败。
- 新增 backend/tests/geo_openai_support.py、unit/test_geo_openai_collector.py、test_geo_openai_response.py、test_geo_openai_network.py。
- 调整 unit/test_geo_collector_contract.py：按文件/精确符号允许技术05已批准的纯传输/Header复用，继续禁止业务服务、ORM、事务及生成解析。
- deploy/scripts/test-geo-collector-contract.py 纳入真实adapter；docs README、技术05/07、manifest/SHA256SUMS及本Task Brief/设计/实施/证据更新。

具体增量见 evidence/changes.patch 和 change-inventory.json。原有无关工作保留；最终候选与独立审查快照、受保护合同/Registry哈希一致。

## 4. 公共合同、数据库与Alembic

无OpenAPI paths/schema/enum或frontend generated变更；database.md、表/列/索引/约束不变。没有Alembic revision、历史数据迁移、前滚、回填或回滚执行。仓库heads命令 `UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini heads` 返回0052_geo_profile_tests (head)；这是迁移源码head，不声称已检查实际数据库current。

## 5. 状态、锁、幂等与并发

Collector不持有Session/ORM/事务/锁，也不修改Run/Batch/revision或发Redis消息。当前身份/资格、lease/token、幂等和数据库SENT归未来Application Service/Worker。发送前TLS/peer及全部bytes准备后调用一次before_send；授权失败原实例传播，零字节且释放连接。每次collect至多一次HTTP发送，无自动redirect/retry/发送后换地址；不能据此宣称全局attempt跨进程幂等或持久化恢复完成。

## 6. 错误映射

配置/连接失败NOT_STARTED；仅确证未发送的暂态连接失败可SAFE_BEFORE_SEND。发送/读取中断UNKNOWN_OUTCOME/UNKNOWN；超限或非法长度仍SENT；完整HTTP认证/429/5xx/redirect失败为RECEIVE/COMPLETED，解析错误为PARSE/COMPLETED。非法HTTP600/999不保存provider_status；429仅数字Retry-After元数据，没有自动等待重发。既有AppError协议继续兼容。

## 7. 安全、隐私与外发

全量DNS审批（混合私网整体拒绝）、固定sockaddr/peer、原域名SNI/Host/CA校验保持；默认HTTPS，开发回环HTTP只允许development/test。body上限取请求值与transport既有2MiB的较小者，覆盖Content-Length、chunked与EOF；声明不足的正文失败，不截取成功。只PUBLIC可能外发，仍需before_send；现有INTERNAL批次没有独立外发授权，明确拒绝。Registry approved=false及answer-only保证声明不变。

非敏感Header经headers、敏感Header经sensitive_headers由可信调用方按已有is_sensitive事实装配；Cookie无论哪组均视作敏感。API Key/敏感Header/Cookie的已知原值、JSON、UTF-8/Latin-1 URL及标准Base64表示，含%HH大小写等价形式，若出现在保留结果字段则整份拒绝，不改正文；扫描副本不改变安全原文。检测范围是这些明确表示，不宣称任意可逆变换/内容的通用DLP。所有普通测试fake/回环，不测试真实AI。

## 8. 前端

无路由、query key、URL状态、generated类型或页面行为变化；前端既有测试按用户最低门禁实际运行。

## 9. 实际验证

所有make命令以 `UV_CACHE_DIR=.cache/uv` 执行，完整日志在evidence。最终生产候选经独立只读核对后保持不变。

| 命令 | 实际结果 | 证据 |
|---|---|---|
| 基线定向pytest：collector_contract、collector_registry、collector_suite、profile_test_policy、pinned_http | 177 passed | baseline.log |
| 新Collector/响应/网络 + 既有contract/pinned定向pytest | 221 passed；随后最后wire-URL补充由七例回归、完整unit和最终Collector入口覆盖 | review-fixes.log |
| pytest test_geo_openai_network.py::test_sensitive_header_reflections_are_rejected_in_retained_text | 7 passed | wire-url-regression.log |
| make contract-check | 后端运行时OpenAPI及generated类型一致，exit0 | contract-check.log |
| make lint | Ruff与ESLint通过，exit0 | lint.log |
| make typecheck | mypy149个源文件与frontend tsc通过，exit0 | typecheck.log |
| make test-unit | backend2994 passed；frontend120文件/1125 passed，exit0 | test-unit.log |
| make test-geo-collector-contract | 194 passed，tests=0/secret_scan=0/external_network=blocked，exit0 | collector-contract.log |
| git diff --check | 通过，exit0 | diff-check.log |
| shasum -a 256 -c SHA256SUMS（文档目录） | exit1：仅未改动的03-api-contract-design.md有既有索引失配；本任务四项文档全通过 | docs-checksums.log / task-doc-checksums.log |
| work-plan audit-verify | 两阶段Bundle校验通过 | audit-verify.log |

首轮失败没有隐藏：新夹具未成对提供model/channel UUID及TLS测试假设fake统计含Host，已修正夹具/实际wire断言，并补必需绑定校验。首次完整unit出现一条GEO-401的过宽AST断言，与技术05允许复用纯传输/Header不一致，按精确白名单调整并78项回归后完整通过。第一次修复检查发现凭据带引号/非ASCII的JSON表示未匹配，补UTF8/JSON序列化检测表示并重验。各首次日志保留。

专项套件在同时运行完整unit时，既有fake provider并发计数用例一次本地CONNECT失败（1 failed/189 passed）；fake_concurrency_diagnostic.log 的隔离用例1 passed，最终串行入口194 passed。具体系统根因未证明，没有新增生产重试、放宽安全边界、修改fake并发用例或隐藏失败；并发运行稳定性作为已知测试限制保留。

附加全目录文档SHA检查发现 `03-technical/03-api-contract-design.md` 的起点索引hash为3ad8c855…、当前文件为4b1e80f8…，本任务没有写入该既有文档，也没有改动其checksum条目；保留并报告该范围外失配。新README/技术05/07/manifest的四项校验通过。

## 10. 未运行检查与限制

没有PostgreSQL/Redis集成、Alembic前滚/数据迁移演练、完整自动采集E2E、Browser矩阵、生产smoke或真实provider测试：本次无持久化/Worker/页面接线，无法在此验证未来SENT/lease/迟到结果/恢复；真实平台也不属于普通测试。未将这些检查记为通过。运行timeout沿用既有pinned transport的socket超时语义，不宣称新增完整Worker deadline/取消能力。

## 11. 独立复核与审计

fresh critical_reviewer 首轮确认1项P1和3项P2并提供离线复现，主代理修复；第二轮发现精确Header wire编码/路径失败缺口，修复后独立30个FakeSocket探针通过，最终无确认缺陷/交付阻断。见review-initial.md、review-final.md与最终候选哈希。审查任务的验收只指只读审查交付，不代表GEO-404人工done。

Audit ID：20261003T091819Z-geo-404-5d5d3d84。WorkPlan/dispatch/execution/summary/digest已经本机工具校验、关闭并校验Bundle；SUBAGENT_EXECUTION_DIGEST.json/md复制在本Task evidence。配置证据来自Agent TOML，不冒充运行时模型遥测。源码差异和观察到的范围无代理写入、无残留活跃审查者。

## 12. 任务状态和交接

本地验证完成时 manifest GEO-404 planned→in_progress→review；Task Brief checklist完成，task.json review，completedAt为null。2026-10-03 人工验收后 manifest review→done，task.json review→completed，completedAt为2026-10-03；当前任务保留，未归档。GEO-401/403 done和GEO-405 planned保持不变；仅本任务文档SHA更新。无业务冲突、破坏性迁移或缺失外部授权导致blocked。

后续只交接不实现：GEO-405负责claim/lease/发送SENT和不可变结果提交；GEO-406负责已发送未知结果/恢复；GEO-407负责预算/费用持久化；GEO-408负责完整自动观测验收。

## 13. 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-404 的实现与测试证据。”据此将 manifest 中 GEO-404 从 review 更新为 done；Trellis task 从 review 更新为 completed，记录完成日期、验收人和验收依据，Task Brief 同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施 GEO-405 或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步 manifest 对应 SHA-256 条目。
