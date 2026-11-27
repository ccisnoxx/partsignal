# I02-1 设计

- `e2e-local.sh` 用 Python `secrets.token_hex(16)` 生成数据库名 run ID 和独立 owner token；名称保持在 PostgreSQL 63 字节限制内。
- `e2e-database.py create` 在 `CREATE DATABASE` 成功后写入 database shared-object comment 作为 owner marker；`drop` 先从 `pg_database` 读取 marker，只有与调用 token 精确匹配才强制删除。
- shell lifecycle 可以在 create 命令非零后进入 cleanup，但删除权由 PostgreSQL owner marker 决定。duplicate 数据库缺少本运行 marker，因此显式拒绝删除；成功创建并标记后发生的客户端失败仍可验证并清理。
- harness 用文件状态模拟 PostgreSQL 的存在性与 owner marker，并执行五个确定性场景：collision 不误删、post-create client failure 仍清理、drop failure 不假成功、pre-Playwright TERM 清理，以及 handler 恢复入口 TERM 不丢失退出码。
- setup 从首个受控临时目录建立后安装 EXIT/INT/TERM handler；Playwright lifecycle 临时接管信号转发，并在最终一次信号状态判定前恢复调用方 handler。
