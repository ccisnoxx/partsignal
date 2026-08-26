# Frontend V2 Phase 9 Production-like Rehearsal

## 1. 目标与价值

消费已独立验收的 sanitized production snapshot，在专用临时私有环境中恢复隔离 clone，使用包含 legacy routing 的固定 Frontend V2 candidate 执行 production-like 数据与核心业务演练。最终证据必须能证明：production source 未被本 Task 连接或写入、clone 身份与数据规模可追溯、真实外部副作用为零、production object payload 为零、核心 V2/legacy 路径可用，以及 clone 已按单独授权清理或隔离保留。

本 Task 当前只完成规划。规划批准不授权 task.py start、production 访问、外部资源创建、artifact 传输、部署、浏览器登录、清理、commit 或 push。

## 2. 已确认基线

- 本地 main=bcb10d3b33b14c965cc9af1e20705db3cadfe03d，包含已完成的 legacy routing；origin/main=2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9，本地领先 10 个提交。
- 归档证据记录 Staging release mvp-20260825-172239-2a6fd940b848 的外部 Gate=MET；该证据未在本 Task 重验，且该 release 不含本地 legacy routing。
- deploy/scripts/e2e-local.sh 可复用独立 PostgreSQL/Redis/storage/process 与 cleanup 约束，但固定创建空库并执行 seed-demo，不能消费 production snapshot。
- deploy/scripts/restore-verify.sh 可向显式 VERIFY_DATABASE_URL 恢复逻辑备份并做最小检查，但不拥有脱敏、source/target 身份或副作用隔离。
- deploy/compose.staging.yaml 可在专用主机复用 V2 artifact、API、Worker、Redis 和 fake object storage 形态；不得与当前 Staging 共用主机 owner、端口、网络、数据目录或环境文件。
- 先行子 Task frontend-v2-phase-9-production-snapshot-sanitization 独立拥有 raw quarantine、字段级脱敏与 sanitized snapshot；本 Task 不拥有 sanitizer。

## 3. 需求

### R1 依赖与 candidate

1. 子 Task 必须先完成并形成 Gate=MET、sanitized snapshot checksum、schema revision、数据规模摘要、sanitizer identity、source 只读证据和 raw cleanup/隔离证据；任一缺失即不启动本 Task。
2. 固定 candidate 必须来自 clean main，包含 bcb10d3b... 或其后继提交；记录 Git SHA、V2 image ID/checksum、lockfile checksum、API base 与 source-map policy。
3. sanitized snapshot schema revision 必须与 candidate 支持的 revision 一致或可在 clone 上单向迁移到 head；source、quarantine 和 sanitized artifact 不运行 migration。

### R2 专用临时 clone

1. clone 使用专用临时私有环境、独立 PostgreSQL database/role、非 0 独立 Redis DB、独立对象 namespace、独立 session/AI encryption/signing secrets 和唯一 run ID。
2. 不开放公网入口；浏览器只通过环境内执行或单独批准的临时私有隧道访问。不得修改 DNS、Nginx 公网入口或 current。
3. clone 不持有 production source DSN、只读凭据或 raw snapshot；只接收 checksum 匹配的 sanitized snapshot。
4. 仅启动 PostgreSQL、Redis、fake object storage、API、必要 Worker 与 V2 frontend；scheduler 不启动。

### R3 副作用与对象边界

1. CONTENT_GENERATOR=deterministic，OBJECT_STORAGE_BACKEND=development，OSS/真实 AI/邮件/第三方发布凭据为空且网络 egress 被阻断；配置与实际网络两层都要验证。
2. production object payload 零复制。clone namespace 启动时为空；只有本轮带 run ID 的无敏感 fixture 可写入，并按精确 key 清理。
3. sanitized database 中既有 file metadata/关系可用于列表与错误路径，但不得为缺失 production payload 伪造成功或静默回填对象。

### R4 数据与业务演练

