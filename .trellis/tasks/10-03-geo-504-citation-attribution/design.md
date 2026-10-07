# GEO-504 设计

## 输入与权威
复用GeoAnswerCitationOut和GeoRunSubjectSnapshot，在显式转换边界复制为frozen dataclass/tuple。原始citation ID、answer ID、hostname、position/occurrences保留；算法不改URL或重新去重，也不把DTO/ORM保留为可变内部状态。完整集合校验禁止跨回答、重复ID/规范URL/位置；域名字典检查规范键，不能读取时静默修复。

## 域名与类别
唯一匹配条件 host == domain 或 host.endswith('.' + domain)。Catalog仍保存管理员输入的精确hostname；分析规则显式覆盖该host的子域，不生成字典或猜公共后缀。路径/query/标题不参与匹配。Citation已在GEO-304完成IDNA URL规范化，Catalog复用IDNA2008/UTS46 non-transitional/STD3；不去www、不做网络验证。

OWNED/OFFICIAL × OWN_BRAND/OWN_PRODUCT → OWNED；× COMPETITOR_BRAND/COMPETITOR_PRODUCT → COMPETITOR；REFERENCE_PART → UNKNOWN。DISTRIBUTOR/OTHER各按显式关系分类，不因对象自有就变自有。所有域名命中保留，父子/角色/长域优先都不能消歧。多个subject：subject_id=null并CITATION_OWNERSHIP_AMBIGUOUS；全部类别一致可保留类别，冲突：UNKNOWN并CITATION_SOURCE_AMBIGUOUS。全局来源规则仅非所有权类别，由带版本的冻结规则集提供，不硬编码真实网站；规则和对象证据同等合并，冲突不静默选赢家。

## 修正投影
消费501的GeoCitationCorrection字段，只接受本次机器结果的citation及本snapshot subject。新frozen有效投影保留完整machine引用及review修正值；不原地写入或清除机器歧义。当前review选择、绑定analysis/current pointer和权限由507/508拥有；本任务不能自选最新review或提供复核命令。

## 接线/恢复
阶段返回geo-citations-v1、可空来源字典版本、候选和复核原因。规则变化须新版本，未来506冻结完整配置/hash并原子提交。现有无citation子结果表，新增持久化属506合同工作，504不假装已经入库。无事务、锁序、状态、revision、external I/O、队列与生产迁移变化。错误固定且repr隐藏hostname/URL/正文。
