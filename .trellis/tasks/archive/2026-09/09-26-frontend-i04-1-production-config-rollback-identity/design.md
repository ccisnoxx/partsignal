# I04-1 受控配置与 rollback 身份设计

## Secret boundary

credential owner 最终把真实 OSS 四项写入本地 Git-ignored、`0600` 的 `.env`；受控创建进程只经 SSH stdin 把这四项传入 Hostdzire，不从 `.env.staging` 继承环境身份或 secret。所有新 secret 由 Hostdzire 进程生成并直接写入同目录 `0600` 临时文件；终端、普通日志、Trellis 和对话都不接收值。最终文件通过 Linux no-replace rename 原子安装，目标已存在即失败。I04-1R 已从原 session 恢复 creator/validator/secret-scan 原始执行输入输出及摘要，conclusive review 确认 CSPRNG、`O_EXCL|O_NOFOLLOW`、`RENAME_NOREPLACE`、file/directory fsync 与失败清理证据充分。

## Validation flow

1. 只读证明 hostname、目标缺失、shared/staging path identity 与权限安全。
2. 远端单进程解析 staging、验证真实 Aliyun OSS、生成独立 secret、验证完整键集合和不安全模式、排他写入并原子安装。
3. 独立只读验证最终 metadata、键集合、secret 与 staging/development 分离、URL/CORS、无重复/source/include/CRLF/control/substitution。
4. 在当前 backend image 内以 stdin 瞬时注入 Production env，执行等价 `python -m app.cli preflight-production-config`；不连接数据库或 Redis，不打印 env。
5. 使用当前 release 中与 `main` 字节一致的 `deploy/compose.prod.yaml` 运行 `docker compose ... config --quiet`；不运行 `run/up/stop`。
6. 对脱敏日志保存 exit code、字节数和 SHA-256；扫描本地 Git/Trellis 与远端受控日志边界，禁止匹配 env 文件摘要之外的 secret 派生物。

## AI credential boundary

当前产品把 provider API Key 和敏感 Header 保存在 PostgreSQL `ai_channels` / `ai_channel_headers` 的密文列，env 只持有 32-byte encryption key。clean-init 后新库不会继承旧密文。I04-1R 以 `PRODUCTION_PREPARED` root/operator maintenance CLI 替代不可达的 HTTPS UI/API 假设：credential 只从真实 TTY no-echo 读取，经 stdin pipe 进入固定 API 容器和 backend T1/T2/T3 编排，最终仅密文持久化；不读取 seed password，不新增网络入口。durable attempt、fresh locks、revision provenance 与 activation gate 对未知/并发结果 fail closed。I04-1 不读取旧库、不导出凭据，也不把 bootstrap connection test 或结构 preflight标记为完整真实 AI Gate。

## Rollback identity proof

当前 frontend container 的 full ID、Compose labels、image reference/ID/RepoDigests/platform/health/restart 与归档 `development-rebuild-execution.md`、`step2-source-freeze.md`、`authorization-packages.md`、`package-a1-execution.md` 交叉核对。只有 current runtime identity 与 2026-08-30 canonical V2 rebuild source commit 和验收记录完全一致时，才冻结为下一任务 manifest 的 rollback frontend 输入。

## Stop boundary

本 child 不创建 release/archive/manifest，不 build/pull/retag/remove image，不 reload Nginx，不停止/重建 service，不移动或写业务数据。两项原 blocker 已由 I04-1R 独立复核关闭；I04-1 完成，I04 保持 `in_progress / configuration_ready`。进入 I04-2 前仍必须先完成 Git 收口并在最终 clean candidate 上重新建立 Repository Release Gate。
