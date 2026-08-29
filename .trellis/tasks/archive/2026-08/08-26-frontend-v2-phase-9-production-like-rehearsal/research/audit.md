# Production-like rehearsal 规划盘点

## 1. 审计范围与基线

- 只读检查当前仓库、Phase 9 权威文档、已归档 cutover/staging/legacy 任务、现有 backup/restore/E2E 脚本与 Staging Compose。
- 本地基线：`main=bcb10d3b33b14c965cc9af1e20705db3cadfe03d`；`origin/main=2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`；创建 Task 前工作树 clean。
- 本次未访问网络、未 SSH、未读取真实凭据、未连接 Staging/production、未部署、未创建或删除外部资源。

## 2. 已有可复用 owner

| 能力 | 当前 owner | 可复用边界 | 不能证明 |
| --- | --- | --- | --- |
| PostgreSQL 逻辑备份 | `deploy/scripts/backup.sh` | `pg_dump --clean --if-exists --no-owner`，backup 目录权限为 `077` | source 只读、脱敏、production 身份、target 隔离 |
| 显式 target 恢复 | `deploy/scripts/restore-verify.sh` | 只向 `VERIFY_DATABASE_URL` 恢复并检查 `alembic_version`、`users` | source/target 不同、敏感字段处理、对象数据、业务正确性 |
| 本地 real-stack 隔离 | `deploy/scripts/e2e-local.sh`、`e2e-environment.py`、`e2e-database.py` | 独立数据库、非 0 Redis DB、临时 storage、端口 preflight、精确 cleanup、fake AI | 恢复既有 snapshot；它固定执行 migration 与 `seed-demo`，不能直接用于 production source |
| Staging 形态 | `deploy/compose.staging.yaml` | V2 frontend、PostgreSQL、Redis、fake OSS、API/worker/scheduler 的现有拓扑 | 专用 rehearsal namespace、scheduler 禁用、真实 production 等价性 |
| 核心已部署验收 | `docs/deployed-full-functional-acceptance-plan.md` | 测试对象隔离、禁止真实业务账号/第三方发布、状态机与权限检查 | production 数据规模；该计划会写测试数据，不是只读数据 rehearsal |
| V2 route/build gate | 现有 Vitest、Playwright、container smoke | canonical/legacy route、production artifact、SPA/cache/CSP 的局部合同 | production-like 数据分布、远程运行态或 source 零写入 |

## 3. 数据安全与副作用缺口

当前 schema/实现至少存在以下需显式处理的数据类别：

- `users.password_hash`、session token hash、must-change 与用户身份字段；
- AI channel 的 `api_key_ciphertext`、加密 custom headers、endpoint 与模型配置；
- 平台账号、URL/域名、对象引用及潜在访问标识；
- Product fact/source、Content Markdown、Prompt、GEO observation、publication snapshot 与 audit summary 等可能包含客户或未公开内容的正文类数据；
- 对象存储中文件本体与数据库 metadata 的一致关系。

现有 audit redact 只约束审计输出，不是 snapshot sanitizer。仓库没有字段级脱敏器或“副作用总开关”。Staging Compose 默认启动 worker 与 scheduler，并允许 backend egress；仅把 OSS 指向 fake service 不能证明 AI、邮件或第三方发布全部被禁止。

因此安全最小方案不是立即编写通用 sanitizer，而是先由数据 authority 冻结 source 与字段合同；若选择真实 snapshot 且不能用数据库原生、一次性受审计的变换完成脱敏，再拆独立数据安全 Task。

## 4. Candidate 与环境事实

- 最新本地 legacy routing 只存在于 `bcb10d3b...`；既有 Staging Gate=`MET` 的固定 candidate/release 是 `2a6fd940...` / `mvp-20260825-172239-2a6fd940b848`。
- 归档证据可作为历史基线，但本 Task 未重验当前远程状态。
- 若本轮要验证 legacy→canonical，必须先形成包含 `bcb10d3b...` 或后继提交的固定 artifact；这不自动授权 push 或部署。
- `current` 不是流量开关，production 真实入口与 publisher 仍无仓库证据；本 Task 不应扩展为 production cutover。

## 5. 最小 rehearsal Gate

只有同时具备以下证据才可判定 `MET`：

1. source identity、只读权限、强制 read-only session 与 export role 审计；
2. target identity、source/target 解析后不同、独占数据库/Redis/对象 namespace；
3. snapshot checksum、脱敏规则版本、脱敏后抽样与敏感字段 denylist 检查；
4. scheduler/AI/真实 OSS/第三方发布禁用证据；
5. 经批准的规模/分布指标与导入后对比；
6. 固定 V2 artifact 上的 health、关键 route/workspace、权限、revision conflict 与代表 legacy redirect；
7. 运行期间所有业务写入属于 target，source export identity 没有写权限或写语句；
8. cleanup 完成，或 target 已停止并按批准期限隔离保留。

任一安全关键值仍是占位符、任一外部授权缺失或任一 P0/P1/P2 未关闭，即为 `NOT_MET`；不得用普通 demo fixtures 或历史 Staging Gate 替代。

## 6. 已确认决策与任务边界

用户于 2026-08-26 确认使用经批准的 production 只读 snapshot，并在导入最终隔离 clone 前完成脱敏；synthetic/demo fixture 路径已排除。

用户同时确认使用专用临时隔离环境：raw quarantine 与脱敏 clone 分库、分对象 namespace，无公网入口且禁止真实外部副作用；现有 Staging/production owner 不复用。

用户批准 production object payload 零复制：clone 只保留经脱敏的数据库 metadata/关系，并仅为最小上传/下载验收写入无敏感 fixture；真实文件正文与体积分布不计入本 Task Gate。

用户批准把字段级脱敏拆为独立子 Task `frontend-v2-phase-9-production-snapshot-sanitization`。该子 Task 已创建并在自身 PRD/design/implement 中冻结 source、quarantine、sanitizer、fresh verify、manifest 与 cleanup 合同；本 rehearsal Task 不拥有 sanitizer，只消费其 Gate=`MET` 的 sanitized snapshot。当前没有阻塞规划的用户决策。
