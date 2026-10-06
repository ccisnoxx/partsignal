# GEO-106：完成 Catalog 纵向验收和产品引导

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-106 / R1 |
| 状态 | completed（manifest done；2026-10-02 本会话用户人工验收完成，原验证结果保留） |
| 负责人 | Codex / 777 |
| 依赖 | GEO-105：manifest done、task completed、2026-10-02 人工接受 |
| 分支 | geo/GEO-106（任务开始时已在此分支） |
| PR/Commit | 本任务不提交或创建 PR |

## 2. 目标

管理员可按使用说明，从现有 Product 建立唯一活动 OWN_PRODUCT 监测身份，维护竞品、别名和精确域名。真实 API 纵向验收证明 Catalog 操作不改写产品身份、事实草稿、已批准 FactVersion 或审核历史。

## 3. 关联需求

CAP-GEO-01；REQ-GEO-SUBJECT-001～004 的当前 Catalog 子集。WBS GEO-106：E2E 创建 OWN_PRODUCT/竞品/alias/domain，补充使用说明和测试证据。REQ-GEO-SUBJECT-005 的历史分析快照由 GEO-502 实施，本任务不验证尚不存在的分析能力。

## 4. 必读文档

已读根及 backend/frontend AGENTS、`.trellis/workflow.md`、各层 spec 索引/质量规范/E2E 隔离合同、GEO-101～105 记录和 GEO-105 人工验收；以下目标文档均在实施前读取：

- docs/geo-monitoring/README.md
- 04-delivery/01-implementation-roadmap.md、02-work-breakdown-structure.md、04-codex-execution-guide.md、05-task-template.md、task-manifest.yaml
- 01-product/01-product-vision-and-scope.md、02-geo-core-prd.md、03-information-architecture-and-page-spec.md
- 02-business/01-business-architecture.md、02-domain-model.md、03-workflows-and-state-machines.md
- 03-technical/01-technical-architecture.md、02-data-architecture.md、03-api-contract-design.md、04-frontend-architecture.md、07-testing-and-quality.md
- 05-decisions/ADR-001-extend-modular-monolith.md（Accepted）
- contracts/openapi.yaml 的 Catalog/Product/FactVersion 协议、contracts/database.md 的相关合同、0044_geo_catalog 及当前模型/服务/锁序/路由/测试和 Catalog 页面。

## 5. 当前行为

PostgreSQL 已有 Subject/Alias/Domain，OWN_PRODUCT 名称来自当前 Product，没有独立名称副本。12 个 Catalog API 已实现 ADMIN 写入、CSRF、revision、精确 409；页面 `/configuration/geo-entities` 已实现，ENGINEER 只读，域名不执行 DNS/HTTP，无本任务 Worker。

基线：后端 Catalog API/并发 24 passed；前端 Catalog 5 文件/63 passed；contract-check passed。缺口：Catalog 浏览器测试使用 fixture，缺真实链路及完整产品事实前后对比；文档有 GEO-105 历史 review 和早期建议路由。

## 6. 目标行为

真实页面完成 Product/批准事实准备，随后创建 OWN_PRODUCT、竞品品牌/产品、alias/domain 并读回持久化结果；重复绑定拒绝且草稿保留。数据库比较整个 Product 行、FactVersion 和审核记录；浏览器比较事实协议及产品身份。刷新恢复 URL/数据，ENGINEER 无写入口。

## 7. 范围内

- [x] 后端产品事实不变验收测试。
- [x] Playwright real API Catalog 纵向用例，登记到既有隔离 E2E 入口。
- [x] 使用指南、索引、测试矩阵及 Task Brief/验证证据。
- [x] manifest in_progress → review。

## 8. 范围外

不新增 Catalog 能力、不改运行时服务/路由/组件；不创建 Batch/Run、采集、指标、分析、机会或真实 AI 调用；不实现 GEO-502/GEO-504 或其他任务；不升级依赖、提交代码、迁移生产或改变安全边界。

## 9. 业务不变量

1. 一个 Product 最多一个活动 OWN_PRODUCT；停用身份可保留，启用须再检查唯一约束。
2. Catalog 只维护监测配置，Product/Markdown 草稿/已批准事实及审核历史保持原值。
3. OpenAPI/generated 类型是公共协议权威；权限、状态转换、校验和删除阻断由服务端裁决。
4. PostgreSQL 唯一业务状态源，不改 Redis/外部调用协议。

