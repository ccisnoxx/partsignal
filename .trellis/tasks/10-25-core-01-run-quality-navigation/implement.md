# CORE-01 实施与验证证据

日期：2026-10-25。状态：本地实现完成、定向验证通过，`review` 等待用户代码审阅；没有部署、生产验收、暂存、提交或推送。

## 实际交付

- `geo_run_quality.quality_and_navigation` 在既有 REPEATABLE READ 请求中读取 current 事实，复用 `load_evidence_inputs`、`metric_eligibility` 及总览同一个 `generic_exclusion_reasons`。未改公式、分母、样本门槛或状态机。
- 详情展示通用资格/原因、当前有效分析、复核、证据完整性、费用与模型版本覆盖，并为冻结对象提供 13 种现有业务指标的资格（REFERENCE 不展示 SOV）。缺少声明/引用事实只按既有规则排除对应指标，不补零。
- 历史尝试显式 SUPERSEDED_ATTEMPT；FAILED 即使重新分析成功仍 RUN_NOT_COMPLETED，保留采集终态。
- 洞察导航使用创建日 UTC + 冻结问题/采集配置范围，包含范围内全部对象；不声称是单次运行组成明细。机会导航来自真实历史来源，复测导航来自实际 baseline/request，GET 不执行业务写操作。
- 根 OpenAPI、运行时 Schema、generated 类型和所有仓内占位消费者同步迁移。提取共享指标/排除原因中文标签，洞察和报告继续消费同一标签表。API 设计文档已更新，无数据库迁移。
- FastAPI 会排除 nullable default；按 main.py 现有元数据修复机制显式保留 GeoOverviewFilters.mention_mode=None，保证根合同、TypeAdapter 与实际 OpenAPI 一致，不改业务默认。

## 定向验证与证据复用

测试均为本地，使用本轮独立 PostgreSQL 17 临时集群（127.0.0.1:16439）、临时数据库，以及开发对象存储（127.0.0.1:16440），不访问生产 Bucket/模型。PGTZ=UTC、development 适配器及临时签名值显式传入。

| 实际命令 / 选择范围 | 结果 |
| --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_read_contract.py backend/tests/integration/test_geo_read_models.py backend/tests/integration/test_geo_reviews.py backend/tests/integration/test_geo_r4_acceptance.py backend/tests/integration/test_geo_run_quality.py -q --tb=line` | 既有 41 项通过；当时新增 2 项因测试读取错误字段/未按真实来源挑选夹具而失败，修正后仅重跑受影响新增文件 |
| `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_run_quality.py -q --tb=line` | 最终 4 项全部通过：总览口径一致、真实导航、FAILED 重分析、旧尝试排除。复用未变输入的既有 41 项证据，合计 45 项 |
| `backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_read_contract.py backend/tests/unit/test_geo_overview.py -o addopts='' -q --tb=line` | 最终 nullable metadata 调整后 22 passed |
| `npm --prefix frontend run test -- src/domains/geo-runs/run-quality.test.tsx src/domains/geo-runs/run-detail.test.tsx src/domains/geo-runs/run-analysis.test.tsx src/domains/geo-runs/run-review.test.tsx src/domains/geo-insights/insights.model.test.ts src/domains/geo-insights/insights-page.test.tsx` | 6 文件、41 passed |
| `npm --prefix frontend run test -- src/domains/geo-runs/run-quality.test.tsx src/domains/geo-runs/runs-page.test.tsx` | 最终导航文案后 2 文件、10 passed；其中 3 项与首轮重叠，共 48 项不同定向用例 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-run-quality.spec.ts` | production build + 2 projects，2 passed；375/768/1024/1440、键盘、Back、洞察请求参数与复测身份；secret scan clean |
| `backend/.venv/bin/python -m app.tools.contract_check contracts/openapi.yaml`；`npm --prefix frontend run api:check` | 最终运行时完整合同和生成类型检查通过 |
| `npm --prefix frontend run typecheck`，E2E production build 的 `tsc -b` | 通过；node TS 项目精确包含共享纯测试 fixture，避免复制另一份数据 |
| 后端 `.venv/bin/mypy app/services/geo_run_quality.py app/schemas/geo_read_models.py app/services/geo_read_queries.py`（cwd backend） | 3 文件通过 |
| Ruff 检查 main、质量Schema/服务、共享调用者和相关测试；ESLint 检查本轮TS/TSX消费者及新E2E | 通过 |

初次后端运行缺开发对象存储，部分既有证据用例失败；补本轮本地临时服务后通过。共享符号迁移遗漏的 CSV/报告 import 已补齐。首次浏览器构建因 node TS 项目未包含共享纯测试fixture失败，精确增加 include 后构建及浏览器通过。没有把这些首次失败记为成功。构建仅有已有大 chunk 提示，没有扩大到拆包优化。

## 独立复核

`core01_review` 只读复核公共合同、current/历史、FAILED、复核、SOV、权限、一致快照和真实导航。发现全部冻结对象写入 maxItems=50 的筛选会违反合同；已改为问题/配置范围并同步文案。复核额外以纯内存验证 51 个对象完整保留、导航合同反序列化、REFERENCE/SOV、旧尝试和 FAILED/current 情形。补查 main.py 的 nullable metadata 两行通过；无未解决确认缺陷。

## 未执行与边界

未运行完整 make verify、全量 E2E、完整真实 Celery/Provider/OSS 栈、性能长测或线上验收。新增浏览器用例为显式 API fixture：目标页故意返回依赖错误，仅证明实际 router/API 参数映射；真实业务资格与关联由 PG/HTTP 用例证明，不宣称真实外部服务全流程通过。

OSS 浏览器 Logo 上传验收仍 `NOT_RUN_NO_EXISTING_PLATFORM`；自然清理 PASS、自动跟进 NOT_FOUND 保留且不追查。未创建平台、未改生产配置、未新增自动跟进；原外部等待事项和 CORE-02～06/AUTO-01～06 未实施。

## 收尾

本轮专用 PostgreSQL、临时测试数据库、开发对象存储进程及目录、production build 与 Playwright 结果目录均已停止/清理。未留下本轮临时服务或对象；保留源码、生成协议与本任务证据。最终 git diff --check 通过，OpenAPI 仅改变预期 8 个组件（含共享 nullable 默认元数据），paths 未变。已逐项对比原脏文件哈希与暂存补丁，原文件/暂存区完全保留；HEAD 仍 a4f9bbd581aa558cb3567d6da1f0c5509998bfd0。任务状态 review；已清除本会话活动指针，没有归档或记录用户接受。后端有效定向证据共 54 项不同用例，前端 48 项不同单元用例及 2 项浏览器用例。
