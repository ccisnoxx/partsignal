# A27 环境隔离审计

## 结论

失败 owner 是 recheck 的 shell 环境构造，不是根 `make verify`、产品代码或测试缺陷。最小关闭方式是复用已有两键 allowlist，不新增仓库脚本。

## 证据

- Phase 8 recheck：独立 backend unit `201 passed`；批量导出 `.env` 后的最终 gate backend unit `200 passed / 1 failed`。
- `Makefile`：`verify` 聚合 root targets；Compose 自行使用 `--env-file .env`，`e2e-local.sh` 只要求调用方提供两条连接变量。
- A26 归档 Task 已使用 backend venv 的 dotenv parser 只读取两键且不回显值。
- Phase 4 environment-corrected 归档 Task 已验证同一历史失误和两键纠正路径。
- `.trellis/spec/infra/e2e-isolation.md` 要求 Redis 非 0、空、独占和固定端口 preflight；不允许清理未知 owner。

## 设计约束

- 只在子进程中构造 allowlist，避免污染当前 shell。
- 只记录键名、logical DB 编号、退出码和计数，不记录 URL。
- A27 不运行最终 gate；否则会在 A28 尚未关闭时形成 blocker/gate 重跑循环。
