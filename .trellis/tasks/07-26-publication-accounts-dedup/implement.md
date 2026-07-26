# 实施计划

## 1. 契约和迁移

- [x] 更新 `contracts/openapi.yaml`：账号更新/启停路径、请求 Schema、`revision` 和错误响应。
- [x] 新增 `0026_publication_account_dedup`：数据预检、trim、revision、检查约束和同平台规范化唯一索引。
- [x] 更新 ORM 与 `contracts/database.md`，不修改冻结历史迁移或 `migration_schema_v1.py`。
- [x] 重新生成 `frontend/src/shared/api/schema.d.ts`。

验证：

```bash
cd backend && pytest -q tests/integration/test_migrations.py
cd frontend && npm run api:generate && npm run api:check
```

## 2. 后端账号命令

- [x] 增加严格字符串边界、`PlatformAccountUpdate` 和 revision 响应。
- [x] 创建账号写入 trim 后原值，并按规范化标识返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`。
- [x] 增加编辑、启用、停用服务与路由；复用平台→账号锁顺序、revision、权限和审计。
- [x] 确认账号原值不进入审计详情、异常或日志。
- [x] 扩展 PostgreSQL 集成测试：同平台多账号、跨平台同标识、大小写/空白重复、编辑冲突、revision、启停和候选过滤。

验证：

```bash
cd backend && pytest -q tests/integration/test_publication_review_closure.py
```

## 3. 后端发布门禁

- [x] 在 publication 服务增加单一“平台 + 内容哈希”事务锁和冲突检查。
- [x] 在人工发布登记保留幂等重放后接入门禁。
- [x] 在 `mark-published` 写结果和事件前接入同一门禁。
- [x] 集成测试覆盖进行中阻断、未公开 REJECTED 换账号、曾 PUBLISHED/VERIFIED 后永久阻断、REMOVED/VERIFICATION_FAILED、跨平台允许和并发命令。

验证：

```bash
cd backend && pytest -q tests/integration/test_publication_review_closure.py -k "publication or platform_account"
```

## 4. 前端路由和交互

- [x] 新增 GEO 问题库页面路由并移动现有 Topics UI；业务设置只保留发布账号。
- [x] 更新 AppLayout、route loader/prefetch 和导航测试。
- [x] 缺账号链接携带 accounts Tab 与当前 `platform_profile_id`。
- [x] 发布账号页增加编辑、启停、revision 载荷和内部标识说明；删除仍仅管理员可见。
- [x] 人工发布 Drawer 增加“本篇文章只能选择一个账号”说明。
- [x] 更新前端组件测试，至少覆盖导航、定向跳转、规范化冲突错误、编辑/启停和单账号提示。

验证：

```bash
cd frontend && npm test -- --run src/app/AppLayout.test.tsx src/features/publications/PublicationsPage.test.tsx
cd frontend && npm run typecheck
cd frontend && npm run lint
```

## 5. 权威文档和全量检查

- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md`：GEO 问题库位置、内部运营账号、多账号单选和重复公开发布规则。
- [x] 更新 `.trellis/spec/backend/publication-workbench-guidelines.md`，固化账号和发布判重不变量。
- [x] 检查 OpenAPI、Pydantic、生成 TS 类型、ORM、迁移和文档的一致性。
- [x] 运行后端目标集成测试、前端测试/typecheck/lint/build。
- [x] 使用项目 `playwright-cli` 做最小浏览器验收：GEO 导航、缺账号定向跳转、账号新增/编辑/启停、Drawer 单账号提示。

最终验证：

```bash
cd backend && pytest -q tests/integration/test_migrations.py tests/integration/test_publication_review_closure.py
cd frontend && npm run api:check && npm test && npm run typecheck && npm run lint && npm run build
```

## 6. 风险与回滚点

- 迁移预检发现规范化重复账号时立即停止，不运行后续 Schema 变更。
- 账号 API/生成类型未同步时停止前端实施，不增加手写兼容类型。
- 发布门禁测试若无法证明并发串行，停止交付，不用前端禁用替代。
- 代码回滚可恢复旧行为；数据库 downgrade 只移除本 revision 新增约束/revision，不删除业务历史。
