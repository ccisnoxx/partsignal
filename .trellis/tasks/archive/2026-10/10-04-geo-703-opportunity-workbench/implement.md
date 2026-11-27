# GEO-703 实施与验证证据

## 交付边界与依赖

仅703：四HTTP操作、Opportunity读模型、acknowledge/dismiss命令、历史证据、URL工作台及Drawer。702依赖已用户接受为done；开始703 manifest由planned→in_progress。实现及本地验证收敛后进入review，由人工接受；不done、不归档。没有704行动写入、705复测、706解决/继续或707完整闭环，也不启用生产开关。文档裁决与字段见design.md，完整Task Brief见prd.md。

任务启动记录1194已有文件SHA与可比内容，隔离前序dirty工作。当前703源码/合同/稳定文档47路径见evidence/changed-files.md及delivery-files.json；已有22路径变更，新增24路径，另E2E默认列表只增加703 spec一行。完整703差异保存delivery.patch，模型及Alembic文件与开始时hash全部一致。

## 后端、合同与数据库

新增GET列表/详情，POST /acknowledge和/dismiss。Router只拥有HTTP、认证/CSRF和响应；应用服务拥有RC事务、User NO KEY UPDATE→Opportunity FOR UPDATE锁、锁后资格/CAS、状态政策及原子成功审计。revision每次成功+1，ack仅revision，dismiss code/comment trim非空；终态无动作。重复/过期请求409 REVISION_CONFLICT，非法状态409 INVALID_STATE_TRANSITION，原因无效422，无自动重放/幂等key。任何业务、审计、flush/commit错误整体回滚。

列表/详情在认证前建立RR禁autoflush，total/状态/动作/来源共享as_of；全部维度/冻结采集模式/UTC半开创建时间/搜索/稳定排序/分页由服务端裁决。批量来源明确绑定保存的analysis/review身份，不跟当前pointer；最新评估仅按opportunity_id查询，旧机会不被新generation污染。首次trigger/source及last_seen_at不被处理命令修改；无答案/分析的RUN_FAILURE允许读取，不补造结果，必要关联不完整显式409。

原始证据文件签名与历史分析装配抽出真实共享所有者，Run既有读模型复用；保留15次固定Run查询约束，文件完整性/访问等级失败409、签名暂不可用503。Run投影显式SELECT公共字段，不读lease_token或凭据。GET不访问真实AI、不执行外部HEAD、不修改业务状态，详情no-store。人工原因/回答不进入审计；成功低敏facts仅revision/status。审计详情登记真实GeoOpportunity目标，复用管理员守卫与AVAILABLE/MISSING语义，关联链接可回到工作台。

OpenAPI新增4操作及36请求/响应相关组件，闭合枚举、字段和错误签名同步，existing paths/schemas无语义变更；generated frontend类型重新生成并校验。Database仅记录703事务、证据和处理语义；Alembic head仍0059_geo_opportunities，无新DDL、历史回填、数据迁移或生产迁移。独占PG测试实际从旧revision前滚至head，旧历史由既有守卫保留。

## 前端与状态

/geo/opportunities提供导航、全部API筛选、列表分页及Drawer来源分页；URL保存opportunity_id和筛选，刷新、Back/Forward恢复。列表/来源使用独立完整query keys、AbortSignal；正文和原因不进URL/storage。Drawer分开首次trigger、最新评估、冻结运行输入、历史回答/引用/签名文件、机器分析/批准事实、绑定历史复核与有效结果及处理记录。

服务端拥有workflow_stage/primary_task/available_actions，前端只作typed展示；只有确认和忽略。命令不重试，principal continuation阻止跨会话迟到结果；409保留原因草稿与固定提交基线，只有显式读取更高revision后解冻，被动刷新不替换。首载/空数据/越界/权限/缺资源/错误/恢复状态明确；403/404不显示旧证据或无效重试，后台错误暂停命令。Escape/焦点圈定/关闭归还焦点及dirty guard保留。原因按Unicode字符长度，UTC筛选保留秒/毫秒，新签名URL重新挂载失败图片。Drawer宽度使用与Sheet侧向规则同一选择器，避免默认sm:max-w-sm覆盖；窄屏满宽，桌面使用4xl上限。

## 基线和最终验证

基线107后端unit、126前端test、14真实PG通过。每条精确argv、exit_code、耗时及原始日志见evidence/*.json/log与validation.md。

- make lint、make typecheck、make contract-check均exit0；后端mypy216文件，运行时操作与根OpenAPI及generated类型一致。
- make test-unit：3637后端通过，133文件1242前端通过；最终单独npm --prefix frontend run test：133文件1243通过；单独前端typecheck exit0。
- make test-integration COMPOSE=独占配置：1046通过，31项既有SQLAlchemy循环FK/dialect_options警告。703/RR/安全定向10通过；最终补充审计登记后703 PG7通过，审计unit25通过；最后Drawer组件14通过。全量unit/integration之后的增量用对应定向证据核验，未再次重复全量门禁。
- make e2e完整exit0：canonical真实栈30通过（含703），三GEO开关阶段各1通过/1跳过，frontend browser498通过/68跳过；阶段过滤跳过71项不作通过计数。secret scan均clean，各owned随机数据库、Redis14键、端口与临时storage清理完成。
- 703独立真实栈旅程在新当前复核追加后仍显示保存旧复核；真实答案/批准事实/签名截图与引用→确认→忽略→刷新/Back/Forward；键盘、375/768/1024/1440与200%缩放无根溢出。最后宽度修正后e2e-opportunity-layout-final exit0，实际Drawer桌面宽度>700px、opacity=1，完整旅程再次通过；最终桌面/移动截图保存在evidence。
- git diff --check在最终Task状态/文档写入后重验，结果见diff-check-final.json。

原失败记录保留：过时固定合同计数/错误引用、夹具比较当前运行字段、无答案时共享文件查询提前跳过导致固定查询数回归、E2E优先级硬编码与正常AbortSignal GET误审计、审计目标漏登记。均先诊断后修复和定向重验；E2E取消例外严格仅两个GET+phase+net::ERR_ABORTED，不放宽POST或HTTP错误审计。

## 独立复核与剩余边界

Fresh只读critical_reviewer完成契约、并发、历史证据、权限与前端恢复复核，未确认阻断问题；另一次复用补充检查收尾审计目标登记，不计第二次独立复核。详evidence/review.md。audit_id 20261004T174106Z-geo-703-1cd7b1d3，validated SUBAGENT_EXECUTION_DIGEST及Bundle关闭/校验passed，4/4执行接受、1次独立复核、无残留活跃Worker。

没有独立复现机会命令等待锁期间停用/强制改密专项竞态，该部分依据共享User锁所有者、资格重验与已有回归证据。未执行真实外部AI、生产对象存储、生产迁移/发布或Browser Adapter验证：明确范围外。总览Opportunity卡片和机会CSV占位保持既有边界，703未接线。下一任务704行动关联，后续705/706复测与解决、707完整闭环，本次不实施。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-703 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次只记录人工验收，不重新实现或重复运行功能门禁。

本次仅收尾GEO-703，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
