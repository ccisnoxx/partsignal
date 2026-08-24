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

## 执行证据

- 固定候选：clean `main` 的 `9514775eea6f916bfc4d3c04512c241b72ca30fd`。
- 子进程从当前环境移除 `.env` 声明的所有键，再加入宿主连接变量；与 `.env` 的键交集精确为 `DATABASE_URL,REDIS_URL`。
- Redis logical DB 由运行时扫描动态选择为 7；现有 `e2e-environment.py preflight` 在 `2026-08-24 11:47:05 +08:00` 一次通过，exit `0`。
- 定向 Settings unit 在同一环境一次通过：`1 passed`，耗时 `1s`，exit `0`。
- 根 `make test-unit` 在同一环境一次通过：backend `201 passed`、V1 Vitest `205 passed`、V1 visual contract `24 passed`、V2 Vitest `463 passed`，共 `893 passed`；`11:47:06`—`11:51:29 +08:00`，耗时 `262s`，exit `0`。
- 输出人工核查未发现连接 URL、credential、Cookie、CSRF、headers/body、storage state 或敏感正文；没有声称存在全局 secret scanner。
- 收尾只读检查证明 Redis DB 7 为 `dbsize=0`、无外部客户端，端口 `8000/9001/5173/4173/4174/19009` 全部 released；本 Task 未创建 database、storage 或服务进程，也未删除任何 Redis 数据。
- 首次收尾辅助命令因尝试按 Python 模块名导入带连字符的文件而在连接资源前退出；随后改为自包含只读检查。没有重跑 preflight、定向测试或根 unit。

## 判定

A27=`CLOSED`。Phase 8 继续为 `NOT_MET`；A28 与后续经单独批准的 Exit Gate recheck 仍未完成。本 Task 未运行 `make e2e` 或 `make verify`。
