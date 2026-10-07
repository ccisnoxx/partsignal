# GEO-502 Task Brief：监测对象别名快照和确定性提及识别

## 1. 基本信息
GEO-502 / R4；主代理负责；geo/GEO-502；2026-10-03 本会话用户已人工审查并接受实现与测试证据，manifest 状态 done、Trellis 为 completed；GEO-501、GEO-106 manifest=done 且 Trellis 人工接受记录完整；无 commit/PR。

## 2. 目标
在冻结监测范围和别名字典上识别中英文品牌、产品、竞品和参考型号，保留原文位置和否定上下文；同别名跨对象歧义必须返回全部候选与复核原因，不能任意选择。

## 3. 关联需求
WBS GEO-502 完整行；PRD AC-SUB-03、AC-ANA-01/02、§11.4/11.5；测试策略 §6；Accepted ADR-002/003。不虚构 CAP/REQ 编号。

## 4. 必读文档
用户指定的 GEO README、路线图、WBS、执行指南、模板、manifest、PRD、领域模型、流程、方法论、技术01～07和ADR002/003；根与backend AGENTS、Trellis workflow/spec；501/106/005记录；根合同的Catalog/Run快照/Analysis完整相关单位、0054、现有Schema/快照装配与金标。

## 5. 当前行为
Catalog提供NFKC/Unicode空白/casefold规范字典，Batch冻结当时范围与活动alias/domain。GEO-501已建立分析输入和Mention合同、六表及0054；无geo_analysis Service或识别算法；运行详情分析区仍NOT_IMPLEMENTED。共享13场景金标只有离线加载与关系校验。

## 6. 目标行为
从已校验GeoRunSubjectSnapshot显式转换不可变别名匹配快照；严格保留id/revision/类型及规范键，不增加未知型号别名。中英文与已登记无连字符别名、Unicode连字符、大小写匹配；保护前后型号边界。重复/重叠同对象命中不重复计数；原文Unicode字符offset、摘录及否定线索可追溯。歧义独立返回candidate subject ids，输出ALIAS_AMBIGUOUS复核原因。

## 7. 范围内
geo_analysis.py纯阶段、独立提及金标及geo_fixtures.py/离线校验脚本接入与针对现有13场景的实际分析测试、快照不可变/错误边界测试、内部规则与使用边界说明、任务状态及证据。

## 8. 范围外
GEO-503推荐/rank、504引用归属、505声明/事实核验、506Worker/revision写入、507复核API、508页面；指标、Opportunity、Browser、真实平台；无关重构/升级。

## 9. 业务不变量
原文不改；匹配只消费冻结字典与范围；同别名多对象不选择；否定不取消提及或制造推荐；后缀与大小写/连字符规则金标保护；不执行答案指令、联网或日志正文。

## 10. 契约变化
复用GeoRunSubjectSnapshot/GeoEntityMentionOut，不新增公共operation、Schema或表。内部结果含原文span/候选及上下文，子结果写入留506。无Alembic revision、历史数据迁移或新哈希公式。

## 11. 后端实现
无Router/ORM写入；纯快照转换与识别。当前字典一致读、Run→Analysis→Fact锁、revision分配/发布/幂等及review状态由既有501合同和后续506拥有；此任务不接线。错误固定中文ValueError，不回显输入。

## 12. 前端实现
不改路由/query key/URL/页面状态；generated类型未变，分析区保持原状态。

## 13. 测试计划
基线：既有分析/Run/Catalog规范化/共享fixture定向unit及contract-check；隔离PG既有analysis input。候选：全部原始13场景提及预期、独立新增型号/Unicode/中英文边界、重复/重叠、否定语境、共享别名和无命中、快照变更隔离/错误/原文offset。最低命令全执行；无需真实AI、E2E或浏览器矩阵。

## 14. 验收标准
共享桥芯别名返回两候选与复核，不生成两条确认提及或任选一条。基础型号不误中未知后缀/前缀；大小写/登记别名与中英文可确定匹配。否定提及保留原文及线索，推荐尚未分类。同输入重复执行相同，旧快照不受DTO/当前字典变更影响。

## 15. 验证命令
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_analysis_contract.py backend/tests/unit/test_geo_catalog_policy.py backend/tests/unit/test_geo_catalog_schema.py backend/tests/unit/test_geo_fixtures.py backend/tests/unit/test_geo_run_contract.py
make contract-check；git diff --check；make lint；make typecheck；make test-unit；make test-integration（独占partsignal-geo502-validation Compose覆盖）。命令、退出码与日志记录evidence及implement.md。

## 16. 数据和上线
无迁移、回填、外部调用或开关变更。head仍0054；隔离测试空库前滚。内部函数未接Worker，生产接线由506交付；可撤销本任务源码无需修改数据。

## 17. 风险与开放问题
重点为型号误判、Unicode规范化导致offset漂移、重叠计数、共享别名误选及否定语义越界。按金标证实具体规则，不推断通用语义理解。只有用户指定五类阻断才标blocked；环境失败记录精确命令和证据。

## 18. 完成证据
基线与候选日志、初始hash/状态、任务增量diff、变更保留核验。任务完成后manifest=review、Trellis=review，等待人工接受，不提交/归档。

## 19. 后续任务
GEO-503/504/505分别补各阶段；506接线原子revision/Worker；507/508提供复核与页面；本次不实现。
