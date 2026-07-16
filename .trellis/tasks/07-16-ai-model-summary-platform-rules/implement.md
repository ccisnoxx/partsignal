# 实施计划

## 0. 启动门禁

- [x] 本计划获用户批准后，才运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-16-ai-model-summary-platform-rules`；本轮不运行。
- [x] 保持主工作目录在 `main`，不创建分支；再次记录 `git status --short --branch`。
- [x] 把用户现有 `AGENTS.md`、`.trellis/config.yaml` 修改列为永久排除项，不改写、不暂存、不提交；任务目录中的 planning 产物单独识别。
- [x] 在任何实现写入前冻结完整脏文件清单；本任务未识别的 `.codex/skills/**`、根 `package*.json` 或后续并发出现的其他修改同样一律保留并排除，发生路径重叠时停止并报告。
- [x] 实现前加载 `trellis-before-dev`，按 inline 模式由主会话直接实现和检查，不派发 implement/check 子代理。
- [x] 不执行 `git pull`：主工作区并非干净状态，且本任务不需要用同步远端扩大范围。

## 1. 正式环境模型摘要证据门禁

- [x] 在任务目录创建脱敏 `evidence.md`，记录证据时间、页面 URL、渠道 ID、发布版本、DOM 集合、渠道摘要集合、模型明细集合、资源哈希和最终分流；禁止写入 Cookie、CSRF、API Key、敏感 Header 或无关响应正文。
- [x] 使用已有管理员登录态先做普通加载，采集渠道卡片 DOM、`GET /api/v1/ai-channels`、`GET /api/v1/ai-channels/{channel_id}/models` 和页面脚本/样式资源哈希。
- [x] 退出后重新登录并重复只读采集；只有 DOM 与 API 不一致时，才比较禁用缓存重载前后的资源哈希，清缓存不得作为修复结论。
- [x] 按下列唯一分流执行并在 `evidence.md` 写明选择：
  - 三个集合一致：不修改模型业务代码，只补投影、Query 失效和部署验收回归。
  - API 摘要与模型明细不一致：核对 PostgreSQL 权威行，先增加能复现差异的失败测试，再修复后端投影或模型写路径的共同根因。
  - API 正确、DOM 错误：先证明实际资源版本或客户端生命周期差异，再修改对应部署/前端根因并增加回归。
  - 无法稳定复现：停止模型逻辑修改，保留证据；继续已确定的平台规则和事实版本工作。
- [x] 正式环境保持只读；模型新增、测试、启用、停用和删除的一致性只在自动化或受控本地 E2E 中执行。

## 2. 契约先行

- [x] 修改 `contracts/openapi.yaml`：
  - `PlatformProfileCreate` 删除 `rules`，创建响应改为“仅创建平台”，允许 `active_version=null`。
  - `PlatformProfileVersion` 增加必填 `platform_profile_id`。
  - 新增管理员 `GET /api/v1/platform-profile-versions`。
  - 在现有 `/api/v1/platform-profile-versions/{platform_profile_version_id}` 增加 `PATCH`，请求体为 `PlatformProfileVersionUpdate { expected_revision, rules }`，保留现有 `DELETE`。
  - 在现有 `/api/v1/fact-versions/{fact_version_id}` 增加管理员 `DELETE`，声明 `204/403/404/409` 和 `FACT_VERSION_IN_USE` 的统一错误信封。
- [x] 运行 `make contract-generate`，只更新生成文件 `frontend/src/shared/api/schema.d.ts`，不手写第二套传输类型。
- [x] 运行 `make contract-check`；契约检查未通过前不进入页面实现。

## 3. 后端：平台规则生命周期

- [x] 在 `backend/app/schemas/configuration.py` 同步创建、更新和输出 Schema；继续复用 `PlatformRules` 与 `PlatformProfileVersionList`。
- [x] 在 `backend/app/services/projections.py` 的唯一规则投影中补 `platform_profile_id`，同步更新 `backend/tests/unit/test_security_and_publication.py` 的冻结 HTTP 形状断言。
- [x] 精简 `backend/app/services/content_planning.py:create_platform_profile`，只创建平台身份；不隐式创建或激活首版规则。
- [x] 在同一服务增加 DRAFT 更新命令：`FOR UPDATE` 锁版本，按 `revision` 校验，只接受 `DRAFT`，更新 `rules`、递增 revision，并追加不含规则正文的 `platform_profile_version.updated` 审计。
- [x] 在 `backend/app/routers/planning.py` 增加管理员全局列表和 PATCH 路由；全局列表复用同一投影，按 `PlatformProfile.name ASC, PlatformProfileVersion.version DESC` 排序。
- [x] 保留现有按平台列表、创建草稿、激活、退役和 `configuration.py` 中的受约束删除；不新增 `current_rule_id`、绑定接口、兼容请求或第二套状态机。
- [x] 更新触及的 `PlatformProfileVersion` 模型、投影、服务 Docstring：DRAFT 可编辑，ACTIVE/RETIRED 和任务快照不可变。
- [x] 新增最小 `0015_platform_rule_draft_editing`：只替换 `partsignal_guard_platform_version()`，允许 `DRAFT → DRAFT` 更新 `rules`，继续冻结身份字段与 ACTIVE/RETIRED 正文；downgrade 恢复原触发器，不改写业务数据。
- [x] 在 `backend/tests/integration/test_migrations.py` 证明升级前 DRAFT 更新被拒绝、升级后仅 DRAFT 可更新、身份字段与 ACTIVE/RETIRED 仍被拒绝、降级后恢复旧门禁。
- [x] 在 `backend/tests/integration/test_publication_review_closure.py` 覆盖：无规则平台创建、全局列表归属/排序、DRAFT 更新、revision 冲突、ACTIVE/RETIRED 拒绝更新、激活原子替换、删除 ACTIVE 后无当前规则、既有内容任务引用仍阻断删除。

## 4. 后端：事实版本受约束物理删除

- [x] 在 `backend/app/services/product_facts.py` 增加 `delete_fact_version`：锁定目标版本，分别统计 `ContentTask` 和 `ContentVersion` 直接引用，使用现有 `in_use()` 返回完整非零引用清单。
- [x] 引用为空时统计从属 `FactReviewRecord`，追加 `fact_version.deleted` 审计摘要（仅产品 ID、版本号、状态、审核记录数量），显式删除审核记录后删除事实版本并在同一事务提交。
- [x] 新增最小 `0016_fact_review_cleanup`：为 `fact_review_records` 使用专用触发器，仅在 transaction-local 父版本 ID 匹配时允许 DELETE，UPDATE、未声明或错配 ID 继续拒绝；不改通用 append-only 函数与其他历史表，downgrade 恢复原触发器。
- [x] 删除服务在锁定、引用检查和审计之后设置事务本地父版本 ID，再显式删除审核记录；不使用全局开关、禁用触发器或 CASCADE。
- [x] 不按事实状态加删除门槛，不要求先 RETIRE；不修改外键为 CASCADE，不捕获外键竞态并伪装成功，不修改现有 `delete_product` 的逐版本确认边界。
- [x] 在 `backend/app/routers/product_facts.py` 增加带 `AdminUser` 和 CSRF 门禁的 `DELETE /fact-versions/{id}`；工程师请求必须在查询资源前返回 `403`。
- [x] 在 PostgreSQL 集成测试覆盖五种状态、审核记录同步清理、双引用完整 `409`、冲突零修改、管理员成功、工程师拒绝，以及清空全部事实版本后现有产品删除成功。

## 5. 前端：独立规则页面与事实删除

- [x] 在 `frontend/src/shared/api/queryKeys.ts` 和 `queryOptions.ts` 建立唯一的全局规则版本 Query；`PlatformsPage` 与新规则页共同复用，不再逐平台 N+1。
- [x] 新增 `frontend/src/features/configuration/PlatformRulesPage.tsx`：一次加载平台与真实规则版本；支持选择平台创建 DRAFT、编辑 DRAFT、受约束删除；把 `PlatformsPage` 现有规则字段移动到此页，不复制额外表单实现。
- [x] 精简 `PlatformsPage.tsx`：创建表单只提交平台身份；移除规则创建/管理弹窗；当前规则列只把本平台 DRAFT 作为切换目标并调用现有 activate；规则写操作统一失效平台列表和全局规则列表。
- [x] 在 `frontend/src/app/App.tsx`、`AppLayout.tsx`、`routeLoaders.ts`、`routePrefetch.ts` 注册 `/configuration/platform-rules` 和“平台规则管理”，同步更新路由/导航预取测试。
- [x] 在 `ProductFactsPage.tsx` 接入 `useAuth`，只用 `auth.isAdmin` 控制新删除按钮；保留工程师现有事实编辑、创建快照和审核操作，不把 `canEdit` 改成管理员专属。
- [x] 事实删除成功只失效当前产品的 `factVersions`；失败复用 `DeletionError`。在 `DeletionError.tsx` 增加 `CONTENT_VERSION` 中文标签，不新增页面私有错误解析。
- [x] 更新 `ConfigurationPages.test.tsx`，覆盖无规则创建、独立规则真实行、创建/编辑 DRAFT、平台归属过滤、激活与删除 Query 失效；更新 `routePrefetch.test.ts` 和必要的 `AppLayout.test.tsx`。
- [x] 新增聚焦的 `ProductFactsPage.test.tsx`，覆盖管理员按钮、工程师不可见、成功删除行刷新、结构化双引用错误，以及工程师原有维护操作仍可见。
- [x] 扩展 `frontend/tests/e2e/mvp-flow.spec.ts`：平台先创建为空，再创建/编辑/激活规则；模型发现多个但只启用一个时渠道卡片只显示已启用落库模型；事实版本受约束删除使用虚构本地数据。

## 6. 文档与稳定约束

- [x] 更新 `contracts/database.md`：`0015` 调整规则触发器，`0016` 限定从属审核清理；平台可无规则、DRAFT 可编辑、当前规则由唯一 ACTIVE 推导、事实版本受约束删除。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md`：独立规则页面、DRAFT 编辑、平台创建无首版、当前规则选择、事实版本删除；修正 `platform_prompts.platform_type_id` 为 `platform_profile_id`。
- [x] 更新 `docs/GEO系统前后端技术与部署方案.md`：只同步本任务涉及的规则可变性、独立页面和事实删除边界，不做无关文档清理。
- [x] 全局搜索并消除本任务触及范围内“平台创建即激活首版”“所有规则版本不可变”“事实版本永不可删除”等失效表述。

## 7. 验证顺序

- [x] 后端最小单元回归：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_security_and_publication.py`。
- [x] 前端最小回归：`npm --prefix frontend run test -- src/features/configuration/ConfigurationPages.test.tsx src/features/product-facts/ProductFactsPage.test.tsx src/shared/components/DeletionError.test.tsx src/app/routePrefetch.test.ts src/app/AppLayout.test.tsx`。
- [x] PostgreSQL 可用时先定向运行 `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -k 'platform or deletion or fact_version'`；否则直接以 `make test-integration` 作为首个数据库验证，不用 SQLite 替代。
- [x] 运行 `make contract-check`、`make lint`、`make typecheck`、`make test-unit`。
- [x] Docker 可用后运行 `make test-integration`、`make build`、`make e2e`。
- [x] 检查最终 diff 和搜索结果：除已批准的 `0015`、`0016` 触发器迁移外，无新规则实体、表、字段或当前规则字段；无前端模型二次过滤、无 N+1、无事实历史级联、无静默回退、无未说明行为变化。

## 8. Spec 更新与交付门禁

- [x] 完整质量检查通过后进入 Trellis Phase 3.3，更新 `.trellis/spec/backend/database-guidelines.md`：把稳定删除矩阵扩展到 FactVersion，并明确正常审核历史追加式与管理员删除无内容引用开发快照的边界。
- [x] 复核代码、OpenAPI、数据库契约、生成类型、测试、两份方案文档和 spec 描述同一关系；spec 更新不反向引入新需求。
- [x] 再次确认 `AGENTS.md`、`.trellis/config.yaml` 未被修改或纳入工作 diff；业务代码之外只允许任务证据、契约、生成类型、测试、spec 和已列方案文档变化。
- [x] 实现完成后先提交 commit 计划并等待用户另行确认；不自动提交、不推送、不归档任务。

## 9. 部署验收与回滚

- [ ] 前后端契约和应用必须同一版本发布；任一层验证失败不部署。
- [ ] 部署后只用正式登录态重复第 1 节只读模型摘要证据，确认页面资源哈希对应新发布版本；不在正式环境执行平台规则或事实删除写烟测，除非用户另行明确授权。
- [ ] `0015`、`0016` 不改写业务数据。应用回滚恢复上一版本镜像即可；不自动执行 Alembic downgrade，若显式降级则只恢复旧触发器。
- [ ] 若模型问题最终属于资源发布链，回滚到已验证前端资源并保留故障证据；若属于业务代码，回滚整版前后端，不能用前端过滤掩盖服务端错误。
