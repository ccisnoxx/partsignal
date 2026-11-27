# GEO-004 Task Brief：增加 GEO 渐进启用配置和安全默认值

## 1. 基本信息

- Task ID：GEO-004；发布：R0；状态：done（2026-10-01 用户人工审查并接受实现与测试证据；Trellis 为 completed）。
- 负责人：主代理；候选部署配置已独立只读复核，未确认阻断问题。
- 分支：geo/GEO-004；基线 HEAD：cd88fbf61d65018f7eb1a47b9f0f379ed47e3814。
- 依赖：GEO-003=done，Trellis completed 且有 2026-10-01 用户人工接受记录；GEO-001/002=done，ADR-001～005=Accepted。
- PR/Commit：未创建；不提交、推送、部署、操作真实服务或归档。

## 2. 目标

建立新 GEO 能力唯一的启动配置边界。四项全部默认 false，非法值和总开关关闭时启用子能力明确失败；API、Worker、Scheduler 使用同一 Settings 和同一部署 env 文件，R0 不创建任何自动任务或外部调用。

## 3. 关联需求

R0 WBS/manifest 未给本任务独立 CAP/REQ ID，不虚构编号。依据技术架构 §14、部署运维 §3、状态机 §13 和 ADR-005 的渐进启用要求。

## 4. 必读文档

已读根/backend AGENTS、.trellis/workflow、backend/infra/guides spec 索引及适用质量和 Production 配置规范；GEO README、治理、愿景、完整 PRD、领域模型、状态机、技术架构、质量、部署运维、路线图、WBS 完整任务行、执行指南、任务模板、manifest；ADR-001～005；GEO-002/003 记录。当前 contracts/OpenAPI GEO 路径与 Schema、database 的 GEO/共享约束、相关迁移、config/main/worker/Compose/生产预检和已有测试共同确认现状。

## 5. 当前行为

只有人工文章关系观测、历史模型记录、洞察与优化内容任务；无回答级 Run、Collector 或 GEO Beat 任务。四个 GEO 键不存在。API/main 与 Worker/Beat 均导入 app.config.settings；三套 Compose 共享 backend env_file。生产输入预检按模板精确键集合，新增键需保留旧 runtime 安全省略的路径。

## 6. 目标行为

缺省四项均 false，development/test/staging/production 一致。子开关 true 需总开关 true；每种采集子开关独立，不把 Browser 绑定为依赖 API。开关不替代权限、合规、预算或外发资格；开启配置不注册新任务或代表业务已经实现。旧生产文件可省略新四项，由 Settings 默认关闭；未知键、非法/空值继续失败，不注入第二份默认值。

## 7. 范围内

- [x] 四项 Settings 和配置校验。
- [x] env 示例与生产输入预检兼容。
- [x] Settings、生产边界、三套 Compose 及入口初始化 no-egress 证据；真实容器和 Worker/Beat 进程未验证。
- [x] 权威配置说明、Task Brief、验证记录、manifest review。

## 8. 范围外

GEO-005/203/204/405 及全部 R1+；Catalog/Profile/Run/Collector/Scheduler/Opportunity/预算/会话/恢复配置；公共接口、数据库与迁移；旧 GEO 行为、前端、依赖升级和无关重构；真实平台、远端配置与发布。

## 9. 业务不变量

PostgreSQL 权威、Redis 仅稳定 ID、模块化单体、Router 无业务写事务；保留旧 GEO 与历史读取、服务端资格、不可变证据；普通测试不调用真实 provider；新能力全部默认关闭，Production 缺省不启用。

## 10. 契约变化

OpenAPI：无 operation/schema/enum/error code 变化。Database：无表/列/FK/索引/trigger 变化。Alembic：无新 revision、前滚或数据迁移，现有源码 head 0043_geo_platform_identity 保持。

## 11. 后端实现

Settings 唯一拥有类型、默认值和跨开关校验；生产 host 预检保持输入/secret/literal 边界，将四项声明为可安全省略的新配置。main/worker/Beat 入口和 Router/Application Service/Read Model 不改；无 GEO 外部调用路径，无新 Celery task 或 Redis 载荷。

## 12. 前端实现

不适用；没有页面、路由、URL、query key、generated type 或状态变化。

## 13. 测试计划

Unit：默认值、全合法组合、非法布尔值、父子冲突、env 加载和进程快照。Production：有效合成生产配置、省略/空/非法子键、原安全边界和错误脱敏。Ops：实际 Compose config 解析后比较 API/Worker/Scheduler 的四项及 Settings 结果，用 socket 守卫观测 app/Worker/Beat 启动无外部调用。Contract：既有 contract-check。PostgreSQL、Collector、前端/E2E：未改变对应行为，不新增或执行专项；指定 make test-unit 自带前端测试照常执行。

## 14. 验收标准

1. 所有环境缺省四项均关闭，显式开启合法组合可读，非法配置启动失败。
2. API/Worker/Scheduler 从共享部署源得到相同配置；修改文件不宣称热重载。
3. R0 启动和 health/live 不调用外部服务，无 GEO task/Beat job 被创建；原 GEO 与公共合同保留。
4. 旧 Production runtime 省略四项仍安全关闭，其余必填/unknown/secret 规则保持。
5. 指定验证有实际退出码和日志；状态为 review，等待人工验收。

## 15. 验证命令

```sh
git diff --check
make contract-check
make lint
make typecheck
make test-unit
make test-deploy-scripts
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_configuration.py
UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-configuration.py
```

## 16. 数据和上线

无需迁移或回填。新字段不轮换旧 secret；旧生产文件省略四项时维持 false。受控配置更新后统一重建 API/Worker/Scheduler，关闭时不能撤回在途请求；后续业务 owner 必须在外部调用前重验开关。回退仅撤销本任务源码/文档或统一关闭配置，不降级数据库。本轮不部署。

## 17. 风险与开放问题

- 精确生产键集合：仅四项可省略，未知键和其他必填仍拒绝；实际 checker 测试。
- 进程配置漂移：Compose 真实解析对账、同 Settings 入口、说明统一重载。
- 误宣称启用：明确 R0 配置不代表采集资格，不提前实现后续能力。
- Docker Engine 可能不可用：精确记录 make test-deploy-scripts 的阻断，独立执行无需 Engine 的 Compose 配置检查。
- 只有用户指定的业务冲突/未批准破坏性迁移/指标状态安全变化/必需授权输入缺失/依赖未完成才 blocked。

## 18. 完成证据

见 [implement.md](./implement.md) 和 evidence/checks/。实施前相关 Unit 49 passed；实施后配置专项 45 passed、18 组 Compose 与入口探针通过，contract/lint/typecheck、后端 794 和前端 861 项单元测试通过。make test-deploy-scripts 实际 exit 2，Docker socket 缺失阻断前置镜像构建，未运行其后续测试。Pydantic 2.13.4 / pydantic-settings 2.14.2；无真实数据库、外部服务、Commit/PR 或 E2E 截图。独立复核和已校验的 SUBAGENT_EXECUTION_DIGEST 见 evidence/。

## 19. 后续任务

GEO-203 和 GEO-405 为直接后续，仍需各自其他依赖与人工验收；本任务不实施。Collector 资格策略由 GEO-204，业务外部调用门禁由相应后续任务拥有。
