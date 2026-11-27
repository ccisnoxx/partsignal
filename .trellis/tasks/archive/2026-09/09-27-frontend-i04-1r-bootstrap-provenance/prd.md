# I04-1R Production bootstrap 与 env provenance 修复

## Goal

恢复并固定 I04-1 Production env creator/validator/secret-scan 的原始执行证据；实现由 Hostdzire credential owner 在 maintenance 状态下安全注入并验证真实 AI Channel 的 Production bootstrap CLI，解除 I04-1 两项 high-risk review blocker，但不进入 I04-2、release、maintenance 或 cutover。

## Requirements

- 从原始 Codex session JSONL 恢复实际执行的 tool-call input/output，保存 call ID、session identity、源文件 SHA-256、证据文件 SHA-256 与脱敏检查；不得重写为仅含结论的伪证据，也不得保存任何 secret 值。
- 不重建、覆盖或轮换现有 `/root/partsignal/shared/.env.production`。provenance 只证明既有创建/验证实现；远端本轮最多做只读 metadata 核对。
- Production bootstrap 的权威阶段 owner 仍是 `prepare-production-data.py` 持久状态机。只有同一 run ID、manifest/candidate identity 且 phase=`PRODUCTION_PREPARED` 时允许调用；不得由 backend 自报或仅靠环境变量伪造阶段。
- credential owner 必须在 Hostdzire 交互式 no-echo TTY 输入 AI credential。credential 不得进入 argv、environment、shell history、日志、Trellis、普通文件、process title、Docker inspect 或对话；它只允许经过 host 进程内存、内核 pipe、Docker exec transport、backend/provider HTTP buffer，最终仅以批准的密文形式持久化。
- host-side bootstrap 与 backend maintenance command 必须通过 stdin 传递 credential，使用现有 AI Channel/Model schema、URL/SSRF 校验、`CredentialCipher`、数据库事务与审计实现；禁止直接拼 SQL、明文落盘、回显、兼容回退或旁路加密。
- bootstrap 必须为 clean-init 一次性路径：fresh Production database 中创建明确的 channel/model 配置，执行真实 model connection test，只有 test=`PASSED` 才允许启用 model/channel；任何已存在目标、部分配置、revision 冲突、provider 失败或重复执行都必须 fail closed，不覆盖既有 credential。
- 非 secret channel/model 参数可以通过明确 CLI 参数提供，但必须完整校验；不得从名称、URL、品牌或环境猜测协议/model。request parameter/header 如进入范围，必须遵守现有保留字段和敏感 Header 合同。
- 结果输出只能包含固定状态、channel/model UUID、revision、test status、enabled 状态、request ID 与 configured 布尔值；不得包含 base URL、model credential、Header 值、错误响应正文或 secret 片段。
- 失败必须保留可恢复状态：创建事务失败不得留下半配置；外部连接测试失败可保留明确停用、model=`FAILED` 的配置供调查，但不新增永久失败审计；重复 bootstrap 必须拒绝，不自动重试或替换 credential。若数据库可能已提交但 host 未收到结果，只能做只读核对或恢复，不能凭输出缺失推断可重试。
- 更新 Hostdzire runbook、部署自检与 backend tests，明确 bootstrap 位于 `PRODUCTION_PREPARED` 与 External Services Gate 之间；External Services Gate 只有后续真实 AI/OSS 验收全部通过才可记为 `MET`。
- 不修改 OpenAPI 公共 HTTP API；CLI 是 root/operator maintenance boundary。不得削弱现有 Admin+CSRF 浏览器合同或把 CLI 暴露为网络端点。

## Acceptance Criteria

- [x] creator、validator、final secret-scan 的原始 tool-call input/output 已保存为脱敏、可哈希证据，能直接核对 CSPRNG、secret 长度、`O_EXCL`、`O_NOFOLLOW`、`RENAME_NOREPLACE`、file/directory fsync、清理/失败路径、validator 与 scan 范围。
- [x] provenance evidence 与原 session call ID/output 一致，真实 OSS 值匹配数为 0；I04-1 `PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE` 经 fresh review 关闭。
- [x] host-side CLI 只在匹配候选的 `PRODUCTION_PREPARED` 下运行，并从交互式 no-echo TTY 读取 credential；non-TTY、错误 phase/candidate、重复/部分配置全部退出非零且不覆盖数据。
- [x] backend maintenance command 复用当前 service/schema/encryption/audit 边界，以 T1 创建事务、T2 外部测试、T3 启用事务完成 bootstrap；输出严格脱敏，不读取 seed admin password，也不依赖公网/final Nginx。
- [x] host state 在启动 backend 前持久化单次 `ai_bootstrap_attempt=STARTED`，只有完整成功结果才更新 `SUCCEEDED`；明确失败为 `FAILED`，结果未知保持 `STARTED`。任何已有 attempt 都拒绝再次 bootstrap，clean-init activation 只接受结构合法的 `SUCCEEDED`。
- [x] 目标 unit/integration/deploy-script tests 覆盖成功、no-echo 输入、非 Production、stdin/TTY 失败、phase/candidate mismatch、重复执行、provider failure、事务/停用状态、revision/锁交错与 secret non-disclosure。
- [x] docs、deploy self-test、CLI help 与实际行为一致；External Services Gate 保持 `NOT_RUN`，没有把 bootstrap connection test 冒充完整 AI/OSS Gate。
- [x] fresh `critical_reviewer` 为 `NO BLOCKER`；I04-1R 标记 completed，I04-1 两项 blocker 已关闭，等待最终 Git/Repository Release Gate 收口。

## Non-goals

- 不创建 release/manifest，不 build 镜像，不进入 maintenance，不停止/重建容器，不 quarantine、clean-init、activate 或 reload Nginx。
- 不执行真实 credential bootstrap，不读取用户的真实 AI credential，不调用真实 provider，不改变 Hostdzire 数据库或现有 env。
- 不提交或推送 Git，除非后续完成验收且授权范围仍满足。
