# 独立目标文档核对

analyst /root/r4_docs 完整读取用户指定19份文档与manifest，核对分析/review根合同及fixtures。
GEO-507 done且人工接受，508允许执行；无无法消解业务冲突。现有API足以支持本任务，无新Schema/DB/Alembic。
严重INCORRECT HIGH/CRITICAL允许CONFIRMED风险判断；用户禁止无操作默认确认。UI必须逐条主动核对并说明，不能宣称错误已修复。
latest review整体替换旧修正；current只用selection/is_current。无事实仅UNJUDGEABLE。offset为Python Unicode字符，JS按codepoint处理。
151独立JSON场景；复用共享13形成190阶段检查。无批准precision/recall/F1阈值，要求全部已有语义断言通过。
共享citation subject_ids指页面内容，当前domain归属为OWNED但subject=null保留全部候选；不把URL路径作为消歧依据。来源：contracts/database.md:1151、contracts/openapi.yaml:19843、PRD:942、test_geo_citations.py:425。
分析员已实际校验四loader的格式/关系/敏感标记，全部通过，10fixture文件相对before哈希不变；未运行行为金标/PG/E2E。主代理行为金标另存analysis-gold，270项通过。
