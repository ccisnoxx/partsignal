# GEO 单任务人工审查清单

```text
[ ] 当前分支只包含一个 GEO-NNN 任务
[ ] 依赖任务均为 done
[ ] Task Brief 与 .trellis 证据存在
[ ] task-manifest 状态为 review，而不是 done
[ ] 没有提前实现直接后续任务
[ ] OpenAPI、database contract、Alembic、ORM、Schema 和 generated types 一致
[ ] Router 没有直接事务/ORM 写入
[ ] 前端没有第二套状态机或指标公式
[ ] IntegrityError 只按精确 SQLSTATE + constraint 映射
[ ] 不可变、revision、幂等、锁和并发语义有测试
[ ] 没有真实凭据、Cookie、机密正文或生产 URL 进入 fixture/日志/截图
[ ] 没有发送后自动 retry
[ ] 没有使用真实外部平台作为普通 CI 测试
[ ] 旧人工 GEO 流程没有被破坏
[ ] 所有宣称通过的测试都实际运行
[ ] 未运行测试有具体原因
[ ] git diff --check 通过
[ ] 人工验收后才将任务改为 done
```
