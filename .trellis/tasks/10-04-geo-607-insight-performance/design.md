# GEO-607 设计依据

公共API和公式保持。先用100k Run fixture与cProfile/SQL事件采样定位实际瓶颈，再选择索引与既有读取边界内的最小改动。候选筛选若前移，仍保留同冻结subject/product binding交集，不裁剪竞争集合、current分析/复核或历史后继。每次读取仍是独立RR实时快照。

索引归Alembic/ORM，fixture归tests/performance，结果归任务证据和R5验收文档。不存在可写指标汇总、Redis缓存或新事实源。常用场景、数据分布、样本数、目标及环境在基准README与结果中显式固定，失败非零；不能根据运行结果临时放宽门槛。

## 已测瓶颈与最终读取边界

第一轮100k全对象洞察P95 6.135s，实际SQL总84ms；CPU诊断显示JSON解码、Pydantic输入验证、ORM实体图和重复维度深拷贝占主要时间。优化不改变公式或裁剪窗口。

Run候选仅取完整JSONB UTF8 SHA-256内容指纹，再以一条固定DISTINCT ON读取完整唯一输入并执行GeoRunInputSnapshot校验；current Analysis同样使用既有PG保证的完整input_sha256读取唯一输入。两条查询均在原RR事务内，不能按profile ID/batch ID猜测同一内容。共享输入只读；身份/子结果/Review仍归各Run和Analysis。真实PG回归以同profile ID的两版截图要求验证不误合并。

Answer/Citation/分析子结果/Review使用Core Row，保留原schema模型验证和生命周期校验。完整不可变MetricDimensions是序列化和窗口重建的请求内键。摘要不创建未返回的逐Run Contribution，下钻默认行为保持。固定14条应用查询（认证15/预览16）；两条额外固定查询换取不重复传输/解码完整输入，未引入N+1或跨请求缓存。

第二轮100k全对象洞察仍4.002s：剖析继续显示重复URL规范化、SQL大IN占位符处理和同cell多指标基础资格/样本校验成本。
内部ID查询改UUID[] ANY单绑定参数，空集语义由真实PG验证。CitationUrlMemo仅在load_inputs当前调用存活，Pydantic两个URL validator复用同原URL确定性归一结果，仍逐条检查stored身份/位置；不缓存失败，不跨请求保留URL。
calculate_metrics归原公式唯一所有者geo_metrics：先逐指标scope检查、共享样本唯一性与基础资格，再执行原指标专属资格/事件/分母/UNJUDGEABLE/稳定性规则。旧calculate_metric仍调用同一内部公式；不是第二套算法。新批量路径有独立人工金标与重复样本回归，协议/公式版本不变。

第三轮P95 3.069s仍失败。最后按剖析去掉仅average-rank需要、却每个指标都做的subject lookup，引用/声明/SOV事件也不预读不使用的对象事实。_events公式与资格条件不变。
cell绑定键计算按(完整维度JSON,只读snapshot对象身份)在单次_cells复用；inputs持有全部snapshot引用，id无回收重用。相同完整输入对象共享scope/cell key元信息，Run事实仍逐条append；不同内容对象或维度不共享。
最后175定向unit和33 PG/HTTP通过。此局部读取/元信息优化由上述定向与最终完整门禁验证；三次独立复核覆盖此前shared-input/batch/URL/UUID路径，未声称其复核了最后局部改动。
