# 实施计划：管理页面操作补齐与全站表格布局修复

## 实施顺序

- [x] 1. 开始实现前加载 `trellis-before-dev`，重读本任务 `prd.md`、`design.md`、`implement.md`、相关前后端规范、合同和待修改代码完整内容。
- [x] 2. 用源码搜索重新生成全站表格清单，与 `research/sitewide-table-audit.md` 的 24 张基线逐项核对；新增或遗漏表必须先补入清单再编辑。
- [x] 3. 更新 `contracts/openapi.yaml` 与 `contracts/database.md`，先固定已取消任务删除范围、阻断条件、错误语义和数据库守卫。
- [x] 4. 新增 `0033_task_owned_history_delete.py`，只为声明的目标任务放行 `source_job_id` 清空和内容审核记录删除，保持其他不可变/append-only 保护。
- [x] 5. 修改内容任务删除服务：采用与 worker/审核兼容的锁顺序，预检批准、发布、GEO/修复边界，写审计摘要并在单事务内删除任务自有历史。
- [x] 6. 修改内容任务动作投影：取消“任意生产历史都不可删”的旧门禁，列表与详情批量复用“受保护历史”口径。
- [x] 7. 补充后端集成测试，覆盖允许级联、全部阻断分支、事务守卫、回滚、动作一致性和关键并发竞争。
- [x] 8. 修改内容任务列表与详情：接入既有取消/删除 mutation，提供更多菜单和只读说明，移除完整 system/user 消息展示并重设 02A / 02B 布局。
- [x] 9. 修改发布记录更多菜单，让物理删除始终可发现并按服务端 action 可用或禁用。
- [x] 10. 固化最小共享表格不变量：可收缩省略、`TableRegion` 宽度边界、固定操作列不透明背景；更新前端组件规范，不新建表格组件框架。
- [x] 11. 第一组修复内容任务与产品事实 5 张表，逐表记录通过/修复结论并运行对应组件测试。
- [x] 12. 第二组修复发布与 GEO 9 张表，包含用户已报告三表和原生覆盖矩阵例外，逐表运行对应组件测试。
- [x] 13. 第三组修复配置中心、设置和用户管理 10 张表，包含弹窗表，逐表运行对应组件测试。
- [x] 14. 在同层 E2E 固化 24 张表显式清单，让对应页面、Tab 和弹窗在桌面与移动视口执行真实几何断言；在现有真实 tab zoom 设施中补齐五类代表表。
- [x] 15. 运行必需验证；失败时只修复能够归因于本任务的错误。
- [x] 16. 使用 `playwright-cli` 按清单复测页面身份、长文本、菜单、固定列、内部滚动、浅/深主题、控制台和失败请求，截图保存到仓库外。
- [x] 17. 加载 `trellis-check` 做合同、数据库、全表清单、数据流、测试和 diff 复核；不归档、不提交、不推送。

## 计划修改文件

### 合同与数据库

- `contracts/openapi.yaml`
- `contracts/database.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `backend/alembic/versions/0033_task_owned_history_delete.py`

### 后端

- `backend/app/services/publication.py`
- `backend/app/services/projections.py`
- `backend/tests/integration/test_publication_review_closure.py`
- 仅在现有测试无法清楚表达事务守卫时，补充一个同目录迁移/数据库集成测试文件。

### 前端

- `frontend/src/shared/components/TableRegion.tsx`（仅在宽度/焦点边界确需调整时）
- `frontend/src/features/content-tasks/ContentTasksPage.tsx`
- `frontend/src/features/content-tasks/ContentTasksPage.test.tsx`
- `frontend/src/features/product-facts/ProductsPage.tsx`
- `frontend/src/features/product-facts/ProductsPage.test.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.test.tsx`
- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.test.tsx`
- `frontend/src/features/geo-observations/GeoObservationForm.tsx`
- `frontend/src/features/geo-observations/GeoTopicsPage.tsx`
- `frontend/src/features/geo-observations/GeoInsightsPage.tsx`
- `frontend/src/features/geo-observations/GeoInsightsPage.test.tsx`
- `frontend/src/features/configuration/AIChannelsPage.tsx`
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`
- `frontend/src/features/configuration/AuditLogPage.tsx`
- `frontend/src/features/configuration/AuditLogPage.test.tsx`
- `frontend/src/features/configuration/ModelDiscoveryModal.tsx`
- `frontend/src/features/configuration/PlatformsPage.tsx`
- `frontend/src/features/configuration/PlatformTypesPage.tsx`
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
- `frontend/src/features/settings/SettingsPage.tsx`
- `frontend/src/features/settings/SettingsPage.test.tsx`
- `frontend/src/features/users/UserManagementPage.tsx`
- `frontend/src/features/users/UserManagementPage.test.tsx`
- `frontend/src/styles/workspace.css`
- `frontend/tests/e2e/shared-data.setup.ts`
- `frontend/tests/e2e/list-workbench-convergence.spec.ts`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`

