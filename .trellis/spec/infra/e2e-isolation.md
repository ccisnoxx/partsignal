# E2E 运行隔离契约

## 1. Scope / Trigger

本地或 CI 运行真实 PostgreSQL、Redis、API、Worker、对象存储与浏览器的 Playwright
E2E 时适用。每次运行必须拥有独立数据库和临时存储，不能通过清扫共享开发数据恢复
测试环境。

## 2. Signatures

```text
deploy/scripts/e2e-local.sh [playwright arguments...]
deploy/scripts/e2e-database.py create partsignal_e2e_YYYYMMDD_PID
deploy/scripts/e2e-database.py drop   partsignal_e2e_YYYYMMDD_PID
```

## 3. Contracts

- `DATABASE_URL`、`REDIS_URL` 必填；`PARTSIGNAL_E2E_STORAGE_PORT` 可选，默认 `19009`。
- 数据库名必须匹配 `^partsignal_e2e_\d{8}_\d+$`；创建和删除都拒绝其他名称。
- 业务服务、Alembic 和种子命令只使用本次创建的数据库。
- 对象存储和 Celery beat 文件只写入本次 `mktemp -d` 创建的目录。
- 退出时无论测试成功、失败或收到信号，都停止本次进程、删除本次数据库和临时目录。
- 清理输出使用 `E2E_CLEANUP target=value status=deleted`；测试成功但清理失败时，脚本仍以非零状态退出。

## 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 必填连接变量缺失 | 启动前失败，不创建资源 |
| 数据库名不满足 allowlist | 拒绝创建或删除 |
| 迁移、构建、种子、服务就绪或 Playwright 失败 | 保留原失败码并执行清理 |
| 删除数据库或临时目录失败 | 输出失败目标并以非零状态退出 |
| 临时目录不在本次前缀下 | 拒绝递归删除 |
| 共享开发库中存在历史 E2E 数据 | 不做广泛清扫，另行按所有权调查 |

## 5. Good / Base / Bad Cases

- Good：独立数据库迁移和种子成功，真实浏览器完成用例，数据库与临时目录均报告并确认删除。
- Base：Playwright 发现产品缺陷而失败，仍完整删除本次资源并保留原测试失败码。
- Bad：直接对开发库运行后按名称前缀批量删数据，或用 `rm -rf` 删除未校验路径。

## 6. Tests Required

- `sh -n deploy/scripts/e2e-local.sh`。
- `python -m py_compile deploy/scripts/e2e-database.py`。
- 至少运行一个真实 Playwright 用例，确认生产/开发壳层按需就绪。
- 分别验证成功和测试失败路径都输出数据库、存储 `status=deleted`，且对应资源已不存在。

## 7. Wrong vs Correct

```text
Wrong: 共享开发库运行 E2E → 按模糊前缀清扫用户和业务历史 → 忽略清理失败
Correct: 每次创建 allowlist 数据库和 mktemp 存储 → trap 精确清理本次资源 → 清理失败使运行失败
```
