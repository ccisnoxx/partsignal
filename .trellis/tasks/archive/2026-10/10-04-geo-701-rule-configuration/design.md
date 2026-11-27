# GEO-701 规则配置设计

当前review；实现和本地验证完成。README §4明确业务不变量与指标口径高于PRD，采用方法§15并同步PRD默认样本，初始阻断已消解；没有新增人工裁决。

## 所有权与边界

PG保存唯一当前指针与不可变revision记录。Protocol GeoRuleConfiguration严格闭合校验；FrozenRuleSet是不可变内部值（完整JSON字符串），显式转换，不共享可变DTO引用。SamplePolicy复用601公式；sample_gates是preview和后续正式评估的唯一最低样本入口，不实现702指标条件/identity/批量评估。

## 配置与默认值

REPORTABLE/STABLE默认3/5；下降0.1、竞品0.15、重复错误3运行/30天、重复采样3/稳定性0.67、自有引用前期2次。去重窗口30天，1..365可调；不替代702开放机会identity。数值质量阈值和连续失败阈值null表示尚未配置。复测minimum_runs5、下降/竞品恢复到基线0、自然可见率≥0.6、自有引用≥1、事实错误0、稳定性≥0.67；严格可比和人工确认固定true。后续复测额外满足对应指标冻结样本门槛，不能降级STABLE。没有新指标公式或状态机。

## 事务、锁和快照

更新User FOR NO KEY UPDATE（现有command在已安装SQLAlchemy/PostgreSQL编译后的语义）→current FOR UPDATE，CAS expected_revision；同值commit无新revision/audit，实际更新insert revision→指针+1→审计→commit，异常整体rollback。无自动重试，无外部调用；单例锁没有多资源逆序。只读current一次取得revision后加载不可变历史，不需锁指针；并发得到完整旧或完整新值。preview同样捕获baseline并CAS，不写入、不预留proposed_revision；它不是必须保存的授权。

新Batch在既有创建事务一次读current，覆盖创建用rule_set_revision，Batch v2保存完整实际配置，Plan/Run快照保存同revision。已有保存Plan配置字段不再授权实际规则选择，客户端不能指定任意阈值。幂等重放在捕获前直接返回旧Batch，保持旧输入。v1历史读取合法，不回填未知参数；0058新增v1冻结验证helper并扩展同名DB函数accept v2，验证revision实际配置；v2 Run新增DB守卫检查父批次revision，新输入/历史immutability guard保留。DB继续接受v1写入以保留既有内部历史夹具/旧尝试合同；生产新创建服务始终输出v2，不能声称任意raw SQL新写都被强制升级。新配置只有未来创建/评估读取，不扫描重评历史。

## API与前端

管理员GET/PUT /geo/rules，POST /preview；写/preview CSRF。GET提供typed available_actions。PUT完整替换配置（内字段公开default可省略），revision≥1，409 REVISION_CONFLICT；初始化缺失503。preview仅配置、样本等级/最低样本、threshold_configured与完整快照，明确CONFIGURATION_AND_SAMPLE_GATES。前端管理员route、servergenerated types、dirty/CAS/epoch/cancel保护；前端不推断机会结果。

## 数据迁移与安全停止

0058仅新增规则表，初始化revision1不是历史阈值证明；无历史回填。DB闭合JSON校验和不可变UPDATE/DELETE/TRUNCATE，current只能逐次递增。迁移有界锁/语句超时、失败事务回滚，降级显式失败，需备份恢复或前向修复。不部署生产、不调用真实AI。

## 验证

基线全部指定命令通过，候选定向测试覆盖closed schema、权限/CSRF、样本门槛、CAS、no-op、无副作用preview、原子审计失败回滚、并发、历史值、迁移/metadata与Batch创建。完整候选按用户指定命令执行；独立只读复核聚焦公开合同、PG历史与并发。Opportunity验收前的保证是完整冻结值/共享策略边界，实际Opportunity存储由702实施，不能虚报已验证Opportunity表。
