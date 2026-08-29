# Frontend V2 Phase 9 Production Snapshot Sanitization Execution

## 0. Development Closeout（2026-08-29）

本 Task 因当前开发阶段范围决策终止：outcome=`CANCELLED_BY_SCOPE_DECISION`、Gate=`NOT_APPLICABLE`。这不是执行成功、sanitized snapshot 交付或安全验证完成；原 Gate=`NOT_MET` 的执行历史与 run08 实际结果保持不变。

latest completed attempt 仍为 `pss_20260828_08`：production write=`0`、object payload copied=`0`、retained artifact=`0`、cleanup=`NOT_REQUIRED_NO_TARGETS`。run09 只有本地预授权 packet，未创建、未执行且不再创建；run08 后没有新的 production 访问，现有 evidence 记录没有残留远端 artifact/resource。本结论来自现有执行证据，不是重新访问远端后的全局核验。

以下原始需求作为历史执行合同保留，但不得继续执行。未来 Production Release Readiness 必须基于届时实际生产边界重新立项，不从本 Task 恢复。

## 1. 目标与父任务交付

复用已归档并验收的 `0043_geo_platform_identity` production snapshot sanitizer，实际完成 production 只读导出、隔离恢复、字段级脱敏、fresh restore 独立验证、sanitized manifest 与经精确授权的 cleanup。只有全部完成标准真实满足时，才将 Production Snapshot Sanitization Gate 从 `NOT_MET` 更新为 `MET`，并向父任务 `frontend-v2-phase-9-production-like-rehearsal` 交付可消费的 sanitized production snapshot。

本 Task 不是 Production-like Rehearsal，不启动 API、Worker、scheduler、frontend、对象服务或浏览器。

## 2. 已确认基线

- Task 从 clean `main` 的 `af161997` 创建，唯一临时分支为 `codex/frontend-v2-phase-9-production-snapshot-sanitization-execution`；不 pull、push、merge、archive 或自动删除分支。
- 父任务保持 `planning`；本 Task 是其独立 follow-up child。
- 已归档 sanitizer 实现提交为 `217d011c`，归档提交为 `a56f802e`，二者均在当前 HEAD ancestry 中；归档内容保持历史不变。
- sanitizer SHA-256 为 `124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d`；matrix SHA-256 为 `71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6`。
- Alembic 当前唯一 head 与脚本预期均为 `0043_geo_platform_identity`；脚本锁定 schema signature `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a`。
- 归档 evidence 记录 Python、Ruff、mypy、disposable PostgreSQL self-check、Trellis validation 与 whitespace 检查均通过；本 Task 只核验该证据，不把历史 self-check 冒充 production 执行结果。
- execution host 已确认为 `hostdzire`；source container 的 PostgreSQL server/client 均为 `16.14`，host `15.18` 不用于导出。source profiler 需要另行批准的 one-shot Python client，不能假设 `postgres:16-alpine` 提供 Python runtime。
- latest completed attempt run=`pss_20260828_08` 已在批准窗口通过 host preflight，随后唯一 database preflight invocation 因远端 shell 单引号未闭合而在 `docker exec`/database session 前 fail-closed 停止。未创建resource，未执行mutation/profile/`pg_dump`，production write/object payload=`0/0`、retained artifact=`0`。run08/window不重试、不复用。用户现仅批准在本地预留 run09 与修正 execution packet；新的 production window 尚未授权，Gate=`NOT_MET`。
- run07 artifact handoff 根因已在本地确认：daemon 侧 `docker cp` 不能作为 container `/tmp` tmpfs artifact 的 host 持久化接口；`output_written=true` 只代表 wrapper 在 container 内原子写入。修正后的唯一合同是 container 内 `profile_wrapper.py handoff --expected-run-id <run-id> --input /tmp/source-profile.json` 经 `docker exec` 流式输出到 host partial，再由 host 原子交接；新 wrapper checksum=`d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`。证据与本地复现见本 Task `research/phase-3-local-profile-artifact-root-cause.md`。
- 用户已接受 checksum-verified streamed one-shot client，以及“普通 ext4 只保存 GPG 密文、一次性 encryption secret 仅驻留 `/dev/shm`”的 artifact-level encryption；该设计接受不构成资源创建、production profile/export 或 cleanup 授权。

