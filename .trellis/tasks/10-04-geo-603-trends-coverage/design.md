# GEO-603 实现设计

## 责任与数据流

`geo_metrics.py` 拥有比较与覆盖分类；`geo_metric_views.py` 保存冻结窗口、比较原因及覆盖门槛。`geo_answer_insights.py` 是应用只读投影：调用 GEO-602 批量输入装配，在同一 REPEATABLE READ 事务中读当前和前期，转换内部结果到公共 DTO。Router 只处理 HTTP、身份与响应，不写 ORM、不加行锁。

两条新增 GET 为 `/api/v1/geo/insights` 和 `/api/v1/geo/insights/runs`。旧 `/api/v1/geo-insights` 的文章关系级接口独立保留。API 与组成样本共用同一筛选合同，`cell_key` 是完整冻结维度、目标和实际 SOV 集合的哈希；下钻的 period/cohort 显式表示来源。跨请求实时重新读快照，`as_of` 可以改变；失效 cell 返回 404，不能回退另一 cell。

## 窗口与不可比

当前 `[date_from,date_to)`，前期 `[date_from-(date_to-date_from),date_from)`。以原始 Run created_at 划分，批量读取合并窗口一次，再转换内部 window_key。参数必须带时区且规范到 UTC；前期超出可表示范围在洞察请求 DTO 返回 422。

趋势按 subject/prompt/profile/metric 锚定，保留各期所有 cell。只在每期恰好一个完整 cell 时比较；多个 cell 明确 MIXED_DIMENSIONS，绝不静默汇总。同问题、profile、模式、语言、地区、登录态、意图、采集模型/产品身份、规则/分析配置、冻结 subject revision 和事实绑定必须一致。时间窗口按上述规则移动；模型/产品版本改变或未知给出版本提示，不虚构版本。

实际 PRIMARY/COMPETITOR 集合改变显式 COMPETITOR_SET_CHANGED；公式版本改变、维度改变、缺窗口、无分母、低样本分别标记。除 SOV 依方法 §15 使用可报告门槛 3 外，普通趋势每期至少 5 合格运行。不可比时绝对和相对变化均 null。可比时 change_points 为原始比值差；前期为零时 relative_change=null，不造无限增长。

## 产品、平台、主题与 SOV

产品矩阵、平台表现、竞品表都引用原始 cell，不建立第二套计算或跨平台总分。筛选产品可以筛选输入适用绑定，却不能改变这些输入事先冻结的竞争集合；同集合的竞品 SOV 同时保留。

Mention/Recommendation SOV 分母是合格运行中的对象事件，不是运行数。PRIMARY/COMPETITOR 贡献；REFERENCE 不进入默认集合。点名 BRANDED 对自然可见和两类自然 SOV 不适用；组成样本仍能追溯排除原因。零事件分母为 null，合格运行数保持独立，不用事件数提升样本等级。

问题覆盖只使用当前期 UNBRANDED natural_visibility。跨主题计数显式形成覆盖 stratum：移除 topic/prompt 身份与 revision，其余维度和竞争集合完整保留。全部变体的 cell、分类、不可用原因和达标布尔值都保留；不会只返回最好变体。主题至少一个有 3 个合格运行且可见率 ≥0.6 的变体才达标。分开返回达标主题/实际监测主题，以及达标主题/有合格运行主题；无相应分母保持 null。

问题分类遵循方法：<3 DATA_INSUFFICIENT；≥3 且为零 NOT_VISIBLE；低于0.6 OCCASIONAL；≥0.6 且≥5 STABLE。文档未定义高比例3–4样本分类，保持 null/INSUFFICIENT_STABLE_SAMPLE，达标标记仍按可报告门槛判断。计划应监测主题数属于计划执行质量，不从当前可变计划补算历史分母。

accuracy 投影同时保留不可判断声明数；它不进入可判断声明准确率分母，避免 100% 掩盖大量 UNJUDGEABLE。

## 一致性、安全与恢复

复用 GEO-602 current analysis pointer、当前绑定 review、latest attempt 和完整性/权限边界。合并窗口固定 12 次应用 SELECT（含身份查询共13），不因 cell 数量增加逐行加载。读事务禁止 autoflush；无写事务、行锁、revision 递增、状态转换、幂等键、Celery消息或外部调用。

ADMIN/ENGINEER 可读取，现有 session/强制改密继续生效，响应 no-store。公共 DTO 不含 API key、lease token、headers、回答全文或受限事实原文；仅非敏感指标、冻结维度及 Run/analysis/review 稳定 ID。未实施的604细节和机会显式 unavailable。

无数据库表/列/索引、Alembic revision 或回填。0056仍为当前 head；回退新增只读源码和路由即可安全停止，不撤销历史记录。前端只更新 generated OpenAPI 类型，605负责页面、路由、query key和URL状态。

## 验证边界

独立公式金标覆盖 competitor set变化、样本不足、点名排除、混合维度、版本提示、零分母和相对零值；读模型金标保护所有变体、冻结集合和不可判断计数。真实 PG/HTTP 验证两窗口边界、贡献下钻、current review、RR并发与固定查询数、闭合输入与认证。用户要求的完整 lint/typecheck/unit/integration及契约生成门禁均记录精确 argv、退出码与日志。不运行真实外部平台或无前端变更的 E2E。
