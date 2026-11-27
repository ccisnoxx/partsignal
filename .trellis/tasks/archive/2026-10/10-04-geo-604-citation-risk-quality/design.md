# GEO-604 读模型设计

PG RR批量事实 → 显式frozen证据转换 → 完整cell/601资格 → 引用、声明、质量摘要和同选择器下钻。查询仍只有12应用SELECT（认证后13），不在GET访问网络。

原始Citation权威持有规范URL和occurrences；来源类别来自当前analysis内latest review有效投影。URL每回答一次，domain/category组按事件和distinct Run分别计；同一域名同一回答多个URL不能扩大运行覆盖。claims只取目标，四态均保留；只有可判断声明进入601准确性分母，严重错误只计HIGH/CRITICAL INCORRECT运行。没有可判断声明但通用合格的UNJUDGEABLE仍可单独下钻。

共享域名候选按冻结analysis subjects经GEO-504 hostname规则计算；未分析时可用Run冻结字典作质量诊断，不能成为业务分类。人工修正不会删掉原始共享诊断。current成功及review选择复用既有owner，不改旧指针/数据。

业务按完整cell分开；质量按相同筛选最新attempt去重运行，原因可重叠、排除运行只计一次。费用用Decimal分币汇总，有成本run作为该币均价分母；全未知不产生已知小计、零费用是真实已知。不换币、混币不生总金额。采集model/product/version与analyzer/rule/configuration版本分组显示缺口，信息从Answer/current Analysis冻结输入来。

保持geo_metrics公式owner，geo_overview质量owner；新增证据转换、细节投影与质量组装各拥有真实边界，避免扩张既有趋势模块职责。新增Schema/明细端点只提供604交付，不实现605/702。

无DDL/Alembic/回填/行锁/revision/写事务/队列/外部I/O。HTTP沿EngineerUser、改密门禁、no-store；422闭合筛选，404消失cell，409损坏历史。摘要和实时明细as_of可不同，不保证跨请求冻结。