## 3. 需求

### E1 不可变 artifact 与执行身份

1. 实际执行必须使用归档路径中的精确 sanitizer/matrix，并在执行前后重新核对 commit、SHA-256、revision 和 schema signature；不得复制后修改、增加兼容分支或回写归档 Task。
2. 每次外部执行使用唯一 run ID，并冻结脱敏后的 source label、database revision、只读 role/grants、export window、audit owner、执行 host、PostgreSQL server/client 版本和批准记录。
3. 任何未知 revision、signature/schema/constraint/trigger 漂移、未知表列、artifact checksum 漂移或执行身份不清都立即停止，Gate 保持 `NOT_MET`。

### E2 Production 只读 inventory 与导出

1. production 访问前必须单独报告并取得对精确 source label、预期 revision、只读 role/grants、export window 与 audit owner 的授权；凭据只从仓库外安全注入。
2. role 除已批准的既有 `PUBLIC EXECUTE` baseline 外，只显式获得本次 catalog inventory 与逻辑导出所需的 `CONNECT`、schema `USAGE`、业务对象 `SELECT` 权限；不得有效拥有 `CREATE`、`TEMP`、DML/DDL、replication、superuser、role inheritance 或可切换到写角色的能力。该唯一例外固定为 user-schema function `PUBLIC EXECUTE=29`、`SECURITY DEFINER=0`、本 run 不调用这些 function、双重只读且全语句审计；任一 count、function identity 或调用证据漂移立即停止。
3. 所有 production session 强制 `default_transaction_read_only=on`；inventory、聚合 profile 与 `pg_dump` 必须来自同一受控只读 snapshot identity，避免把在线变化误判为脱敏差异。
4. 审计 owner 必须证明该 role/window 仅出现批准的 catalog、`SELECT`、`COPY`/逻辑导出行为；本 Task 不以在线库全局 pre/post 相等证明零写入。
5. raw dump 仅写入获批准、容量足够、加密且受控的 quarantine path；目录访问边界明确，文件权限为 `0600`，记录安全 identity、字节数和 SHA-256，不记录数据内容。
6. 不连接、读取、下载或复制 production object storage；production object payload copied 必须为 `0`。

### E3 隔离 restore 与脱敏

1. quarantine 环境创建前单独批准 exact host、run ID、database、role、path、owner、磁盘加密、私有访问、无公网监听和 egress deny 证据。
2. raw snapshot 只恢复到精确 `quarantine_<run-id>` database/role；不运行 migration，不启动任何应用或对象服务。
3. restore 后重新核对 raw checksum、revision、schema signature、constraints/triggers 与 source snapshot 聚合 profile；不匹配即停止。
4. 仅在 quarantine database 上运行归档 `sanitize`，完成后在独立 session 运行归档 `verify`；任何失败必须整体回滚或停止，不生成可消费 manifest。

### E4 Fresh restore 独立验证与 profile

1. 从已通过 quarantine verifier 的数据库生成 `0600` sanitized SQL.gz，记录仓库外受控路径、字节数与 SHA-256。
2. 在精确 `verify_<run-id>` fresh database/role 恢复 sanitized dump，运行 `restore-verify.sh` 和归档 `verify`；fresh database 不复用 quarantine database 或 role。
3. 使用任务内显式、只读的聚合查询合同，对同一 source snapshot identity、raw quarantine、sanitized quarantine 与 fresh verify 比较：精确 row count、登记关系 fan-out、状态/枚举分布、revision 分布、时间范围、null 比例与允许的长度桶变化。
4. 只有 matrix 声明的 `sessions -> 0`、敏感字段值替换、AI channel/model 禁用/未测试及对应允许字段清空可变化；关系、其余 row count、状态、revision、timestamp 和长度桶必须符合 matrix。
5. profiler、verifier 和命令输出只含字段名、聚合数字、布尔、revision、signature 和 checksum；禁止输出样本、原始字符串、正文、URL、PII hash、credential 或 DSN。

