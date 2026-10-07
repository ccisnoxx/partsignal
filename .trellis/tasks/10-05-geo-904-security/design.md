# GEO-904 专项复核设计

安全规则仍由现有权限依赖、Application Service、pinned transport、Schema/PG约束及视图组件唯一拥有。本任务不重建规则、不引入第二套门禁或生产扫描框架。

八项TEST-GEO-SEC优先映射现有最直接行为证据；发现的缺口仅补最小攻击反例。Prompt injection反例将恶意回答交给实际PG Analysis Worker，禁止外部transport、凭据解密、Python网络和进程能力，检查真实持久化结果/原文摘要、NEEDS_REVIEW及秘密不外泄；这只证明当前DETERMINISTIC，不假装存在外部分析模型。

部署检查明确三个证据层：仓库默认配置、独立本地测试运行、指定目标现场。已有901/903只属于前两层。目标入口和批准记录未知时为NOT_VERIFIED，不给false/0默认、不授N/A、不创建人工例外；只有用户必需输入缺失时在完成独立本地工作后blocked。

输出只保留稳定代码位置、测试命令、计数和状态。生产原始inspect/env/会话/密钥资料不可进入Task/Git。若存在材料，继续802保护/撤销/清理责任，未部署R7只有全量负证据才允许N/A。

凭据写矩阵使用真实ADMIN/ENGINEER会话，覆盖Key更新及Header新增/修改/删除；对敏感DB行只比较内存摘要，不把密文或明文输出到证据。拒绝请求不能改变配置/revision/成功审计。临时对象服务限定APP_ENV=test和/tmp自有根，结束只清理本任务容器，不启动原fake-oss或操作其他开发服务。
