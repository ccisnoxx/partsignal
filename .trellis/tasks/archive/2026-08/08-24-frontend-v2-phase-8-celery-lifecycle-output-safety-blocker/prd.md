# Frontend V2 Phase 8 Celery Lifecycle Output Safety Blocker

## Goal

A30：在 E2E runner 的 Celery worker/beat lifecycle owner 关闭 Redis 连接值回显，同时保留真实任务执行、失败可诊断性、精确 cleanup 和现有配置语义，不引入全局 scanner 或输出后处理框架。

## Background

- Phase 8 final recheck 在 runner 输出中观察到两次 Redis 连接值回显：一次来自 Celery 启动 banner，一次来自关闭诊断。
- `deploy/scripts/e2e-local.sh:110-114` 直接启动 worker 与 beat；两者使用 `--loglevel=WARNING`，但 Celery CLI 仍会向父进程输出 lifecycle 信息。
- A28 只保证 Settings repr、Pydantic ValidationError 与受控 Python failure output，不拥有第三方 Celery CLI 输出。
- 当前安装的 Celery 顶层 CLI 原生提供 `-q/--quiet`；worker/beat 也提供 `--logfile`。优先验证原生 quiet，因为它不创建含连接值的第二份日志文件。
- A30 在 A29 关闭后启动；两个 blocker 都关闭前不得运行新的 Phase 8 recheck。

## Requirements

1. 仅在 final recheck evidence 和 A29 均获准提交、工作区回到 clean `main` 后启动；启动时冻结新的候选 HEAD。
2. owner 默认限制在 `deploy/scripts/e2e-local.sh` 的 Celery worker/beat 命令及必要的 infra spec/Task evidence；不得修改 Settings、Celery app broker 语义、Redis URL、产品代码、Playwright tests 或 Makefile。
3. 首选 Celery CLI 原生 `--quiet` 关闭 lifecycle banner/诊断回显；必须同时证明 worker 仍实际消费任务、beat 正常启动/停止，不能用静默固定成功替代。
4. 不把 stdout/stderr 重定向到会保留连接值的证据文件，不增加通用 regex filter、全局 logger wrapper 或“全局 secret scanner”。若原生 quiet 不足，停止并回到规划，不自行扩大方案。
5. 保留 runner 的错误退出码、service readiness、signal/EXIT trap、stop/wait 顺序和 database/Redis/storage/ports cleanup；不得吞掉真实测试或 cleanup 失败。
6. Required Validation 包含 shell syntax、目标命令静态检查，以及使用项目现有两键环境、动态非 0 独占 Redis DB 和定向 V2 real-stack 模式运行一次真实生命周期。
7. 输出验证只报告连接类别命中数和 owner，不打印值；不得包含 password、Cookie、CSRF、header/body、storage state、签名 URL或敏感正文。
8. A30 完成只关闭 Celery lifecycle output owner；Phase 8 仍为 `NOT_MET`，不运行 `make e2e`、`make verify` 或新 recheck，不更新 07/08，不开始 Phase 9。

## Acceptance Criteria

- [x] Celery worker/beat 使用已验证的原生 quiet 机制，runner 不再向父 stdout/stderr 回显 Redis 连接值。
- [x] 没有新增 logfile、输出过滤器、scanner、依赖或第二 runner。
- [x] shell syntax 与静态命令检查通过。
- [x] 定向真实栈用例证明 Celery worker 实际处理任务，命令 exit `0`，连接值命中 `0`；只记录脱敏计数。
- [x] database、Redis、storage、services 和固定端口 cleanup 完整，失败仍可见且退出码未被吞掉。
- [x] diff 仅包含获准 runner/spec/evidence；Settings、产品、测试、合同、Makefile 与 07/08 不变。
- [x] 提交计划已获用户批准；未自动 push、PR、归档父任务或运行 Phase 8 gate。

## Out of Scope

- 创建全局日志脱敏层、secret scanner、pytest traceback filter 或通用 shell pipeline。
- 隐藏 API、Worker 业务错误或降低 cleanup 严格性。
- 修改 Redis credential、Settings representation、Celery broker 配置或部署行为。
- 运行 A29、完整 E2E、最终 gate、新 recheck 或 Phase 9。