1. 恢复后核对 snapshot checksum、schema revision、关键表行数/状态分布/时间跨度与子 Task evidence；只记录聚合和布尔结果，不输出正文或敏感值。
2. 在 clone 上执行 migration-to-head、preflight-integrity、health/smoke、V2 production artifact、核心 real-stack E2E 与代表性 production-like 浏览器路径。
3. 核心范围覆盖 Auth、Product Facts、Content、Publication、GEO、AI Configuration 的禁真实调用路径、System ADMIN/ENGINEER 权限、revision conflict，以及至少一条 legacy→canonical direct/refresh 流。
4. 测试账号只由现有 seed-demo 在 clone 中补充；它只提供 ADMIN/ENGINEER 凭据，不作为 production-like 数据来源。
5. 所有业务写入必须带唯一 run ID 或由现有 E2E owner 可精确识别，并仅落在 clone；失败不自动重试或转向其他环境。

### R5 证据、判定与清理

1. 记录 clone pre/post snapshot、container/image/health/restart、DB revision、Redis DB、对象 key、HTTP/browser 结果、运行耗时及 open P0/P1/P2。
2. 任一身份、隔离、副作用、checksum、schema、权限、业务、对象或 cleanup 前置失败即停止，Gate=NOT_MET；不修复外部环境、不重部署 Staging、不访问 production。
3. clone/database/Redis/object namespace/artifact 的删除必须另取精确授权。未获删除授权时停止服务、撤销访问并按批准期限隔离保留，不得顺手清理。
4. 仅在实际 Gate=MET 时更新 docs/frontend-v2/07-migration-plan.md 与 08-testing-quality-and-acceptance.md；历史 Staging 结论保持原样。

## 4. 范围外

- production snapshot 脱敏实现、raw quarantine 操作或 production object payload 复制；这些由子 Task/已批准 D3 排除。
- production artifact 发布、production cutover、DNS/Nginx/current 写入、Staging fallback/restore、回滚演练或 V1 删除。
- backend、OpenAPI、数据库 schema、权限合同、业务状态机、通用 deployment/rehearsal framework 或新的监控平台。
- 自动 SSH、外部资源创建/删除、artifact 上传、浏览器登录、commit、push、merge或 archive。

## 5. 已批准决策

- D1 数据来源（2026-08-26）：只使用经批准的 production 只读 snapshot；synthetic/demo fixture 不作为数据来源。
- D2 环境（2026-08-26）：使用专用临时私有环境，raw quarantine 与 sanitized clone 分库、分对象 namespace，无公网入口且禁止真实外部副作用。
- D3 对象（2026-08-26）：production object payload 零复制；clone 仅为最小上传/下载验收写入无敏感 fixture。
- D4 任务边界（2026-08-26）：独立子 Task frontend-v2-phase-9-production-snapshot-sanitization 先交付 sanitized snapshot；本 Task 只消费其已验收产物。

## 6. 验收标准

- [x] D1–D4 已确认，无阻塞性的用户决策。
- [x] design.md 冻结依赖、clone、artifact、副作用、对象、验证、停止与 cleanup owner。
- [x] implement.md 将子 Task 前置、仓库准备、外部授权、恢复、演练、判定和 cleanup 拆成独立阶段。
- [ ] 子 Task Gate=MET 且 sanitized snapshot 合同完整。
- [ ] 固定 candidate/artifact 可追溯并包含 legacy routing。
- [ ] clone 身份、独占资源、无公网入口、无 source 凭据与真实外部副作用均有证据。
- [ ] 数据规模/分布与子 Task摘要一致，schema 迁移到 head 且完整性检查通过。
- [ ] 核心 real-stack 与代表 production-like 浏览器路径通过，无未关闭 P0/P1/P2。
- [ ] production payload 零复制；本轮 fixture 对象可精确归属并完成清理或批准隔离。
- [ ] clone 完成精确 cleanup，或按批准期限停止并隔离保留。
- [ ] Task evidence、07/08 文档和实际 Gate 一致，未执行事实未写成通过。
