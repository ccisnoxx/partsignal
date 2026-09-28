# I04-1 Production 配置与 rollback identity

## Goal

在 Hostdzire 受控创建并验证固定 Production env，冻结上一份已验证 V2 rollback frontend identity，不进入 release 或 cutover。

## Requirements

- 只在 SSH alias `hostdzire` / hostname `scrapy` 操作固定目标 `/root/partsignal/shared/.env.production`；目标必须预先不存在，parent path 不含 symlink，文件须以同目录 `0600` 临时文件、`fsync` 和 no-replace 原子 rename 创建为 `root:root 0600` 普通文件。
- `.env.staging` 只允许在远端受保护进程内解析；输出仅限键名、固定枚举、安全布尔状态、字节数与 SHA-256。只复用经过 HTTPS/host 检查的真实 Aliyun OSS 配置和不含环境身份的稳定恢复参数。
- 独立生成 PostgreSQL、session、AI encryption、upload signing 与两个 seed account secret；禁止复用 development/staging secret、fake storage、local HTTP、deterministic generator、不安全 Cookie 或 staging CORS。
- 验证键集合、重复键、控制字符、shell substitution/source/include、URL/host、CORS、secret independence、Settings、`python -m app.cli preflight-production-config` 和 Production Compose `config --quiet`；不得启动或重建 service，也不得访问当前 PostgreSQL/Redis 写路径。
- 明确真实 AI provider credential 不属于 env：clean-init 到达 `PRODUCTION_PREPARED` 后，由 credential owner 通过 I04-1R 的 root/operator no-echo bootstrap CLI 直接创建并测试新 AI Channel；服务端使用 Production `AI_CREDENTIAL_ENCRYPTION_KEY` 加密入库。不得从旧数据库解密、导出、猜测或经聊天传递。
- 只读冻结当前运行 frontend 的 container/project/service/reference/image ID/全部 RepoDigest/platform/health/restart，并用 2026-08-30 归档 build/release/验收记录证明它来自 canonical V2 和 commit `a663bcce9fd49da9c5aea7f257372fc318447234`。
- 不构建 release、不生成 manifest、不进入维护窗口、不修改当前容器/Nginx/数据/`.env.staging`，不 quarantine、不 clean-init、不删除或 retag rollback image。
- 完成后安排 fresh `critical_reviewer` 独立只读高风险复核；只有 `NO BLOCKER` 才完成本 child 并把 I04 推进到 `configuration_ready`。

## Acceptance Criteria

- [x] `.env.production` 是 `root:root 0600` 普通非 symlink 文件，所有 parent component 非 symlink，排他创建与同文件系统原子安装得到证明。
- [x] Production 配置静态校验、当前 Settings 加载、脱敏 CLI preflight 和 Compose `config --quiet` 全部退出 `0`，日志只包含允许的状态字段并记录 SHA-256。
- [x] 真实 OSS 必要键已安全配置；External Services Gate 仍准确为 `NOT_RUN`，没有把结构配置误报为真实 OSS/AI Gate。
- [x] 真实 AI credential 的后续安全注入路径明确且不经过聊天、旧数据库凭据导出或猜测。
- [x] rollback frontend reference、full image ID、全部 RepoDigest、`linux/amd64`、source commit 与历史 V2 验收身份一致，并注明 I04 完成前不得删除或改 tag。
- [x] secret scan 没有发现 Production env 内容进入仓库、Trellis、普通日志或命令记录。
- [x] fresh high-risk review 为 `NO BLOCKER`；child 标记 `completed`，I04 保持 `in_progress / configuration_ready`，总体任务保持 `in_progress`，下一任务为 I04-2 release freeze 与实际 clean-init cutover。

## Notes

- Repository Release Gate 与完整 `make verify` 的输入未变化，本 child 不机械重跑。
- 任何路径/权限不安全、真实 OSS 配置缺失、Settings/preflight/Compose 失败、AI 安全注入路径缺失、rollback identity 无法证明或需要修改产品/部署合同，均记录 child blocker 并停止，不进入 cutover。
- 2026-09-27 首轮 critical review 的两项 blocker 已由 I04-1R 恢复的 provenance 与 Production bootstrap CLI 解除；conclusive fresh review 为 `NO BLOCKER`。真实 provider/External Services Gate 仍留给 I04-2，未提前执行或标记 `MET`。
