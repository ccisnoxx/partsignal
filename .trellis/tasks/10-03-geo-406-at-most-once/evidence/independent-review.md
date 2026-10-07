# GEO-406 独立只读复核

角色 critical_reviewer；独立上下文 /root/geo406_review。最终交付由主代理按验收条件接受。

P2：当前 Profile 恢复资格后，历史 Run 错误投影 RETRY。触发：冻结 revision 与当前 Profile 不同，但当前 mode/Surface 一致且 eligibility=true。读写投影不一致。修正：ProfileFacts.matches_frozen_profile 供读动作、retry 和 Worker qualify 共用；compact 查询增加五个非敏感冻结标量。回归通过真实 /test→/enable 恢复当前资格并断言 eligible=true，GET 无 RETRY、VIEW_FAILURE，POST GEO_PROFILE_CHANGED、原 Run 不变且无后继。retry-profile-regression.log：2 passed。

最终候选无剩余确认阻断。审查覆盖恢复与发送 Batch→Run 串行点、旧 token/expiry、迟到成功/失败、COMPLETED 提交回滚、不同 actor 的 retry 锁序、原历史无 UPDATE、单后继23505精确映射、Batch/Run/成功审计原子及commit后UUID投递、0048/0050/0052数据库守卫。代理仅只读，未重复运行测试。生产外发、真实供应商、生产部署交错及GEO-407/Browser/分析/UI未验证。

写入观察与来源：review-write-evidence.json；期间仅有主代理已记录的修改，无意外源码变化，未观察到审查代理写入。最终状态取agents.list_agents的completed；验收依据交付内容及已通过的反例日志，独立复核不依据状态自行认定。
