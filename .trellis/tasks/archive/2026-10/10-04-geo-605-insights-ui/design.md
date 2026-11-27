# GEO-605 实现设计

## 边界
新增回答级 domain 与路由 /geo/overview、/geo/insights/answers；现有 /geo/insights/ 与print保持。总览只消费GeoOverview，洞察只消费GeoAnswerInsights；不跨接口join成同一业务快照。可从总览按同筛选进入洞察。七个GET沿既有generated contract，不新增API、数据库或公式。

## 状态与展示
base filters为URL所有者；查询参数由同一model转换，query key包含完整base。detail descriptor由服务端投影、规范成URL，详情分页/period/cohort也是URL。切换base清除selector；后台同key临时失败保留快照并显示错误，权限或失效错误隐藏旧快照，跨key不用旧数据placeholder。AbortSignal取消读取。current/previous cell key引用仅在同DTO内定位，不计算业务结果。按维度和subject显示业务cell；质量服务端允许操作聚合。SVG只把原始value映射坐标，null不画为零，每张图具可访问表格。sample/trend/changed-dimensions全部来自服务端。

## 文档差异
目标filter-options/sample-level筛选/平均排序/增强引用变化/机会未由当前602～604合同提供，不在605新增后端能力或客户端计算。身份筛选沿运行中心已存在的UUID列表输入方式，可多选并保留历史身份；不从当前Catalog反推历史指标。OpenAPI和DB保持原像。实时as_of不同，详情404显式告知cell已变化并允许刷新摘要，不静默切换cell。

## 文件所有权
主代理：model/API/filter/metric/overview/performance/page/detail/routes/nav/tests与文档；独立implementer：evidence-sections.tsx及其相邻组件测试（引用、风险、质量展示），不编辑其他文件、不Git。结束fresh只读reviewer检查URL、旧路由及可访问/只读风险，复核不写生产代码。

## 验证
基线已有Geo/Run/Nav组件398通过。候选做generated API check、全部最低命令、针对性组件/路由与真实HTTP浏览器流程；根make e2e全门禁按用户明确要求运行，不扩展607大容量基准。
