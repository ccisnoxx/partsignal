# GEO 数据完整性与人工文章观测实施计划

## 实施步骤

1. **契约与迁移**
   - [x] 更新 `contracts/database.md` 和 `contracts/openapi.yaml`，定义人工观测、逐篇结果、候选投影及历史兼容边界。
   - [x] 新增 `0018_manual_geo_observation`，显式区分旧模型结果与新人工文章观测；禁止破坏性 downgrade。
   - [x] 更新 ORM，不修改冻结的 `migration_schema_v1.py` 或历史 revision。
2. **服务端单一权威**
   - [x] 增加按产品查询当前可观测发布候选的投影。
   - [x] 重写新观测创建 Schema 与服务：完整候选集合、产品归属、发布状态、最终链接、二态结果及截图类别统一在事务边界校验。
   - [x] 保留旧观测只读投影；更正链只允许同类型、同产品追加。
   - [x] 扩展实时指标，只让当前有效人工观测进入文章推荐率。
3. **前端登记与展示**
   - [x] 删除目标问题、联网开关和旧模型评估表单，改为产品驱动的人工搜索登记。
   - [x] 产品选择后加载全部文章候选，逐篇强制选择“已推荐/未推荐”，文章 URL 只读展示。
   - [x] 至少上传一张已验证结果截图后才能提交；成功后失效观测、指标和工作台缓存。
   - [x] 列表与工作台展示人工文章指标，同时保留旧观测只读展示。
   - [x] 删除全局 Modal Header sticky 定位。
4. **测试与生成契约**
   - [x] 后端测试覆盖成功登记、候选完整性、跨产品/状态/链接变化、截图缺失或类别错误、旧历史读取和指标分母。
   - [x] 前端组件测试覆盖产品选择、逐篇标记和截图必填提示；新载荷由 E2E 覆盖，不对 jsdom sticky 坐标作断言。
   - [x] 更新 E2E 主流程为人工文章观测载荷。
   - [x] 重新生成前端 OpenAPI 类型并检查契约漂移。
5. **收尾一致性**
   - [x] 检查代码、迁移、契约、任务文档和稳定开发规范是否一致。
   - [x] 检查 diff 中不存在模型联网调用、重复 URL 状态、旧字段静默默认或无依据兼容分支。

## 目标验证

优先运行最小检查：

```bash
make contract-generate
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test -- GeoObservationsPage DashboardPage
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app backend/alembic/versions/0018_manual_geo_observation.py backend/tests
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run typecheck
```

数据库行为验证：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest backend/tests/integration -k 'geo or migration'
```

条件允许时再运行：

```bash
make lint
make test-integration
make build
make e2e
```

## 关键测试矩阵

- 产品存在 2 篇当前文章：两篇都标记且有截图时成功；任一漏标返回 `GEO_PUBLICATIONS_CHANGED` 或明确完整性错误。
- 跨产品文章、`REMOVED`/`VERIFICATION_FAILED`、空 `final_url`、重复文章均失败且事务无部分写入。
- 附件为空、未验证、非 `OPERATION_SCREENSHOT` 均失败。
- 新观测只记录人工搜索字段，旧模型字段全部为空；旧观测仍完整返回且逐篇状态为未评估。
- 原人工观测被更正后不进入当前文章指标，历史记录和附件仍可追溯。
- 没有文章结果时 `article_recommendation_rate=null`；推荐数加未推荐数等于文章结果数。
- 弹窗标题随容器滚动，键盘关闭和焦点语义仍由 Ant Design 保持。

## 回滚点

- 迁移前备份 PostgreSQL；存在人工观测后禁止 downgrade 删除新语义。
- 候选集合或逐篇结果校验不一致时停止 GEO 新写入，不增加前端过滤或服务端默认值绕过。
- 前端异常时可停止发布 GEO 页面；已经写入的观测、文章结果和截图不得删除或改写。

## 停止条件

完成上述功能和验证后停止；不自动提交、不推送，不扩展自动搜索、OCR、趋势图或优化建议。
