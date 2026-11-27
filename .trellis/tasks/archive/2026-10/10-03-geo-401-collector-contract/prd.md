# GEO-401 Task Brief：GeoCollector 协议与稳定错误模型

## 1. 基本信息
GEO-401 / R3；负责人 Codex 主代理；分支 geo/GEO-401（进入会话时已存在）；状态 done（Trellis completed）；2026-10-03 本会话用户已人工审查并接受实现与测试证据。依赖 GEO-204、GEO-301 均为 done，2026-10-02 已人工接受，manifest 与两任务 prd/design/implement 已核对。无 commit/PR/部署。

## 2. 目标
提供可以被后续 adapter 和 Worker 实现/消费的统一采集输入、原始结果、能力、估价及稳定错误合同；异常明确发送状态，保护 at-most-once 恢复决策，不执行外部采集。

## 3. 关联需求
WBS GEO-401 完整行；CAP-GEO-03、AC-RUN-01/03/05/06、AC-SEC-02；Accepted ADR-001/002/003/005 的采集边界与发送门禁。

## 4. 必读文档
用户列明的 README、roadmap、WBS、execution guide、task template、manifest、核心 PRD、领域模型、状态机、技术/数据/API/Worker/安全/测试/部署文档与四份 Accepted ADR 均已读取。根/backend AGENTS、Trellis workflow/backend 索引及相关错误/质量/AI 边界规范已定位。当前权威为 OpenAPI Run 错误/发送状态/快照、数据库 Batch/Run/Answer 合同，0048/0050 迁移及 Collector Registry、资格策略、Schema 与相关单元测试。

## 5. 当前行为
Registry 只有 manual 元数据，提供六项能力及配置校验，共享 eligibility 由服务拥有。Run 已有闭合错误码、NOT_STARTED/SENT/UNKNOWN/COMPLETED、不可变输入及 attempt/lease。原始证据合同已有安全 URL、非空原文、闭合四字段摘要、未知元数据为 null。没有 GeoCollector、CollectionRequest/CollectedAnswer 或稳定 CollectorError。基线见 evidence/baseline-unit.log；大量既有未提交工作保留，相关文件起点见 evidence/baseline。

## 6. 目标行为
内部请求和结果为不可变值对象，与 API DTO/ORM 显式转换；输入不携带 Session、凭据、事实正文或分析字典。结果不包含指标/分析，保留原文及 unknown。异常必须提供阶段和发送状态，只有确证发送前的暂态连接失败可 SAFE_BEFORE_SEND；发送后永不可同 attempt 重发。协议声明纯校验、无 I/O 估价、单次 collect 与发送前授权回调。

## 7. 范围内
- [x] CollectionRequest、CollectedAnswer、Citation、Usage、Money、CollectionEstimate。
- [x] GeoCollector Protocol、既有 metadata/capability/validate_profile 合同对齐。
- [x] CollectorError：闭合码/阶段/retryability、非敏感静态摘要、provider status/retry-after、必填 send state。
- [x] 抽象 contract unit tests、指定门禁、实施说明与状态证据。

## 8. 范围外
GEO-402 fake provider/HTTP 合同套件，GEO-403 Profile 测试，GEO-404 API adapter/请求解析，GEO-405/406 Worker/lease/dispatch/恢复，GEO-407 预算和费用持久化；Browser、机器分析、指标、机会、前端/新 API、真实外部请求、依赖升级、历史数据迁移、Git 提交/发布。

## 9. 业务不变量
PostgreSQL 唯一状态源，Redis 只传 ID；Collector 无 ORM/事务/锁/业务状态写入。能力声明不等于实际搜索/引用。未报告费用/usage/version/search 保持未知，不猜零/推算。Collector 只获得冻结原问题，不拼接品牌事实。发送后无自动重试；错误不能包含供应商正文、凭据或异常文本。

## 10. 契约变化
新增内部 Python adapter 合同，无公共 OpenAPI operation/schema/错误码变化，无数据库表/列/CHECK/索引/枚举变化，Alembic head 保持 0051_geo_manual_collection；无需前滚/回填。复用现有 GeoRunErrorCode、GeoExternalCallState 及六能力目录。

## 11. 后端实现
新增 collectors/contracts.py（值对象与显式输入转换）、errors.py（异常与恢复分类）、base.py（Protocol）。不新增 Router、Application Service、ORM 或 provider 工厂。细阶段映射 Run 的 COLLECTION；错误码复用已有目录。发送回调由未来 Worker 执行短事务及 lease/token/当前资格检查，Collector 在首次请求字节前调用，失败不得发送；本任务只定义合同，不宣称实现持久化隔离。

## 12. 前端实现
无路由/query key/URL/页面状态变化；无 generated 类型修改，前端继续消费现有 OpenAPI。

## 13. 测试计划
Unit/Contract：冻结输入转换与隔离、原文/未知/partial usage、引用及大小数值边界、闭合安全摘要、估价 unknown、错误必填 send state/组合/重试分类/脱敏、协议结构与无 ORM 依赖。复用 Registry/Run/Answer 基线。按用户执行全部最低命令。无数据库/HTTP/Worker/页面运行行为变化，不运行 PG/Redis/E2E/浏览器矩阵/生产 smoke。

## 14. 验收标准
Collector 签名和依赖无 ORM Session/提交；任一稳定异常有显式发送状态；SENT/UNKNOWN/COMPLETED 无 SAFE_BEFORE_SEND；同 attempt 不自动发送第二请求。非空原文、未知值和安全摘要符合现有持久化边界，能力来自唯一目录；默认 Registry 仍只有 manual。

## 15. 验证命令
基线：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_run_contract.py backend/tests/unit/test_geo_answer_contract.py。
新增定向 pytest；git diff --check；make contract-check；make lint；make typecheck；make test-unit。实际退出码与日志记录 implement.md，不将未执行或环境阻断写成通过。

## 16. 数据和上线
无数据库/生产写入；默认自动开关与 Registry 不变。协议代码可撤销本任务文件，历史数据不受影响。真实适配器和发送恢复由后续任务实施，协议不授予外发资格。

## 17. 风险与开放问题
值对象不可与公开 DTO/ORM 混用；输入 PUBLIC 标记不授予外发许可。目标文档中的 subject_snapshot 为建议结构，分析字典不进入 Collector 以防品牌污染/不必要外发。错误 COMPLETED 表示外部响应结束，不表示回答入库或业务成功。停止条件限用户列明五类；环境验证阻断精确记录，不伪造业务 blocked。

## 18. 完成证据
实现和最终验证见 implement.md；定向 210、后端 2795 与前端 1121 单元通过，contract/lint/typecheck/diff 证据位于 evidence。独立只读复核的来源空白/NUL 两项 P2 已修正，13 项回归先失败后通过；审计关闭校验通过。文档 SHA、任务增量 diff 与工作树核对记录保留。2026-10-03 本会话用户明确接受 GEO-401 的实现与测试证据，manifest 从 review 更新为 done，Trellis 从 review 更新为 completed。验收范围与依据见 implement.md；本次不修改其他任务状态、不实施后续任务、不提交或归档。

## 19. 后续任务
GEO-402、GEO-403、GEO-404，以及 GEO-405/406/407；只列出，不实施。
