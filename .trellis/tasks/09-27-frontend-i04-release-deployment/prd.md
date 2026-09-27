# I04 发布准备与 Hostdzire clean-init 部署

## Goal

把 I03 已验证候选安全地 fast-forward 到 `main` 并推送，在 `hostdzire` 上从不可覆盖 release 完成一次可恢复的 Production clean-init，将 `https://geo.962850.xyz` 切换到 Frontend V2、真实 API、真实 AI/OSS 以及健康的异步服务，并保存可审计的发布、回滚和观察证据。

## Fixed boundaries

- 本地候选：`/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`；原检出区：`/Users/sc/PycharmProjects/partsignal`。
- 总体基线 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`；I03 产品候选 `387b802d28b539baabfce7229097f333bad26b6b`；I03 收尾 HEAD `a4c15a535f21621188a61f076cf7856c14509d42`。
- 远端只使用原生 OpenSSH alias `hostdzire`；应用路径 `/root/partsignal`，Production env `/root/partsignal/shared/.env.production`，数据根 `/root/partsignal-data`，quarantine `/root/partsignal-data-quarantine/<run-id>`。
- Compose project 固定为 `partsignal-staging`；API、Frontend 回环分别为 `127.0.0.1:19000`、`127.0.0.1:19080`；公网入口固定为 `https://geo.962850.xyz`。
- PostgreSQL 是业务状态唯一来源；Redis 仅作 Celery broker；Markdown 是正文唯一可编辑来源；AI 只能创建草稿。
- 不读取、复制、打印或记录任何私钥、Production env 值、Cookie、CSRF、数据库/账号密码、OSS AccessKey、AI token 或 session/encryption secret。

## Requirements

1. 只有在候选与原检出区干净、`origin/main` 无未知提交、候选为其严格后代且可 fast-forward 时，才把候选整合进 `main` 并非 force push；任何分叉或 push 拒绝均停止。
2. 最终 clean `main` 必须完成本轮 Repository Release Gate；I03 的完整 `make verify` 只在产品代码、部署配置、依赖和环境输入未变化时复用。
3. 在远端写入前完成 Hostdzire 只读 inventory；目标身份、路径、Compose project、Nginx target、数据 device、env 0600/非 symlink、rollback image、RepoDigest 能力或资源不合格即停止。
4. 从 clean、已推送的 `main` 生成不可覆盖 release ID、cutover run ID、可复现源码归档和由权威脚本生成的 0600 manifest；候选 backend、Frontend V2 和上一份已验证 V2 rollback frontend image 均须有可验证 image ID 与非空 RepoDigest。
5. cutover 前由 fresh `critical_reviewer` 只读复核 Git/release/manifest/image/env/inventory/Nginx/clean-init/恢复与删除边界；`BLOCKER` 不进入维护窗口。
6. 维护配置与最终 Nginx 均须同目录临时文件、同文件系统原子替换、保留不可覆盖备份、`nginx -t` 后 reload，并记录 checksum、owner、mode 与公网证据。
7. 维护窗口内按 scheduler、worker、api、frontend、fake-oss、postgres、redis 顺序精确停止旧容器；确认无写入或活动挂载后，以同一 run ID 原子 quarantine postgres/redis/objects，不删除旧数据。
8. 必须通过候选 release 的 `deploy/scripts/deploy.sh` 以 `clean-init` 完成 config、image identity、数据库/Redis、preflight、migration、integrity、initialize-accounts、API/Frontend 和 `PRODUCTION_PREPARED`；不得拆分 Compose 命令绕过脚本。
9. 真实 AI/OSS Gate 必须实际通过且无 fake/deterministic adapter 才能记为 `MET`；否则不启动 Worker/Scheduler，并在维护时限内恢复旧运行态。
10. Gate 为 `MET` 后以 `activate-production.sh` 启动 production-async，进入 `PRODUCTION_INITIALIZED`，再原子安装最终 Nginx；最终不得代理 19001、`/object-storage/` 或 V1 静态 root。
11. 完成回环、公网、独立浏览器、权限、受控写、AI/OSS、artifact、安全头、容器、migration、状态、日志和多采样观察验收；T0 后 60 分钟内必须得到已验证新 Production 或已验证恢复的旧运行态。
12. 成功后保留当前 release、manifest、env、当前镜像、至少一个 manifest rollback frontend image 与 quarantine；只可按精确 ID 清理无运行/回滚职责的旧对象，禁止宽泛 prune。
13. 最终 fresh `critical_reviewer` 对完整证据给出 `NO BLOCKER` 后，才完成 I04 与总体前端重新开发任务；允许最后提交并非 force push 仅含 Trellis 收尾记录的 `main` commit。

## Stop conditions

- host key 冲突；Git 分叉、非 fast-forward 或 push 被拒；候选/归档/manifest/image ID/RepoDigest 身份不一致。
- Production env 缺失或安全配置不合格；Compose project、Nginx target、数据路径/device/mount 漂移；rollback image 或主机资源不符合 runbook。
- 真实 AI/OSS Gate 不能达到 `MET`；migration、integrity、initialize-accounts、health、Nginx、浏览器或安全验收失败。
- 需要修改产品代码、公共合同、migration 或部署脚本。

触发停止条件后不绕过、不猜测、不伪造 Gate；若已进入维护窗口，使用同一 run ID 恢复旧运行态，保留证据并把 I04 记录为 blocker，总体任务继续 `in_progress`。

## Acceptance Criteria

- [ ] 最终 release 来自 clean、已推送且与 `origin/main` 相同的 `main`，归档、manifest、commit、tree、schema、tracked deploy/Nginx 文件与 image identity 可验证。
- [ ] Repository Release Gate 本轮全部通过，记录退出码、计数、日志和 SHA-256；I03 `make verify` 复用边界明确。
- [ ] Hostdzire clean-init 完成，状态为 `PRODUCTION_INITIALIZED`；PostgreSQL、Redis、API、Frontend、Worker、Scheduler healthy，无 Production fake-oss 或 V1 owner。
- [ ] maintenance/final Nginx 两次原子切换均有 checksum、备份、`nginx -t`、reload 和公网证据。
- [ ] 公网、浏览器、权限、受控写、AI/OSS、artifact、安全头与观察验收通过，且 secret scan clean。
- [ ] quarantine、失败恢复能力、manifest rollback frontend image 和部署审计证据均保留。
- [ ] fresh 高风险复核为 `NO BLOCKER`，I04 和总体前端重新开发任务均标记 `completed`。

## Historical evidence reused

- I03 产品候选 `387b802d` 的唯一完整 `make verify`：status `0`，SHA-256 `f7ad5f9a1100bd5fa611f59b1caf4e5935f77deb9c920332e1e95b2d88cc6794`；backend unit 683、Vitest 91/848、PostgreSQL integration 337、real-stack 21、fixture 494 passed/44 skipped。
- pre/post 资源快照逐字一致且全部为零；fresh review `NO BLOCKER`，audit `20260927T054941Z-i03-l8-fixed-candidate-fresh-high-risk-review-45c03229`。
