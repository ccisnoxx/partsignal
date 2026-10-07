# GEO 单任务说明模板

> 文件建议：`.trellis/tasks/geo/<GEO-NNN>-<slug>/task.md`

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID | GEO-NNN |
| 标题 |  |
| 发布增量 | R0–R8 / post-core |
| 状态 | planned/ready/in_progress/review/done/blocked/deferred |
| 负责人 |  |
| 依赖 |  |
| 关联 PR/Commit |  |

延期任务必须填写 deferred_reason、resume_conditions、release: post-core 和负责人/待定责任说明；记录产品决策依据，保留原阻断/完成证据。解除延期不等于完成，恢复须重新核对当前依赖及授权。

## 2. 目标

用一段话说明完成后用户或系统获得什么能力。不要写实现步骤代替目标。

## 3. 关联需求

- CAP-GEO-XX
- REQ-GEO-...

## 4. 必读文档

- `docs/geo-monitoring/...`
- `contracts/openapi.yaml`
- `contracts/database.md`
- 相关 ADR
- 当前相关代码路径

## 5. 当前行为

明确描述当前仓库实际行为：

- 数据；
- API；
- 页面；
- Worker；
- 测试；
- 已知缺口。

## 6. 目标行为

完成后应具备的行为，使用可验收语句。

## 7. 范围内

- [ ] 具体项 1
- [ ] 具体项 2
- [ ] 具体项 3

## 8. 范围外

明确列出后续任务，不允许“顺便实现”：

- 不实现 ...
- 不修改 ...
- 不接入真实 ...

## 9. 业务不变量

1. ...
2. ...
3. ...

## 10. 契约变化

### OpenAPI

- 新增/修改 operation；
- request/response；
- enum；
- error code；
- idempotency/revision。

### Database

- 表/列/索引/约束；
- Alembic revision；
- 不可变触发器；
- 数据迁移；
- 删除和 FK 语义。

## 11. 后端实现

### Router

- ...

### Application Service

- 事务；
- 锁顺序；
- 状态转换；
- 审计；
- 错误映射。

### Query/Read Model

- 一致读；
- 批量查询；
- N+1 防线。

### Worker/Collector（如适用）

- 任务 ID 参数；
- lease；
- at-most-once；
- recovery；
- fake provider。

## 12. 前端实现

- 路由；
- search params；
- query key；
- 页面/组件；
- loading/empty/error/conflict；
- available actions；
- dirty 保护；
- 可访问性。

## 13. 测试计划

### Unit

- [ ] ...

### PostgreSQL Integration

- [ ] ...

### Contract

- [ ] ...

### Frontend Component

- [ ] ...

### E2E

- [ ] ...

### Security/Performance/Ops

- [ ] ...

## 14. 验收标准

使用 Given/When/Then 或可验证列表：

1. Given ... When ... Then ...
2. ...

## 15. 验证命令

```bash
make contract-check
make lint
make typecheck
make test-unit
# 按任务增加
```

## 16. 数据和上线

- 功能开关；
- 迁移顺序；
- 数据回填；
- 兼容旧版本；
- rollback/forward fix；
- 监控指标。

## 17. 风险与开放问题

| 风险/问题 | 处理 |
|---|---|
|  |  |

## 18. 完成证据

- Commit/PR：
- Alembic：
- Contract diff：
- 测试结果：
- E2E 截图/报告：
- Secret scan：
- 文档更新：

## 19. 后续任务

- GEO-...
