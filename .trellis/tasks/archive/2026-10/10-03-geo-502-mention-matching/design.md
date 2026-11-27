# GEO-502 设计

## 所有权与入口

`freeze_subject_aliases(subjects)` 消费已校验的 `GeoRunSubjectSnapshot`，显式复制 id、revision、类型和别名元数据到 frozen dataclass/tuple；不查 Catalog、不持有 DTO。canonical_name 是隐式 NAME，display_name 仅展示。登记别名的 normalized_alias 必须符合 Catalog 权威规范，坏字典明确失败。AnalysisInputSnapshot 的持久化、哈希、当前字典一致读取及 revision 提交留 GEO-506，本任务不另建 JSON/数据库合同。

`identify_mentions(answer_text, snapshot)` 是无 I/O 的纯函数，返回确认提及与歧义 occurrences，规则版本 `geo-mentions-v1`。确认结果对应 GEO-501 的 subject/count/first offset/matched aliases；上下文用于保留证据，没有 recommendation、rank、claim 或 citation 输出。

## 确定性规则

- NFKC、casefold、水平空白折叠与有限 Unicode 连字符折叠；连字符不删除，未登记的无连字符、后缀、错拼和模糊近似不猜测。换行不跨越匹配。
- 源字符簇到规范字符的 span 映射保留原文 Python Unicode 字符 offset；规范展开不能匹配半个源字符。英文/数字/下划线以及型号的相邻连字符/路径/点号段构成边界，中文上下文允许直接连接型号。
- 边界按整个匹配键的完整候选统一检查，参考型号也采用型号边界，不按类型或别名种类过滤候选消歧。同一位置/重叠命中合并成一个 occurrence。同对象多个别名不增加计数；跨对象保留全部候选，返回 SHARED_ALIAS、NORMALIZED_ALIAS_COLLISION 或 OVERLAPPING_ALIASES，分析复核原因统一 ALIAS_AMBIGUOUS。即使某对象还有唯一命中，歧义仍存在，不用角色、语言或顺序猜选。
- 否定只输出有界同分句中的词面线索；否定不删提及，不推出推荐分类。中英文转折和标点限制线索传播，`not only`/`不仅`不作为否定。此规则不承诺通用 NLP 语义。
- 结果顺序固定，数据为不可变值，不记录或在 repr 输出答案/别名正文；错误固定中文且不带输入。

## 合同和接线

无 OpenAPI、数据库、Alembic、Router、Worker、页面、状态机、锁、revision 或外部调用变更。GEO-506 必须消费 ALIAS_AMBIGUOUS 并按既有 NEEDS_REVIEW 合同提交；GEO-502 本身只输出 review_required_reasons，不提前实现持久化状态转换。

## 验证边界

既有 13 场景直接运行识别并对照独立金标，新增独立 mentions-v1 金标保护计数、位置、Unicode、型号边界、否定和三类歧义。快照变更隔离、稳定顺序及坏规范键定向单元测试；复用已完成基线（180 unit / 16 integration / contract-check）。执行用户指定五项检查和合同检查，不调用真实 AI 或添加无关 E2E。
