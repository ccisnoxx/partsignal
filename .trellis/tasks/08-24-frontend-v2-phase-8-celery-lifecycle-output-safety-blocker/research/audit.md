# A30 规划审计

## 已确认事实

- final recheck 只记录敏感类别、次数与 owner，没有将连接值写入 Task artifacts。
- 回显 owner 是 `deploy/scripts/e2e-local.sh` 启动的 Celery CLI，不是 `backend/app/config.py` 的 Settings repr/ValidationError。
- runner 当前直接执行：
  - `celery -A app.worker:celery_app worker --loglevel=WARNING ...`
  - `celery -A app.worker:celery_app beat --loglevel=WARNING ...`
- 当前安装版本的 Celery 顶层命令支持 `-q/--quiet`；worker/beat 的 `--logfile` 默认 stderr。
- 创建 logfile 会把敏感输出从终端搬到磁盘，不满足最小安全目标。原生 quiet 是优先验证的最小机制。

## Owner 与边界

runner 拥有第三方进程如何连接父 stdout/stderr；Celery app 继续拥有真实 broker URL 与任务配置。A30 只改变 CLI 的 lifecycle 展示，不改变 broker、任务、日志级别或业务失败合同。

若 `--quiet` 仍回显连接值，或同时隐藏了 Task/cleanup 的真实失败，本计划的最小方案不成立。此时必须停止并重新评审，不引入事后 regex filter 或持久 logfile。

## 验证边界

- `bash -n deploy/scripts/e2e-local.sh`。
- 静态确认 worker/beat 都使用顶层 quiet，且没有重定向/新 logfile。
- 使用 A27 两键 allowlist、动态 Redis 与现有 `PARTSIGNAL_E2E_V2_SPEC` 定向模式运行一个会触发 Worker 的 V2 real-stack owner；具体 spec 在启动时从既有真实任务用例中选择。
- 进程输出在内存中受控审查，只报告 Redis URI/连接值类别命中数，不保存或打印匹配值。
- 记录 database、Redis、storage、services、ports cleanup；不运行根 gate。
