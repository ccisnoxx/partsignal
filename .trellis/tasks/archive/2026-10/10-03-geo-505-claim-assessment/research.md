# GEO-505 权威入口与读取边界

用户指定所有 GEO 文档已读取；目标为501已建立的枚举和事实强关系上的纯声明阶段。

- contracts/database.md：Markdown事实合同（FactVersion资格/不可变）与末尾0054完整分析/复核单元；此文件超过注入长度上限，必须显式读取相关完整单元，不依赖注入截断。
- .trellis/spec/backend/database-guidelines.md：Markdown工作区/事实审核及事务所有权单元；超长文件同样显式读取。
- backend/app/schemas/geo_analysis.py：ClaimKind/Verdict/Severity、FactBinding、InputSnapshot和ClaimAssessment完整类型；代码由代理自行读，不注入context。
- backend/alembic/versions/0054_geo_analysis_contract.py 与对应SQL：已有Approved同产品非空、manifest强绑定、不可变和Run→Analysis→Fact写边界；本任务不改变这些机制。
- backend/app/services/geo_analysis.py：502别名冻结和精确提及；新阶段复用，不维护第二字典。
- 用户指定前置目标文档/ADR/依赖/实际基线见prd.md、design.md及evidence；后续Worker/revision、API/UI与指标不在505范围。
