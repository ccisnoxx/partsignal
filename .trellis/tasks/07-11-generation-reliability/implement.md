# 生成作业可靠性与可观测性实施计划

## 实施步骤

1. **契约与迁移**
   - [x] 更新 `contracts/database.md` 和 AI 生成规范，写明 PENDING 补投递、RUNNING 不重放和租约公式。
   - [x] 新增 Alembic revision、ORM 字段、部分索引和配置校验。
   - [x] 增加迁移前后与旧代码兼容读取测试。
2. **统一投递边界**
   - [x] 将首次投递和恢复投递收敛到一个有明确日志/元数据更新的函数。
   - [x] API 提交 Job 后尝试投递；Broker 失败保持 PENDING 并返回已接受 Job。
   - [x] 补充 Broker 接受后元数据提交失败的重复消息测试。
3. **PENDING 恢复**
   - [x] 新增限批次、可并发的超龄 PENDING 扫描与补投递任务。
   - [x] 多 Beat/恢复器使用 PostgreSQL 行锁跳过已占用候选。
4. **租约修正**
   - [x] Worker 从作业快照读取供应商超时并计算租约。
   - [x] 保留迟到响应不能覆盖终态的门禁。
   - [x] 删除固定租约作为业务判断的旧路径。
5. **诊断与部署健康**
   - [x] 增加不含敏感内容的结构化计数和年龄日志。
   - [x] 增加 Worker/Beat 部署健康检查和管理员生成诊断 CLI。
   - [x] 更新开发、测试和运维文档。
6. **质量验证**
   - [x] PostgreSQL + Redis + 真实 HTTP 替身覆盖全部故障窗口。
   - [x] 检查同一 Job 的供应商调用数和内容版本数均不超过 1。

## 目标测试

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
```

最终运行：

```bash
make verify
```

## 必测故障矩阵

- API 提交后、首次发送前退出。
- Broker 接受后、投递元数据提交前退出。
- 同一 Job 多条消息、多 Worker 并发认领。
- Worker 离线形成 PENDING 积压，恢复后限批次执行。
- 最大合法供应商超时期间 Beat 扫描不误杀。
- 供应商调用后 Worker 丢失，原 Job 过期失败且不自动第二次调用。
- 迟到响应不能创建版本或覆盖 `FAILED`。

## 回滚点

- 恢复任务出现消息风暴时先停用 Beat 恢复入口，不改业务 Job 状态。
- 租约回归导致误杀时停止新生成并修正公式，不自动重试失败 Job。
- 迁移回滚前停止所有读取新字段的 Worker/Beat/API 进程。

## Goal 1 完成门禁

- [ ] 开始时保留并审计现有未提交的 `0011`、投递服务、测试和 Compose 改动，不通过重建文件规避合并。
- [ ] 在真实 PostgreSQL/Redis 环境运行 `backend/tests/integration/test_generation_reliability.py`，不得出现 skip 或环境连接失败。
- [ ] 与固定目的地址 Transport、PUBLIC-only 分类共同通过生成边界测试后，才能认定本子任务完成。
- [ ] 运行 `make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`、`make build` 和目标 E2E。
- [ ] 完成后停止；不自动提交、推送或进入 Goal 2。

## 未提交候选证据（2026-07-11，待 Goal 1 复核）

- 真实 PostgreSQL/Redis 目标测试 `23 passed`，容器化集成测试 `13 passed`，无 skip。
- 完整 `make verify` 通过：后端单元测试 `61 passed`、前端 `4 passed`、镜像构建、开发/生产 Compose 校验和 Playwright `2 passed`。
- 以上结果只证明某次工作区运行，不替代 Goal 1 对当前差异、环境和无 skip 集成测试的重新验收。
