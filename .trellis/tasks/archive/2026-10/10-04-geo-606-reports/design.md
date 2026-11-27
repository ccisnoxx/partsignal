# GEO-606 实现合同

## 报告
六个GET和GeoReportPreview已先写入根OpenAPI；Schema在backend/app/schemas/geo_reports.py。报告单RR调用geo_answer_insights.get_insights，as_of严格等于insights.as_of，generated_at数据库clock_timestamp；当前候选0=NO_DATA，合格0=NO_ELIGIBLE_RUNS，available=false；仍保留真实质量/排除。formulas服务端说明所有实际输出指标（业务geo-answer-v1；质量geo-overview-quality-v1）；method_notes指出实时、样本非显著性、完整维度、费用未知分币、缺机会。无归档报告/持久化快照；后续归档需冻结run/analysis/review/版本，不在本任务暗加。

## CSV
固定4操作，不接受fields或自由选择器。使用GeoOverviewFilters，半开created_at/latest attempt/冻结binding/review_policy与现有洞察一致。runs导出全部候选（含失败），保留状态/质量以防误当未提及；citations使用owned_citation_share资格及当前分类，按run/citation去重；claims使用通用资格，保留目标UNJUDGEABLE但不作分母。每条均含run_id/batch_id/current analysis ID/current review ID、日期、模式、topic/prompt/profile/surface及版本；只显式白名单。引用白名单保留citation_id/hostname/title/occurrences/归属及类别，不导出original_url/normalized_url，以免任意签名query外带；系统详情按citation_id查看原链接。不改已有URL规范化。声明允许claim_text，不导出fact_excerpt/explanation/完整回答/配置/raw/签名URL/凭据。opportunities明确501 NOT_IMPLEMENTED，不生成header-only成功、不建机会模型。

分批100个候选，按created_at DESC,id ASC keyset，事务内批量load_inputs；可为load_inputs增加keyword-only run_ids（默认路径完全不变）。SQL游标/会话归应用Service，RR+autoflush=false；使用同认证快照会话的请求生命周期或独立专有session，但须保证disconnect和迭代失败关闭。首条预取才200，空集409 GEO_REPORT_EMPTY、审计失败亦阻断；后续异常断流，不能继续假成功。不缓存全量行、不offset扫全表、不将全部结果Blob到JS。

CSV csv.writer引用/换行正确；文本检测先忽略前导Unicode空白/控制，首个=+-@、制表/CR/LF或控制风险添加单引号；不得覆盖原业务文本。UTF-8/BOM、UTC文件名固定已知种类，Content-Disposition和X-Report-As-Of，no-store。单条大字符串有已有字段上限。支持100k合成行常量内存的定向验证，不建607 100k Run数据库。

## 审计
现有永久审计只保留成功，不能引入FAILED伪成功。新增geo_report.export_started和geo_report.print_prepared，target GeoReport。facts仅export_type/as_of/filter_sha256（规范完整filters摘要），无原filters/正文/URL/凭据。export_started表示权限检查和首条预取已完成、开始发送，不表示全量到达；print_prepared表示打印数据交付准备而不是OS已打印。独立应用事务可复核User活动/角色/首次改密，审计提交先于200，主读取RR不提交heartbeat或业务状态。Session factory从调用db bind获取以支持隔离测试。Service负责事务，Router只认证/参数/response。已有请求session撤销/CSRF门禁不弱化；GET附加审计遵循现有user export惯例，无业务可变副作用。

## 前端
只用generated模型。geo-reports模型复用geo-insights的基础URL规范化及格式化工具（不导入内部展示组件）；路由composition可复用其筛选组件。单GET report，不浏览器join。独立key含全参数和preview/print；print静态表格与方法，layout=print复用壳层，专用print selector不扩散旧页面。预览可编辑完整基础筛选、进入洞察链接；从总览/回答洞察传原筛选打开报告。打印页保留筛选/生成/as_of/公式/样本/质量及不可用，不在不可用时渲染可打印完成入口。CSV用浏览器原生<a download>稳定same-origin API URL；显示空集/权限错误需独立恢复入口或通过请求头预检，但不能重复整量请求/Blob全量下载。可用小型预flight HEAD或同一fetch stream→File System API不适用；优先浏览器下载、前置说明空CSV由服务器明确错误并测试下载拒绝；页面不声称已完成下载。

## 取消并发验证后的补充
安装版Starlette的ASGI2.4路径允许原生asyncio.Task.cancel越过AnyIO shield，生产线程仍在next时不能close生成器或Session。CsvStream以同一RLock序列化完整next/close；异常内部关闭可重入。35 CSV单元（含修前失败的精确事件交错）及9真实PG验证，独立复核者重放确认一次释放。此锁只归流资源所有者，不引入DB业务行锁或状态锁。
