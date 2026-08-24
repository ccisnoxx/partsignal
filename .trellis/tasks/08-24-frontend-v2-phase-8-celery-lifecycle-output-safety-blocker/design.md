# 技术设计

## 1. Owner

```text
e2e-local.sh
  ├─ celery --quiet ... worker ──真实消费任务
  └─ celery --quiet ... beat   ──真实调度进程
             ↓
父 stdout/stderr 不接收 broker lifecycle 展示
             ↓
runner 自身测试结果与 cleanup 输出保持可见
```

不触碰 `app.worker:celery_app`、Settings 或 Redis URL；安全边界位于创建第三方 CLI 进程的 runner。

## 2. 最小方案

将 Celery 顶层原生 `--quiet` 应用于 worker 和 beat 命令，保留现有 `--loglevel=WARNING`、concurrency、pool 与 schedule 参数。它是已安装依赖提供的原生展示控制，不需要新脚本、filter 或 logfile。

## 3. 失败条件

以下任一情况使最小方案失败并返回规划：

- 受控真实栈输出仍命中 Redis 连接值类别；
- worker 未实际消费生成任务或 beat/service readiness 异常；
- 测试/cleanup 失败被 quiet 吞掉或 exit code 变为伪成功；
- 需要保存原始敏感输出才能诊断。

不得在同一批准下改用通用输出过滤或全局日志配置。

## 4. 兼容与回滚

- 产品 runtime、Compose 与生产部署不变；只影响本地/CI E2E CLI 展示。
- runner 的 PID、trap、stop/wait 和 cleanup 顺序不变。
- 回滚仅撤销两个 quiet 参数；无数据/配置迁移。