### E5 Manifest、Gate 与父任务合同

1. 生成不含敏感值、DSN、credential、业务正文、原始 URL、原始用户信息或 object payload 的 sanitized manifest。
2. manifest 至少包含 run ID、脱敏 source/target identity、sanitized path/size/SHA-256、revision/signature、sanitizer/matrix commit 与 SHA-256、source read-only/audit 结论、profile 比较结论、fresh verifier/restore 结果、production object payload copied=`0`、cleanup 状态、保留 owner/期限和 open P0/P1/P2。
3. sanitized artifact 是唯一允许跨 Task 保留的 snapshot；父任务只接收 manifest 与 checksum 匹配的 sanitized artifact，不接收 raw dump、source DSN、production credential 或 production object payload。
4. open P0/P1/P2 必须为 `0/0/0`，且全部验收条件满足后才能写 Gate=`MET`；任一未知、失败或 cleanup 未完成均保持 `NOT_MET`，父任务不得启动。

### E6 精确 cleanup

1. cleanup 前逐项报告并取得 exact run ID、host、owner、database、role、path、checksum 和 secret identity 的删除授权；sanitized artifact 不在本 Task cleanup 范围。
2. 仅删除获授权的 raw dump、quarantine database/role、verify database/role 和临时 secret；禁止 broad path、通配符、共享资源删除或候选路径 fallback。
3. 每个目标删除后独立复核不存在；任一 cleanup 失败即记录实际状态并保持 Gate=`NOT_MET`。

## 4. 范围外

- 修改 production 数据、schema、migration、权限或部署。
- 复制 production object payload，或伪造缺失 object bytes。
- Production-like Rehearsal、API/Worker/scheduler/frontend/对象服务/浏览器运行。
- 修改 backend 产品逻辑、OpenAPI、`contracts/database.md`、sanitizer 归档历史或建立通用 sanitizer/deployment framework。
- 修改 Staging、production、DNS、Nginx、`current` 或发布 artifact。
- 未经精确确认的 cleanup、自动 commit、push、merge、archive 或删除分支。

## 5. 验收标准

- [x] 最终 outcome=`CANCELLED_BY_SCOPE_DECISION`、Gate=`NOT_APPLICABLE` 与停止原因已记录。
- [x] run08 零写入、零 object payload、零 retained artifact 和无 cleanup target 的历史事实保持不变。
- [x] run09 未创建、未执行且不再创建；run08 后没有新的 production 访问。
- [x] 当前 evidence 没有残留远端 artifact/resource，且未把该记录外推为重新核验后的全局状态。

- [x] clean `main` 基线、唯一临时分支和父子 Task 关系已确认。
- [x] sanitizer/matrix commit、checksum、revision/signature 与归档 self-check evidence 已完成本地只读核验。
- [ ] source 只读 role/session/snapshot/audit 证据完整，production 零写入结论限定准确。
- [ ] raw snapshot identity、加密路径、`0600`、字节数、checksum 与 quarantine identity 可追溯。
- [ ] quarantine restore、sanitize 和独立 verifier 全部通过。
- [ ] sanitized dump fresh restore、`restore-verify.sh` 与独立 verifier 全部通过。
- [ ] source/raw quarantine/sanitized quarantine/fresh verify 聚合 profile 的全部允许与禁止变化符合 matrix。
- [ ] sanitized manifest 完整且 production object payload copied=`0`。
- [ ] open P0/P1/P2=`0/0/0`。
- [ ] raw/quarantine/verify/临时 secret 已按精确授权清理并复核不存在。
- [ ] sanitized artifact 按批准 owner/位置/期限保留，父任务可独立校验并消费。
- [ ] required validation 有实际执行证据，Task 文档、状态与真实结果一致。
- [ ] 仅在以上条件全部满足后 Gate=`MET`；否则保持 `NOT_MET`。
