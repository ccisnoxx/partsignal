# GEO-503 设计与证据边界

## 所有权与输入
`classify_recommendations(answer_text, snapshot)`在geo_analysis.py内调用已有identify_mentions，保证提及和推荐使用同一原文/冻结字典；不会接受另一份未经绑定的提及结果。geo_recommendation_rules.py是推荐文本与顺序的权威所有者，仅通过TYPE_CHECKING引用提及类型，无运行时循环、I/O或替代匹配算法。主阶段装配每个确认subject唯一的不可变结果和全局rank/review一致性，固定UUID顺序。未命中不造结果，纯歧义不选对象。

## 四态与依据
- RECOMMENDED：作用域内明确推荐、建议、优先评估或首选等选择语义；名字、参数或编号自身不构成推荐。
- CONSIDERED：候选/比较/条件选择、明确器件描述；品牌仅为“品牌的产品”修饰语不推导独立品牌推荐。保持共享GEO-005金标的中性描述口径。
- NOT_RECOMMENDED：明确不推荐、不适合、避免使用以及英文recommend against/avoiding等。否定不删除提及。
- UNKNOWN：纯名字或事实提及没有推荐依据、提问/引语/模糊否定、推荐与不推荐冲突及不可信指令。不把未推荐自动当作反对。

评价线索识别时排除已匹配的名称/别名文字，名称里的“推荐/首选”不能当作判断依据；原文证据不改写。规则按原文句、转折和对象绑定分句；并列名词可共用谓词，不让独立分句或未知对象的推荐串到当前对象。证据保存原文start/end（Unicode字符/end排他）、原文excerpt、规则与候选rank/group；最终结果含rationale_excerpt、全部证据、confidence=None。不拼造摘录或概率；结果repr隐藏正文。超过公共2000字符依据边界的列表标题不继承，长列表可只保留短原文标题。证据中的rank是局部线索，调用者只能使用最终EntityRecommendation.rank。

## 位置识别
只有明确推荐/建议顺序、order of preference等标题下的连续1-based编号列表，或明确首选/次选/第三选择可产rank。普通编号、项目符号、序号缺失/重复、同subject重复、单项多对象、歧义、非推荐成员、列表内明确位置与编号冲突、多个独立排序序列、并列/无优先级声明均不能产可靠总排名。不压缩未监测项的位置，不把首次字符offset当排名。全回答存在否认顺序的说明时保守清空rank。局部等级相反或同一对象rank冲突不选较好位置。

## 复核与接线
内部规则版本geo-recommendations-v1。复核代码ALIAS_AMBIGUOUS复用502；RECOMMENDATION_UNCERTAIN、RECOMMENDATION_CONFLICT、UNRELIABLE_RANK、UNTRUSTED_INSTRUCTIONS属于本阶段，并保持根合同最多20个短非空代码的结构。推荐缺乏可靠rank必须返回UNRELIABLE_RANK；UNKNOWN有不确定原因，冲突保留所有原证据。GEO-506后续负责组合各阶段、冻结统一规则身份、原子写入及复核门禁；本次不写Run状态或AnalysisRevision，不维护第二输入hash。

## 合同与恢复
公共Kind/Out、SQL/ORM四态和可空rank/rationale已由501建立，无HTTP、根合同、Alembic或前端变化。head仍0054；无生产数据更新或回填。纯函数同输入同输出，不建立持久化幂等设施，无事务/锁/外部调用/超时生命周期。坏答案沿用固定ValueError，错误无原文。撤销本次代码不影响历史。

## 验证和限制
共享13场景既有分类/rank及证据预期不改写；新增独立推荐金标覆盖本任务稳定行为。依据长度、immutable/safe repr、坏答案/字典、金标引用与隐私均有定向证据。用户明确要求的五项门禁实际执行，完整integration只使用专属Compose。初次失败与修复结果均保留。

确定性规则不承诺通用NLP：跨句指代、复杂反讽、表格/嵌套/换行续行、未登记型号及未知语言/排序词不猜测。多序列或否定顺序保守处理；模糊语义需人工复核。没有外部分析模型、业务指标、机会、Browser或完整R4用户旅程，因此不运行无关E2E/生产smoke/全verify，不宣称已接线。
