# A27 验证设计

## 1. 边界

本 Task 是纯环境验证。权威输入仍为现有 `.env`，权威 E2E isolation owner 仍为 `e2e-environment.py`；Task 不增加持久 wrapper、Make target 或配置。

## 2. 子进程环境

1. 用现有 `dotenv_values()` 读取 `.env`，不改变父 shell。
2. 只在内存中把 PostgreSQL/Redis 地址改为宿主可访问地址。
3. 动态扫描 Redis 非 0 logical DB，选择空且无外部客户端的一项。
4. 从当前环境副本删除 `.env` 声明的所有键，再写入两条宿主连接变量。
5. 以该显式环境启动 preflight 与 unit 命令。

该结构直接消除 `set -a`/全量 source 的根因；不需要为一次操作创建脚本。

## 3. 验证与归因

- 环境证据：只输出 `.env`/子进程键交集名称，必须精确为两键。
- 隔离证据：preflight 只读成功，退出后 Redis 仍为空、固定端口 released。
- 行为证据：先运行唯一失败 test，再运行 root `make test-unit`；后者覆盖 backend/V1 visual/V1/V2 unit owner。
- 任一非零时记录环境或具体 test owner并停止；不修复、不重跑、不扩大为 E2E/Gate。

## 4. 关闭算法

```text
clean frozen candidate
AND env intersection == {DATABASE_URL, REDIS_URL}
AND Redis/ports preflight PASS
AND targeted Settings unit == 0
AND make test-unit == 0
AND no sensitive output
AND cleanup complete
=> A27 closed
```

A27 closed 不改变 Phase 8=`NOT_MET`；A28 与新的独立 recheck 仍是后续条件。

## 5. 回滚

没有产品写入。若 evidence/metadata 有误，只反向修改当前 Task/父 metadata 的精确 hunk；不使用 Git 历史改写或 broad cleanup。
