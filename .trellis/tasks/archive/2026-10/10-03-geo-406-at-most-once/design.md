# GEO-406 设计

继续复用Run策略、0048终态/发送进度/尝试链及0050答案完整性防线。geo_dispatch只拥有扫描/投递；geo_runs拥有发送与提交；geo_run_lifecycle撤销未发送lease并重建Batch；geo_run_retries拥有显式用户命令。

恢复锁内按外部事实分流；NOT_STARTED必须过期且无答案，清token/expiry/start，原子PENDING；SENT/UNKNOWN终止UNKNOWN，COMPLETED保留。恢复与authorize_send共用Batch/Run串行化点，前者撤token后旧worker拒发，后者提交SENT后扫描拒绝恢复。

retry沿配置→Batch→Run协议，User非键更新锁复用command；当前资格不等于冻结配置仍匹配，两者均校验。每个前序最多一个后继，继承完整输入、attempt+1、全新PENDING/revision0/NOT_STARTED；父历史无UPDATE。INSERT守卫同值写Batch形成MVCC冲突；refresh_batch重建并清理已结束缓存时间。审计失败全部回滚；提交后Broker失败不撤销新attempt，PENDING扫描恢复。

不保留终态迟到答案，也不新增未批准的旁路证据表；成功晚到返回false，完整终态不变。COMPLETED仅表示完整接收，与COLLECTED/分析COMPLETED区分。

独立复核收敛：当前 Profile 变更后重新测试/启用可能恢复 eligibility，但冻结 revision 仍不匹配。ProfileFacts.matches_frozen_profile 是读 RETRY、显式retry、Worker qualify 的共同匹配规则；读 compact 查询增加五个冻结标量，不加载额外输入或凭据，不增加查询次数。只对 retry 资格行扩大匹配，保留既有人工录入语义。未知 adapter 不具备可匹配版本，返回不匹配并保留真实资格blockers。
