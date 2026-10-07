# GEO-207 独立只读复核

复核代理：critical_reviewer，fresh fork_turns=none；主代理接受此复核交付。候选源码、测试、OpenAPI/generated 与 review-start-hashes.json 一致。审查没有运行测试；引用的定向验证由主代理执行。未确认可行动 finding，也未发现当前候选的发布阻断问题；结论不代表完整门禁已完成。

- 矩阵 prompt×profile×repeat，Subject 不参与乘法，同 Surface 的不同 Profile 不合并。UUID 与 1-based repeat_index 稳定展开；缺失/停用保留请求数量，三模式加 unresolved 等于 run_count。检查了 90 金标、重复边界、3000 单元和资源缺失/停用反例。
- 资格直接复用 evaluate_profile，没有放宽开关、批准、能力、测试或当前模型绑定。仅活动 Prompt/合资格 Profile 调用内部估价；默认 None，人工模式和 cost 能力不制造价格，估价异常明确传播。
- Decimal 上下文支持受限单格金额的精确聚合；known/unknown 按重复运行数累计。检查了明确零、部分覆盖、最大单格汇总、预算相等/超出、未知费用和混币反例。唯一币种为已知小计；混币保留分币小计，总 value/currency 为 null；设置预算时阻断比较。当前 budget 未保存币种，按唯一估价币种比较数额符合明确设计，未发现根合同冲突。
- 服务检查 RR/SERIALIZABLE，三次批量列查询禁 autoflush，无写/锁/commit/rollback/provider/Batch/Run 路径。公开响应只有数量、金额、固定 code/field 和 UUID。OpenAPI 只追加闭合数据组件，没有 Plan 路径、客户端估价或 run_count 输入，generated 增量相符。

已读主代理验证：定向 unit 37 passed、PG 5 passed，覆盖脏 identity map、三 SELECT 无写、RC 拒绝、同一 RR 旧快照和新事务停用、默认 Registry 拒绝自动 Profile。

覆盖边界：SERIALIZABLE 没有单独运行；并发写发生在两次完整预览之间，没有直接插入三次 SELECT 间隙，跨查询一致性由同一 RR 事务及 PostgreSQL 快照语义支撑。非空估价和混币主要由纯 Builder 单元验证，默认 None 应用路径由真实 PG 验证。后续 Plan API/批次、真实定价和执行预算不作为本任务缺陷。

写入证据：审查期间维护源码/测试/根合同/generated 的哈希保持不变；主代理独立修改文档并记录实际增量。复核代理自报仅只读，无测试/Git/环境操作；本次审计记录 observed_write_paths=[] 表示未观察到写入。
