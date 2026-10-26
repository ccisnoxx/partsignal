# MAN-02 本地实施与验证记录

## 交付状态
本地实现、必要定向验证、独立只读复核完成，task=review；completedAt=null，未部署、未记录用户验收。父功能清单MAN-02更新为本地待评审，下一推荐MAN-03，未提前实施。

## 实现
- 原人工草稿、最终提交与只读详情接入 citation_observation。四种显式状态：COMPLETE、NONE、PARTIAL、UNKNOWN；后两者必填原因。COMPLETE须有引用，NONE/UNKNOWN无引用，PARTIAL保留已知URL/顺序、原文和原始文件证据。
- 0070仅加nullable JSONB和约束、扩展原草稿校验，无默认值、无数据回填；旧不可变守卫覆盖新字段。历史NULL显示未记录，既有资格保持。降级55000拒绝丢失事实，前向修复或迁移前备份。
- 新提交缺声明422；旧回执检查在此之前，旧canonical JSON省略新增空字段，原hash及草稿no-op保持。
- 共用DTO→MetricRun资格路径让PARTIAL/UNKNOWN排除三个引用指标。NONE提供明确可观察无引用事实，仍需原分析/复核/分类/文件门禁；覆盖率可0/1，零引用份额仍null。不改公式、样本门槛、AI输入或分析版本。
- 页面包括状态/原因、冲突草稿比较、只读详情、未记录提示和提交字段错误。显式传递disabled至Base UI Select，冻结同时覆盖Portal选项。隐藏原因保留本地输入，但NONE/COMPLETE仅发送null，不让无关隐藏内容阻止提交。
- 根OpenAPI、数据库合同、人工SOP和指标说明同步；只刷新受影响文档hash。已有真实栈虚构fixture补显式声明，没有触发全量E2E。

## 实际定向检查
后端命令均在backend目录，以本轮专用PostgreSQL17（127.0.0.1:17339，虚构man02账号）与本地development对象存储19319执行，未接触线上或共享业务库。

```sh
.venv/bin/python -m pytest tests/unit/test_geo_citation_observation.py tests/unit/test_geo_metric_inputs.py tests/unit/test_geo_metrics.py tests/unit/test_geo_manual_collection_contract.py -o addopts='' -q --tb=line
```
161通过。覆盖组合校验、旧hash、NONE可观察无引用/零份额、部分/未知不得被分类完整或独立absence flag放行，原金标公式和资格保持。最初新增用例漏传dimensions，修正用例调用后最终选集通过。

```sh
PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://man02@127.0.0.1:17339/postgres OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:19319 .venv/bin/python -m pytest tests/integration/test_geo_citation_observation.py tests/integration/test_geo_manual_collection.py tests/integration/test_geo_manual_collection_boundaries.py tests/integration/test_geo_manual_cancellation_migration.py -o addopts='' -q --tb=short
PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://man02@127.0.0.1:17339/postgres OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:19319 .venv/bin/python -m pytest tests/integration/test_geo_citation_observation_migration.py -o addopts='' -q --tb=short
```
53+1=54通过。新四种声明真实HTTP保存/冻结/回执、文件与原文保留、新缺失声明拒绝、旧NULL请求按独立旧hash重放、数据库约束；另先停0069构造旧Answer/Draft再升级0070，除新列NULL外完整行JSON不变，元数据一致，降级55000保持版本。迁移fixture最初在根目录运行导致开发存储签名配置不一致403，随后按backend目录执行；继续修正fixture SQL绑定和摘要默认字段后通过。没有改变应用存储配置或放宽约束。两次元数据检查各出现现有SQLAlchemy循环外键/dialect_options警告，断言均通过。

```sh
.venv/bin/mypy app/schemas/geo_answers.py app/schemas/geo_manual_collection.py app/models/geo_answers.py app/services/geo_manual_collection.py app/services/geo_metric_types.py app/services/geo_metric_inputs.py app/services/geo_metrics.py app/services/geo_overview_queries.py
.venv/bin/python -c "from pathlib import Path; from app.tools.contract_check import check; print(check(Path('../contracts/openapi.yaml')))"
```
Mypy 8文件通过，公共合同检查0项差异。Ruff对8个应用文件、0070和直接受影响测试/fixture选集通过；对其余仅更新head期望的Python文件做AST解析，无部署脚本执行。

前端命令在frontend目录：

```sh
npm run api:generate
npm run api:check
npm run typecheck
npm run test -- src/domains/geo-runs/manual.model.test.ts src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/citation-observation.test.tsx src/domains/geo-runs/run-detail.test.tsx
npm run test -- src/domains/geo-runs/manual.model.test.ts src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/citation-observation.test.tsx
npm run build
```
最终相关选集28通过，复用未改变的Run Detail 3通过，共31个用例；新增Portal冻结反例已覆盖。初始新增测试访问mock.calls遇到类型错误，改用可观测命令断言后typecheck通过。api:check、typecheck、限定变更文件ESLint通过，最终生产构建通过（原有大chunk警告保留）。

一次性本地浏览器命令：`MAN02_BROWSER_META=<本轮临时元数据> node --input-type=module`，使用@playwright/test Chromium、production preview4174、真实FastAPI18319/PG17和真实已有raw证据。先显示未记录，提交字段错误且0写请求；键盘选择PARTIAL、填写原因与来源URL；375/768/1024/1440四宽度无横向溢出；一次POST201后Run Detail只读状态/原因/引用正确；0 pageerror。未mock业务HTTP、未操作外部网站或创建真实平台。复用的既有raw文件避免扩大为上传验收；该检查不关闭浏览器上传缺口。

## 独立只读复核
复用独立review agent，比较本轮baseline；确认历史NULL/旧hash、SQL/DTO、不可变触发器、共享总览/洞察/报告/机会读路径。发现P2：Select未显式disabled，冻结时Portal仍可选择。主代理修复并新增先展开再后台GET403的反例，22项相关前端通过；窄复核确认闭合，无新增阻断项。复核者未运行测试、未改文件。

## 边界与剩余工作
保留浏览器上传NOT_RUN_NO_EXISTING_PLATFORM；不接入浏览器自动化、不创建平台、不操作线上、不提交推送、不新增自动跟进，未重查OSS历史。未执行完整make verify、全量E2E、镜像/部署/真实服务或线上迁移验收。新增迁移仅在本地PG17验证，未宣称生产PG版本部署验证。MAN-03～06和其他原外部条件仍待后续授权/到位。

## 工作区与清理
基线HEAD与完整index patch保持一致，原74条暂存删除保留。只修改本任务列出的源码/合同/测试/文档/任务记录。临时PG、对象目录、API/preview/存储进程、Chromium、dist和本轮临时脚本/元数据在收尾清理；结果见最终清理记录。

最终清理完成：先关闭测试API（fixture回收数据库）、preview和开发存储；专用PG只剩postgres库后停止并删除精确数据/对象目录。Chromium已关闭，dist及本轮临时脚本、0600会话元数据、baseline与marker清理，无18319/19319/17339/4174残留监听。未删除旧未跟踪/暂存文件或共享依赖缓存。最终git diff --check通过；HEAD/index与本轮基线逐字节相同，74条原暂存删除保留。只清除本会话任务指针，task仍review，不归档、不提交。
