# GEO-401 实施与验证记录

2026-10-03，R3，分支 geo/GEO-401；本地交付 review，等待人工接受。
GEO-204/GEO-301 依赖均为 done，2026-10-02 已人工接受。未实施其他任务、提交、PR、部署
或生产操作。Task Brief、设计与当前任务入口均位于本目录，不归档、不自行标记 done。

## 实现结果

- `contracts.py`：严格不可变的 CollectionRequest/Profile/Surface、CollectedAnswer、
  Citation、Usage、Money、CollectionEstimate 与闭合 RawPayloadSummary。公开 Run 输入
  显式复制为内部值；原问题/回答及原始引用保留，unknown 为 None，不猜零或推算。
- `base.py`：同步 GeoCollector Protocol，复用唯一 Registration/capability/Profile
  校验；无 I/O 估价，collect 必填 before_send 授权回调。没有实际 adapter 或 factory。
- `errors.py`：CollectorError 及不可变 failure，闭合既有 Run 错误子集、细阶段、
  provider status/retry-after、静态安全 message、必填 external_call_state 与派生恢复分类。
- 78 项新增抽象合同测试覆盖原始值、持久化兼容边界、发送状态及无 ORM/提交依赖。
  未构造 fake provider、真实 HTTP 合同套件或测试用成功 adapter。

## 本任务修改文件

新增：

- backend/app/collectors/contracts.py
- backend/app/collectors/base.py
- backend/app/collectors/errors.py
- backend/tests/unit/test_geo_collector_contract.py
- .trellis/tasks/10-03-geo-401-collector-contract/ 下的 prd.md、design.md、implement.md、
  task.json、implement.jsonl、check.jsonl 与 evidence/。

更新：

- docs/geo-monitoring/README.md
- docs/geo-monitoring/03-technical/01-technical-architecture.md
- docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md
- docs/geo-monitoring/03-technical/07-testing-and-quality.md
- docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md（修正“协议未实施”）
- docs/geo-monitoring/04-delivery/task-manifest.yaml（GEO-401 planned → in_progress → review）
- docs/geo-monitoring/SHA256SUMS（仅同步本任务变动文档）
- .trellis/.runtime/sessions/ 的本会话任务指针（task.py start 设置；非共享 .current-task）

最终差异检查包含未跟踪源码与文档增量；首个检查包装错误地要求 no-index 差异返回 0，
修正为检查无空白错误输出后通过，诊断记在 evidence/validation-results.json。
根合同、已有 Registry、Run/Answer Schema 与其他既有成果未被本任务修改；起点副本、
SHA 和增量差异见 evidence/baseline、initial-hashes.json、scope-check.json。
进入会话时大量未提交文件不属于本任务，不将仓库全量 diff 归到 GEO-401。

## 契约、数据库与前端

仅新增内部 Python adapter 合同。无公共 OpenAPI operation/schema/错误码改动，前端
generated 类型无变化；无表/列/CHECK/索引/枚举改动，Alembic head 保持
0051_geo_manual_collection，无新 revision、前滚、回填或历史数据迁移。
没有新的路由、query key、URL 状态、页面或用户操作流程。

## 事务、锁与业务不变量

Collector 源码不依赖 ORM/Session/Service，也不提交或回滚事务。协议不改变既有锁顺序、
revision、状态机、幂等键或并发运行行为。PostgreSQL 状态/lease/token 的最终裁决由后续
Worker/Application Service 拥有；Redis 仍只传稳定 ID，本任务无队列接线。

SAFE_BEFORE_SEND 仅用于确证未发字节的连接/发送暂态错误。SENT/UNKNOWN/COMPLETED
不能返回该分类；完整 429 的 retry-after 不允许同 attempt 重发。发送前回调的持久化
SENT 优先于 Collector 的局部 NOT_STARTED；COMPLETED 不表示业务成功或已经落库。
本任务只建立可消费合同，不宣称真实 at-most-once、lease 隔离或发送计数已实现。

## 安全、隐私与外部边界

请求不携带凭据、任意 Header、subject/事实/别名字典，PUBLIC 也不构成发送授权。
错误文本为静态白名单；闭合摘要拒绝任意 provider 字符串/秘密键，repr 不显示正文。
引用 URL 复用既有安全校验且不抓取页面；无真实平台请求、凭据写入或安全策略降级。
值对象只约束 bytes 结构/大小，实际脱敏、截图裁剪、SSRF/TLS/peer、超时与资源释放
仍是后续 adapter 的验收责任，协议说明不替代真实运行证据。

