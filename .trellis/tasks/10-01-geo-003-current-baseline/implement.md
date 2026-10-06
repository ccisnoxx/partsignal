# GEO-003 实施与验证记录

## 1. 授权与依赖门禁

2026-10-01，本会话只执行 GEO-003 / R0 的只读实现盘点。初始分支已为 `geo/GEO-003`，HEAD 为 `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814`；无 tracked 业务改动，现有 GEO 文档包与 GEO-002 Trellis 任务为未跟踪工作，保留其内容。

manifest 的 GEO-003 初始为 planned，GEO-001/002 均为 done，五份 ADR 均为 Accepted；WBS 完整行与依赖确认后允许执行。开始前读取指定产品/业务/技术/交付/治理文档、相关 AGENTS/spec、旧 GEO 与 GEO-002 任务历史；完整 preflight 已在会话输出，不等待额外确认。

调用 Trellis task CLI 创建本目录和 Task Brief 并 start，manifest 先进入 in_progress。未创建其他 GEO task，未委派子代理；没有 commit、push、PR、部署、归档或数据操作。

## 2. 交付内容与可复查范围

- [主基线](../../../docs/geo-monitoring/04-delivery/06-current-geo-baseline.md)：三类模型、当前 API/schema/table/迁移、查询、锁、幂等、错误映射、路由/URL/query cache、测试入口和目标差异。
- [快照目录](../../../docs/geo-monitoring/04-delivery/geo-003-baseline/)：openapi/routes/database/migrations/queries/tests/sources 七份 JSON 与 validation.md。
- 12 个 path / 16 个 operation / 74 个 schema / 7 张表 / 43 个 revision / 35 个相关测试源文件 / 143 个源码与合同指纹。
- ORM metadata 明确不代表 live catalog；迁移源码 head 明确不代表运行库 revision。旧 trigger 的演进、当前 UPDATE-only 防线与删除例外按 0037 现状记录。
- 现有人工关系 `MANUAL_OBSERVATION_PUBLICATION_RELATION`、legacy 根记录与未来回答级 Batch/Run 分开。旧 summary、supersedes chain、QueryTopic variants 和优化内容任务来源不代表新实体。
- 更新文档 README、CHANGELOG、SHA256SUMS 和 manifest 的 GEO-003 片段；根 OpenAPI/数据库合同、源码、迁移、generated types、依赖、部署与交互零变化。

证据脚本 [capture_baseline.py](./evidence/capture_baseline.py) 不访问 DB/network，拒绝覆盖输出目录。初次捕获因 OpenAPI component 参数 `$ref` 尚未解析失败；补上参数引用展开，保留不完整输出于工作区外临时目录，重新生成完整快照。该修正只影响任务证据工具，不修改 API。

## 3. 实际验证

精确命令、结果、skip 原因、原始日志及未到达门禁完整保存在 [validation.md](../../../docs/geo-monitoring/04-delivery/geo-003-baseline/validation.md)、[commands.json](./evidence/checks/commands.json) 与 [supplemental.json](./evidence/checks/supplemental.json)。

八项最低命令均执行：diff、contract-check、lint、typecheck、test-unit、frontend test、frontend typecheck 通过；make verify 退出 2，在 Docker test-integration 阶段因 `/var/run/docker.sock` 不存在而中断。已经运行的后端 749 和前端 861 测试通过；不能宣称完整 verify 通过。

定向证据：GEO unit 8 passed；GEO 前端 13 files / 89 tests passed；六份桌面 GEO fixture E2E 57 passed 且产物敏感扫描 clean；七份 GEO E2E 收集 118 项。后端定向 integration 为 14 passed / 61 skipped；迁移为 4 skipped / 35 deselected，数据库场景因无 PostgreSQL 测试配置未执行。real-stack preflight 因缺少 DATABASE_URL 退出 1，没有资源创建。

最初 E2E wrapper 的 --list 因缺少产物目录被安全扫描拒绝，精确结果已保留；仅纯收集改用已有 e2e:raw，实际执行仍带安全扫描。未放宽任何安全门禁，未访问真实 AI 平台。

最终 [final-audit.json](./evidence/final-audit.json) 验证文档包全哈希、链接、JSON/YAML、schema 引用、43 迁移链、143 源文件指纹、保护目录和 manifest 非本任务条目。未跟踪文档、任务源码与结构化快照通过独立临时 Git index 的 diff --check，不污染用户 index；原始日志自带的 EOF 空行和 Vite 尾随空格单独记录并逐字保留。现有未跟踪 GEO-002 任务和目标文档原样保留。

## 4. 状态与限制

本任务 planned → in_progress → **review**；Trellis 与 manifest 状态一致。review 等待人工验收，不是 done；GEO-001/002 仍为 done，其他任务状态/依赖不变。

没有新增 Alembic revision、前滚或数据迁移；源码 head 为 `0043_geo_platform_identity`，运行库未知。真实 PostgreSQL schema、锁/事务/并发/触发器与迁移执行、真实栈 GEO Flow、移动浏览器、容器和完整部署门禁均无通过证据。恢复环境后执行既有命令，不能根据 skip 或 fixture 推断这些边界。

本任务允许记录验证环境阻断，因此不因 Docker/数据库缺失将任务标记 blocked；未触发用户指定的业务冲突、破坏性迁移、指标/状态机/安全改变、必需授权/输入缺失或依赖未完成条件。

直接后续 GEO-004、GEO-005、GEO-101、GEO-201 保持 planned，未实施任何 deliverable。GEO-003 的旧/新模型边界供其各自设计与验收使用。

## 5. 人工验收完成 — 2026-10-01

本会话用户明确表示：“我已经人工审查并接受 GEO-003 的实现与测试证据。”据此将 manifest 的 GEO-003 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，并记录完成日期及接受依据；Task Brief 的当前状态同步更新。

以上 §4 和基线审计文件保留提交人工验收时的历史状态与验证限制。人工接受不将未完成的 make verify、跳过的 PostgreSQL 测试或未执行的真实栈门禁改写为通过。本次只记录 GEO-003 验收，不修改其他任务状态、不实施后续任务、不提交或归档。

本次收尾验证：git diff --check 通过；另外对五个收尾文件使用独立临时 Git index 检查未跟踪文件，diff --check 通过。manifest 除 GEO-003 的 status 外保持原样；SHA256SUMS 仅同步该 manifest 条目，其他哈希不变。