## 10. 契约变化

### OpenAPI

无 operation、请求、响应、枚举、错误码或 revision 变化；不重新生成类型。

### Database

无 schema、触发器、FK 或数据迁移变化；复用 Alembic 0044_geo_catalog，隔离空库 upgrade head，无生产迁移。

## 11. 后端实现

### Router / Application Service

只加测试，保留事务与锁序 Product → 旧/新品牌 UUID 升序 → subject → child。实际修改父 revision +1，无操作不递增。SQLSTATE/约束继续映射 PRODUCT_EXISTS、ALIAS_EXISTS、DOMAIN_EXISTS、IN_USE 和 REVISION_CONFLICT，无自动重放。

### Query / Worker

不修改查询或 Worker。快照使用已提交读取，涵盖完整 Product、全部 FactVersion 和审核记录，避免只比较 UI 名称。

## 12. 前端实现

不改路由、search params 或 query key。验收 subject_id、搜索、刷新恢复、409 保留输入、ENGINEER 只读。既有 fixture 用例验证布局和键盘，真实业务测试使用 desktop 项目。

## 13. 测试计划

- Unit/Component：用户指定既有集合，不增重复内部断言。
- PostgreSQL：真实会话/API 建立批准事实；Catalog 成功和失败后整个事实聚合严格相等。
- Contract：make contract-check，无 drift。
- E2E：无 page.route；UI 写入/API 最终读回，真实 201/200/409；核对请求次数和未出现 Product/facts 写请求；沿用秘密登记与扫描。
- Security/Ops：保留 ADMIN/CSRF 集成覆盖；隔离 DB、Redis DB14/15、storage，清理 task-owned 环境。

## 14. 验收标准

1. Given 已批准事实的 Product，When 建立/配置监测身份，Then Product 行、草稿、版本及审核历史不变。
2. Given 活动 OWN_PRODUCT，When 重复绑定，Then 409 GEO_SUBJECT_PRODUCT_EXISTS，只有一个活动身份且草稿保留。
3. Given 竞品/别名/域名，When 刷新/搜索/只读访问，Then 持久化关系与规范值正确，ENGINEER 无写入口。
4. 指定验证实际执行并记录，状态只推进 review。

## 15. 验证命令

```bash
git diff --check
make contract-check
make lint
make typecheck
make test-unit
make test-integration
npm --prefix frontend run test
npm --prefix frontend run typecheck
make e2e
make verify
```

Compose 使用 evidence/compose-validation.yaml 和 project partsignal-geo106-validation；精确命令和结果见 implement.md。先运行新测试定向集合。

## 16. 数据和上线

无功能开关、回填、生产部署或新 migration。测试样例凭据、独占端口 55446/56386。E2E harness 自建/销毁 owner-token 数据库和临时 storage，Redis 专用 DB14，集成 DB15；最终销毁本 project 卷并恢复 Colima 初始停止状态。

## 17. 风险与开放问题

| 风险/问题 | 处理 |
|---|---|
| 工作树已有大量 GEO-001～105 修改 | 保存起始 SHA256/status，不覆盖已有工作 |
| Product 删除投影新增监测引用 | 数据库整行/浏览器身份事实比较，允许 deletion blocker 正常变化 |
| fixture 与 real API 混淆 | 单独 real-stack 文件，无路由拦截，公共 API 读回 |
| 产物可能包含会话秘密 | 复用 secret registry/post-run scan，仅报告路径与状态 |
| 用户规定的业务/授权/依赖阻断 | 停止并 blocked；环境限制准确记录，不伪称通过 |

## 18. 完成证据

evidence/start-files.json、start-status.txt、manifest-before.yaml 保存起始状态；baseline-integration.log（24）、baseline-frontend.log（63）、baseline-contract.log。最终 implement.md 追加精确命令、结果、前滚和清理。无 PR/commit/生产迁移，合同不修改；2026-10-02 人工验收完成，接受依据见 implement.md 的人工验收章节。

## 19. 后续任务

GEO-502 冻结字典分析、GEO-504 引用/证据由对应 task 执行，不提前实现；GEO-106 已完成人工验收；后续任务不在本次收尾范围。

最终结果：见 implement.md 的逐项表。全部最低命令实际执行；Catalog 验收通过，但完整门禁存在上传断言/编辑器焦点两项范围外失败，不以定向通过代替完整门禁通过。
