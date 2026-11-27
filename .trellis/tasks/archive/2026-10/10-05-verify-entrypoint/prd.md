# 修正本地 verify 依赖入口并重新验证

## Goal

承接 GEO-906 已接受的测试证据；补齐 fake OSS 就绪依赖和隔离 PG 恢复工具入口，重新执行完整 make verify，不修改生产或历史验收状态。

## Requirements

- 配置已存在；修复 fake OSS 未启动、容器缺显式 PG 工具的测试编排根因。
- `make test-integration` 必须执行完整集成集合：容器执行普通集成，宿主机使用开发 PG16 容器工具执行恢复文件，任何一部分失败都令入口失败。
- fake OSS 以现有直接 Python 入口启动；健康检查就绪后才运行 backend-test。
- 复用 GEO-903 隔离库、回环、密钥配对、SIGTERM 与精确清理合同，不增加生产访问或 Docker socket 容器挂载。
- 不修改私有 env、OpenAPI、数据库、迁移、业务公式、Browser 开关或生产状态；不改变 GEO-906 已接受状态或覆盖原始 verify 失败。
- 新证据记录在本任务；不得声称真实生产 smoke/上线已完成。

## Acceptance Criteria

- [x] fake OSS 从停止状态由测试入口启动并达到 healthy。
- [x] 恢复入口显式发现同一个开发 PG 容器和仅回环发布端口，6 项恢复测试通过。
- [x] 执行并逐项记录 git diff --check、make lint、make typecheck、make test-deploy-scripts、完整 make verify。
- [x] 任何后续失败先诊断，原始失败和修正后的证据分别保留；不清理未知 Redis 数据以换取通过。

## Notes

- 前置证据：../10-05-geo-906-rollout/implement.md 与 evidence/validation-results.json。
- 初始差异：backend-test 只等待 PG/Redis；fake OSS 无健康检查；恢复 fixture 在未设置 RECOVERY_PG_BIN/GEO_RECOVERY_PG_CONTAINER 时显式失败。
- 验证覆盖不减：恢复文件仅从容器命令转到同一个 Make 入口的下一条必跑宿主机命令；没有 skip 或改变断言。