## 实际命令与结果

以下命令均从仓库根运行，除 SHA 校验注明其 cwd；日志保存在 evidence/。

| 命令 | 结果 | 原始证据 |
|---|---|---|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_run_contract.py backend/tests/unit/test_geo_answer_contract.py | pytest 132 passed；初次包装脚本赋值只读 zsh status 导致包装 exit 1，pytest 本身通过，无测试环境阻断 | baseline-unit.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_run_contract.py backend/tests/unit/test_geo_answer_contract.py | 最终 exit 0，210 passed（78 新增 + 132 相邻基线） | collector-unit-final.log |
| git diff --check | exit 0；另检查本任务未跟踪源码/文档增量空白 | diff-check-final.log、scope-check.json |
| make contract-check | exit 0；运行时 OpenAPI 与 generated 类型一致，根合同/运行时/generated 输入随后未变，复用有效证据 | contract-check.log |
| make lint | 修正后 exit 0；Ruff + ESLint | lint-final.log |
| make typecheck | 修正后 exit 0；mypy 145 source files + tsc | typecheck-final.log |
| make test-unit | 修正后 exit 0；后端 2795 passed，前端 119 files / 1121 tests passed | test-unit-final.log |
| shasum -a 256 -c SHA256SUMS（cwd docs/geo-monitoring） | exit 0，全部文档校验和通过 | docs-sha256.log |

首次定向发现模式/login Literal 到内部 Enum 转换与摘要 bool 问题：5 failed / 60 passed，
按已安装 Pydantic 行为修正后 197 passed，原始日志为 collector-unit-first.log/collector-unit.log。
独立复核新增 13 项回归在旧代码全部失败（review-regression-before.log）；中间修正复用
NonEmpty 正则发现其 \S 可匹配 NUL，6 failed / 204 passed（review-regression-intermediate.log）。
随后在内部 source 边界显式拒绝 NUL，标题同样拒绝 NUL，最终 210 passed。
无共享公共 Schema 修改、静默字符清理或元数据补值。

## 独立复核与范围核对

fresh critical_reviewer 只读审查候选，确认两个 P2：空白来源及来源/标题 NUL 能构造
无法保存的成功结果；主代理已按以上回归修正。报告针对修正前候选，修正后未另行派发
复核；修正证据为定向测试、完整门禁与主代理差异检查，不能冒充第二次独立复核。
原报告见 evidence/independent-review.md；18 次只读 exec 的实际本地工具记录和 Python -B
内存探针见 independent-review-tool-evidence.json，不以 Worker 自述代替写入证据。
复核穷举 360 组合，接受 114，只有 4 个 SAFE，所有已发送状态均非 SAFE。

持久化审计已关闭并校验通过，无残留活跃 Worker、未知写入或未执行 ready task：
audit_id = 20261003T072330Z-geo-401-collector-contract-0a897fbd。
聚合证据见 evidence/SUBAGENT_EXECUTION_DIGEST.json/.md。Agent TOML 配置不是运行时模型
确认；复核交付 accepted 不是 GEO-401 人工验收 done。

## 未运行与已知限制

未运行 PostgreSQL 集成/迁移、真实外部平台、HTTP 安全/采集计数、Worker/Redis/lease
竞争恢复、文件上传、E2E 或浏览器矩阵：本任务无对应运行实现或边界改动。
门禁与抽象测试不能证明真实传输、凭据清理、迟到结果或完整 R3 用户流程。
这些覆盖属于 GEO-402/404/405/406 等后续任务，未提前实施。
未改变已批准业务、安全、指标或状态机，未触发用户定义的 blocked 条件。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-401 的实现与测试证据。”据此仅将
manifest 的 GEO-401 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，
completedAt=2026-10-03，并记录接受者、范围与依据；Task Brief 当前状态同步更新。
验收范围为 GeoCollector 协议、CollectionRequest/CollectedAnswer/CollectorError、capability
和 adapter contract 及以上实施与测试证据，不包含后续 provider、Worker 或真实发送恢复。

以上实施章节、设计和原始 evidence 保留人工验收前的历史状态、实际测试结果与已知限制，
不将未运行检查改写为通过。本次只记录 GEO-401 验收，不修改其他任务状态、不实施后续
任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
