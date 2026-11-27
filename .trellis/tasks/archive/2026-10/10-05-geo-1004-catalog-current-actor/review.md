# 独立只读复核

复核角色 critical_reviewer，隔离上下文；没有修改候选或重复运行测试。主代理核对源文件在复核期间未变化。

结论：未确认可行动的 P1/P2 问题，本次复核无新增阻断。

- 全部9个服务命令、10个写路由均先守卫再取资源锁；creator/audit/actions 使用锁后 current；两种完成路径均先复核会话再 commit。
- User → 当前 Session → Product → 品牌 → Subject → Alias/Domain；FOR SHARE 阻止身份写入/删除且兼容 SHARE/FK KEY SHARE。五个 Identity User 锁入口已清 heartbeat，logout 只写 Session。审计 FK、投影与共享 Subject 的 Plan/Batch/Retest 入口未发现新增反向锁环。
- 会话按认证 UUID 精确复核；归属、存在、撤销和到期从数据库列读取，不依赖 ORM 缓存。User 锁后 populate_existing。
- 失败和自然到期回滚 Catalog/revision/关系/SUCCESS 审计；无害 User revision 变化不误撤销资格，Catalog expected_revision 保持既有 CAS。

复核读取 evidence/red.txt、current-actor.txt、catalog-integration.txt、identity-integration.txt，以及基线 diff、合同、类型与调用者。151项单元、contract-check、ruff/mypy 由主代理执行，审查者未重新运行。

## 覆盖限制
未动态逐一展开“等待 Session 行锁时撤销/删除/改归属后提交”的全部交错，未逐一组合五个 Identity 命令与 Catalog。已覆盖提交前会话漂移、改密/logout 锁等待、资源等待自然到期，以及全部写路由的状态拒绝和快照原子性。剩余相关锁序已静态核对，无确认阻断缺陷。未运行全仓回归或生产验证。