以上是审计候选上限，不要求对已经通过全部几何不变量的表制造无效 diff。只有完整阅读现有测试后确认这些文件无法承载必要回归，才允许增加最小测试文件；共享实现只允许一个无业务逻辑的长文本叶子组件，不新增表格包装器或列工厂。

## 必需验证

在仓库根目录运行：

```bash
make contract-check
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_publication_review_closure.py -k "content_task and (delete or action)"
npm --prefix frontend run typecheck
cd frontend
npx vitest run src/features/content-tasks/ContentTasksPage.test.tsx src/features/product-facts/ProductsPage.test.tsx src/features/product-facts/ProductFactsPage.test.tsx src/features/publications/PublicationsPage.test.tsx src/features/geo-observations/GeoObservationsPage.test.tsx src/features/geo-observations/GeoInsightsPage.test.tsx src/features/configuration/ConfigurationPages.test.tsx src/features/configuration/AuditLogPage.test.tsx src/features/settings/SettingsPage.test.tsx src/features/users/UserManagementPage.test.tsx
npm run lint
npx playwright test tests/e2e/list-workbench-convergence.spec.ts tests/e2e/cross-page-visual-convergence.spec.ts --project=e2e --grep "全站表格|真实浏览器 200%"
```

迁移与触发器测试使用项目现有 PostgreSQL 测试容器；如果新增必要用例落在其他集成测试文件，向同一命令追加文件路径，不改为不覆盖数据库守卫的 mock 测试。

## Playwright CLI 复测

使用项目已有本地真实 API 测试栈和唯一命名会话，不修改线上业务数据：

1. `1440×1000`：内容任务列表和详情，核对取消/删除入口、删除确认、只读说明、追溯信息及 02A / 02B 等宽等高。
2. `1440×1000` 与 `375×900`：按 `research/sitewide-table-audit.md` 顺序访问 24 张表，记录表格身份、长文本单元格、相邻列、行高、固定操作列、文档/表格滚动宽度和键盘完整值入口。
3. 对 Tab、详情页和模型发现弹窗执行真实打开步骤，不能因顶级路由没有直接显示表格而跳过。
4. 使用项目现有浏览器缩放扩展覆盖真实 200% 缩放五类代表场景；不得用 CSS `zoom` 或 CDP 页面缩放代替。
5. 在浅色和深色下检查固定操作列及长文本状态，并运行 `playwright-cli console`、`requests` 核对框架错误覆盖层、控制台错误和失败业务请求。

截图输出到当前 Codex 可视化工作区下的新目录，保持仓库外。

## 可选重验证

以下检查不是默认完成前提；仅当针对性结果表明共享合同、状态机或样式回归，或用户另行要求时运行：

```bash
make lint
make typecheck
make test-unit
make test-integration
npm --prefix frontend run build
make e2e
```

## 验证结果

- `make contract-check`、前端 `api:check`、相关后端 Ruff/Mypy 均通过。
- PostgreSQL 集成用例已验证允许级联、全部受保护历史阻断、数据库事务守卫和 `0033` 升降级可逆。
- 前端 TypeScript、ESLint、主题颜色守卫通过；Vitest 24 个文件共 172 个用例通过，视觉合同 23 个用例通过。
- 列表工作台 E2E 4/4 通过；24 表清单在桌面/移动视口 2/2 通过；真实浏览器 200% tab zoom 2/2 通过。
- 开发数据库已实际从 `0031` 升至 `0033`；Compose 一次性测试容器受宿主 `/tmp/uv-cache` 权限阻断，等价的本地 PostgreSQL 集成命令已通过。

## 完成前审查

- [x] 允许删除的任务只清理任务自有生成作业、未发布内容和其审核记录，审计保留且不含正文/Prompt。
- [x] 已批准/曾批准、任意发布、GEO 或修复历史均在服务层稳定阻断，失败事务不产生部分删除。
- [x] 数据库只在精确事务变量下放行必要操作，普通不可变和 append-only 守卫仍有效。
- [x] 内容任务列表与详情、发布记录菜单都只消费服务端 `available_actions`，没有第二套权限或状态机。
- [x] 追溯卡不渲染完整 system/user 消息，02A / 02B 在目标视口和真实缩放下满足几何验收。
- [x] 全站源码表格清单与 24 张基线一致；每张表都有通过/修复/例外结论和浏览器证据。
- [x] 所有静态高风险与用户报告表均满足长文本、行高、固定列、内部滚动和完整值访问不变量。
- [x] 合同、数据库文档、迁移、代码和测试一致；没有新增依赖、全局抽象、兼容 fallback 或报告外重构。
- [x] 触及的 Python 代码、迁移、测试和开发者可见文本已完成中文文档审查。
- [x] 最终检查本任务 diff 与未识别文件；只给出提交计划并等待用户确认，不提交、不推送。
