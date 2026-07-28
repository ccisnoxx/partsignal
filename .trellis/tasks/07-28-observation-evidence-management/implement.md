# 完善观测记录与证据管理：实施计划

## 1. 契约与迁移

- [x] 更新 `contracts/database.md`：独立事实、可选截图、整链删除、通用文件清理和前滚边界。
- [x] 更新 `contracts/openapi.yaml`：删除推荐/引用字段与相关人工指标，附件数组允许为空，新增观测 DELETE。
- [x] 基于实现时 Alembic head 新建迁移：
  - 删除人工逐篇 `recommendation_status/cited` 列和累计约束。
  - 保留旧人工 `discovered/mentioned` 空值，不猜测回填。
  - 为观测聚合四张表安装事务级 DELETE 门禁。
- [x] 运行 `make contract-generate` 更新前端生成类型。

## 2. 后端

- [x] 修改 Schema 与人工观测创建服务，移除累计阶段校验和截图最少一项限制。
- [x] 修改列表、详情、指标和洞察投影，删除人工推荐/引用口径，改用独立发现/提及/准确性。
- [x] 读取更正链附件并返回截至当前版本的有效证据集合。
- [x] 实现整链删除服务、路由、动作投影、错误码和安全审计。
- [x] 将 FileRecord 引用检查、调度和清理收敛为通用生命周期；平台 Logo 复用该所有者。

## 3. 前端

- [x] 表单只保留发现、提及复选项和可选准确性；字段互不禁用或清空。
- [x] 截图上传改为可选；更正展示已有证据，只提交本次新增附件。
- [x] 列表、Drawer、筛选、总览和 GEO 洞察删除人工推荐/引用展示及查询参数。
- [x] 当前人工观测行提供带确认的删除操作；成功后失效列表、指标、详情与文件查询。

## 4. 最小验证

```bash
uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -k "manual_geo_observation"
npm --prefix frontend test -- --run src/features/geo-observations/GeoObservationsPage.test.tsx src/features/geo-observations/GeoInsightsPage.test.tsx src/features/dashboard/DashboardPage.test.tsx
make contract-check
make typecheck
make lint
make build
```

PostgreSQL 集成测试必须覆盖：

- 三个事实任意组合、无截图创建、已有截图更正且不新增附件。
- 旧人工空值保持未知，旧模型读取不变。
- 整链删除、并发更正/删除、触发器反例、安全审计。
- 独占/共享附件、提交失败、存储失败重试和最终 `DELETED`。
- 指标分母和零分母 `null`。

## 5. Playwright CLI

- [x] 真实 API 创建无截图观测。
- [x] 单独选择发现、提及或准确性并成功提交。
- [x] 更正时看到原证据且无需重新上传。
- [x] 删除当前观测后整链从默认列表消失，附件对象最终不可访问。
- [x] 检查 console、requests、桌面和移动布局。

## 回滚点

- 契约与迁移完成后先执行迁移测试，不进入前端。
- 后端删除与文件清理通过后再接 UI 删除。
- 任一对象存储一致性失败时停止发布子任务，不新增临时清理路径。
