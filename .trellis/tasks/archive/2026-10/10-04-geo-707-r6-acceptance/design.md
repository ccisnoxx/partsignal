# GEO-707 设计

唯一运行时修补为首次机会创建审计与复测审计消费者。领域状态和事务仍归既有应用服务；不引入外部事件发布或第二套指标。

`evaluate_opportunities` 新增必需 keyword request_id，迁移全部现有测试/seed 调用者；审计关联操作而不进入 evaluation fingerprint。真实 CREATED 才追加 opened，事实仅 revision/status，写事务失败统一 rollback。审计前后端同步登记动作，复测四个既有安全事实显式登记；未知字段继续拒绝。

纵向测试分两层：PG 使用真实分析与规则/HTTP/内容发布服务；Playwright 使用独占本地 PG/Redis、真实 API 与 Worker、虚构上传和既有页面，只有无页面的行动/RETEST 使用 API。隔离 seed 先验证 owner token 与业务前缀，再调用实际 evaluator 保存机会，不直接伪造业务状态，也不能对普通开发/生产库写入。保持稳定五个样本与现有 0.6 恢复门槛；完成/恢复都不自动解决。

本次无 OpenAPI wire shape 或 DDL；当前 Alembic head 0062。无生产迁移、历史审计回填、Browser 或生产保留，GEO-901/902 未实施。

永久审计恢复边界：一旦保存opened，不能整体移除后端动作登记与前端动作/facts投影，否则历史读取显式失败。停止新写入可以回退evaluator增量，读取登记需保留；其余采用前向修复，不删除历史审计。
