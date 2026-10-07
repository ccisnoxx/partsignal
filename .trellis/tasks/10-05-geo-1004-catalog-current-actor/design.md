# 事务设计

- 旧实现的交错已在 PostgreSQL 动态复现，见 evidence/red.txt。B 在 A 初读前持有 User 与 Subject 锁；旧实现只等待 Subject，B 提交降级后 A 成功写别名。
- 沿现有 geo_prompt_variants 的 User 先于资源模式，User 使用 FOR SHARE，Catalog 在取资源锁前锁后重读 User。该锁阻止非键状态修改/删除，同时兼容业务/审计 FK KEY SHARE 和同用户并行 Catalog 命令；Catalog 不更新 User，无需独占非键锁。
- 认证依赖把当前请求的 Session UUID 写入请求独占 SQLAlchemy Session.info；不猜测其他登录会话。当前请求锁定 Session FOR SHARE（只选择 session 列，避免 joined User 带入额外锁）；拒绝错误归属、撤销、删除、过期。直接内部调用无 HTTP 认证上下文，只按权威 User 资格执行。
- 权威锁序 User → 当前 Session → Product → 品牌（稳定 UUID）→ Subject → Alias/Domain。Session 锁阻止 logout/revoke/delete 穿透命令；数据库 clock_timestamp 在完成前再检查自然到期，任何失败整事务 rollback。
- Catalog 与会获取 User 锁的 Identity 命令在锁前舍弃 pending last_seen_at；这是非权威活动提示，不能先 autoflush 为 Session→User。只修复改密、重置、update、bulk、delete 的直接锁序，不改其他领域权限框架。
- User revision 无独立认证含义：重读当前资格而非任意 revision 变化即失效；无害资料修改可继续。Catalog expected_revision 仍由既有资源锁后 CAS 拒绝。
- A 先取得 User 后，B 降级不能在 A 等待 Subject 时提交；测试另证明 B 正在等待 User、A 先提交。不会在 Subject 后获取 User。
- Router、OpenAPI、前端和 schema 均不改；新增内部 current_actor 守卫，成功 creator/audit/动作输出使用锁后 current User。
