# GEO-306 实施与验证证据

当前状态：completed（manifest：done）；本会话用户已人工审查并接受实现与测试证据，验收日期2026-10-02。

启动时in_progress。依赖done。起点分支geo/GEO-306，已有脏改动保留，起点SHA及文本在evidence。

## 基线

`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_batch_policy.py backend/tests/unit/test_geo_answer_contract.py backend/tests/unit/test_geo_batch_creation_contract.py backend/tests/unit/test_geo_manual_collection_contract.py`：1419 passed。

`docker --context colima compose -f .trellis/tasks/10-02-geo-306-read-model/evidence/compose.validation.yaml run --rm backend-test pytest tests/integration/test_geo_batch_creation.py tests/integration/test_geo_answers.py tests/integration/test_geo_manual_collection.py`：69 passed。

初始Colima停止/default context；已启动专用partsignal-geo306-validation Postgres/Redis/fake-OSS，未使用生产库。无业务编码前先输出12项preflight。


## 已取得的候选证据

五个GET已接线；13个读模型组件与根OpenAPI及generated一致；无新数据库schema、迁移或回填，Alembic head仍0051_geo_manual_collection。所有GET认证前RR/禁autoflush；应用不写、不锁、不commit、不推进revision。状态计数取最新cell、attempt及费用取全部尝试，SQL状态筛选和纯策略共享规则；文件仅签名访问。

- 读取合同/批次策略：776 passed（read-unit-final.log）。
- 初始读取集成：10 passed（read-integration-corrected.log）。
- RR交错/固定查询：3 passed（read-consistency-corrected.log），实际含认证SELECT分别Batch列表6/详情5、全局Run列表5/批次Run列表6、Run详情9。
- contract-unit-corrected.log：406 passed；首次make-test-unit.log的两处元数据断言失败已修正。
- make lint：ruff与前端ESLint通过；make typecheck：mypy142个源文件及前端tsc通过。
- make test-unit：后端2717、前端1067 passed，最终证据make-test-unit-final.log。
- make contract-generate及make contract-check：runtime/OpenAPI/generated全部一致。
- 首次读取集成失败原因：测试错误地原地改历史Prompt正文，以及复用前序helper做相同Profile更新；改为合法停用/直接创建批次，没有削弱数据库守卫。固定查询测试预期多算一次认证SELECT，观测后校正为9/5/6/5/6，生产查询未为测试增加语句。

fresh critical_reviewer只读复核未确认需修复问题。主代理检查当前review rollout的23次只读exec与1次跨代理通知，没有写文件/Git/测试/容器操作；工具证据review-tool-inventory.json，完整结论independent-review.md。WorkPlan/dispatch/summary/digest全部验证，Audit Bundle关闭并audit-verify通过，无异常；audit_id=20261003T042753Z-geo-306-f3cefb77。配置表只表示Agent TOML profile，不推断账号额度或会话默认配置。

## 最终验收与状态

`make test-integration COMPOSE='docker --context colima compose -f .trellis/tasks/10-02-geo-306-read-model/evidence/compose.validation.yaml'`：769 passed / 16 warnings，399.59s。警告来自未修改的迁移metadata比较测试：既有FK循环排序及dialect_options，未作为失败处理。完整门禁包含旧head前滚、非空0050证据保留/0051安全停止；无GEO-306 Alembic或数据回填，没有生产前滚操作。

新增筛选miss/字面%_、计划范围、排序和五端点强制改密反例后：`docker --context colima compose -f .trellis/tasks/10-02-geo-306-read-model/evidence/compose.validation.yaml run --rm backend-test pytest tests/integration/test_geo_read_models.py tests/integration/test_geo_read_consistency.py`，15 passed（read-integration-final-verified.log）。完整门禁之后只修改测试及文档，生产代码/合同/依赖/环境不变，复用完整门禁，定向覆盖新增测试。补充测试首次未限制Subject命中共享历史，第二次忽略Plan默认repeat_count=3；已按Schema明确subject范围与repeat_count=1，没有放宽断言或改业务代码。

`git diff --check`通过；候选格式与补充测试ruff检查通过。根合同/generated同步；Task JSON、Task Brief与manifest均从planned→in_progress→review，未done/归档/提交/推送/PR/部署。implement/check jsonl各3项验证通过，当前session仍指向本任务。GEO-307保持planned。

完整命令/结果记录于evidence/validation-results.json；任务起点对比candidate.patch与changed-files.json区分已有脏改动。前端仅generated，无route/query key/URL/页面变化；未运行浏览器E2E，因为没有新增UI旅程。没有真实AI/Collector调用、真实Aliyun OSS验证或大历史性能基准；只读GET不HEAD对象，实际存在性由受控下载验证。时间线只表示已保存的四类时间，不推断完整状态审计；分析/复核/指标/机会/重测明确NOT_IMPLEMENTED/null。

环境已恢复：仅删除本任务Compose容器、网络和两项geo306卷，Colima stop成功；colima status返回预期的not running，Docker context恢复default。证据environment-cleanup.log。没有清理其他项目资源或改生产数据。


## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-306 的实现与测试证据。”据此仅将manifest的GEO-306从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节、原始evidence及独立复核审计保留验收前历史状态、实际验证与已知限制，不改写测试结果。本次仅记录GEO-306人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；未重跑实现阶段测试。
