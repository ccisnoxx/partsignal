# Frontend V2 Phase 9 Production-like Rehearsal 设计

## 0. Development Closeout

本设计因 2026-08-29 的开发阶段范围决策停止实施，outcome=`CANCELLED_BY_SCOPE_DECISION`、Gate=`NOT_APPLICABLE`。下文仅保留历史规划，不构成当前或未来执行授权；未来 Production Release Readiness 必须按届时实际边界重新设计。

## 1. 设计结论

本 Task 是 sanitized snapshot 的消费端，不是数据脱敏 owner。最小结构是：子 Task 先独立交付可校验的 sanitized SQL dump；随后在一台专用临时私有主机上恢复 clone，复用现有 Staging Compose 形态和 V2 production image，只启动必要服务，执行现有 real-stack E2E 加一次带人工判断的 production-like 浏览器 walkthrough，最后按单独授权清理。

不新增通用 sanitizer、rehearsal orchestrator、deployment framework、监控平台或第二套业务 fixture。环境身份、授权和证据由任务阶段拥有，不进入产品配置。

## 2. 依赖合同

父 Task 只接受子 Task Gate=MET 的输出 manifest，至少包含：

| 字段 | 要求 |
| --- | --- |
| sanitized snapshot | 仓库外受控路径、字节数、SHA-256 |
| schema | 精确 Alembic revision，预期为当前已知 0043_geo_platform_identity |
| source | 脱敏后的环境标识指纹、只读角色/导出窗口证据；不含 DSN |
| sanitizer | 子 Task commit、脚本 SHA-256、字段矩阵版本、验证结果 |
| data profile | 关键表计数、状态分布、时间跨度和对象 metadata 计数 |
| object policy | production payload copied=0 |
| raw cleanup | raw dump/quarantine 已删除，或已获批准的隔离保留记录 |

父 Task 不获得 production source DSN、只读凭据、raw dump 或 production object credential。checksum、revision、manifest 或 Gate 任一不匹配即停止。

## 3. 环境拓扑与 owner

    sanitized SQL dump
      -> dedicated temporary private host
           -> isolated PostgreSQL clone database/role
           -> isolated Redis non-zero logical DB
           -> isolated fake-object namespace
           -> API + optional Worker + V2 frontend
           -> browser runner on host or approved private tunnel

- 临时主机不得承载当前 Staging/production；主机、防火墙、磁盘加密和访问 owner 在外部 preflight 中冻结。
- 无公网监听。Compose 的 localhost ports 只供主机内 smoke；若浏览器不在主机上，只建立单独批准、限时、私有的本地转发。
- 数据库、Redis、对象目录、Compose project、镜像 tag、session secret、AI encryption key 与 signing key都带唯一 run ID。
- clone 环境没有 production source 配置。所有真实 OSS、AI、邮件和第三方发布凭据为空。

## 4. Clone 恢复与迁移

1. 先校验 sanitized dump SHA-256，再通过现有 restore-verify.sh 恢复到显式 clone DSN。
2. 恢复后运行子 Task verifier，核对 revision、敏感字段断言、关键表计数/分布和 object payload=0。
3. 仅在 clone 上运行 Alembic upgrade head。若 snapshot revision 高于 candidate、未知或迁移失败，立即停止；不修改 dump、source 或 migration。
4. 运行 app.cli preflight-integrity。任何业务完整性问题按实际 P0/P1/P2 记录，不自动修复 production-derived rows。
5. 通过 seed-demo 只补充本轮 ADMIN/ENGINEER 测试账号；密码从仓库外环境变量提供，不进入 evidence。

## 5. 服务与副作用边界

复用 deploy/compose.staging.yaml，但只启动 postgres、redis、fake-oss、api、必要 worker 和 frontend；不启动 scheduler 或 migrate 常驻实例。

运行配置：

- APP_ENV=test；
- CONTENT_GENERATOR=deterministic；
- OBJECT_STORAGE_BACKEND=development；
- object endpoint 只指向本轮 fake storage；
- OSS、真实 AI、邮件和第三方发布 credential 为空；
- API/Worker egress 由网络规则阻断，而不是只依赖配置约定。

Worker 只有现有 real-stack 流程确实需要时才启动；任务结束前检查 Redis 只包含本轮 Celery keys。任何外部 DNS/TCP 命中、未知 Redis key 或 scheduler process 都是硬失败。

## 6. Production object 零复制

- 子 Task 只交付数据库 metadata/关系，不交付 production object bytes。
- clone object namespace 初始为空；既有 file record 的下载缺失必须显式 404，不伪造历史对象。
- 文件流只使用本轮无敏感 fixture，key 含 run ID；验证 PUT/HEAD/complete/GET/DELETE 后只清理这些精确 key。
- 因此本 Task 不证明 production 文件正文、真实类型或体积分布；该残余风险由 D3 明确接受。

## 7. Candidate 与 artifact

- candidate 在执行前从 clean main 固定，必须包含 bcb10d3b...；不使用旧 Staging candidate 代替。
- V2 image 由 frontend-v2/Dockerfile 构建并冻结 Git SHA、image ID、image digest/checksum、package-lock checksum、source-map policy。
- 先运行现有 V2 container smoke，证明 SPA fallback、asset cache、missing asset/map 404 和无 sourceMappingURL。
- 本 Task 不发布 production artifact，也不改变 Staging image/current。

## 8. 验证矩阵

### 自动门禁

复用现有九个 V2 real-stack specs：AI configuration、Product Facts、Content AI/Review/Version Detail、Publication Workspace、GEO、Auth Session 与 System ADMIN/ENGINEER。

它们只连接 clone API/V2 URL，所有写入归属本轮。另运行 legacy-routing 与 auth-session production-artifact specs，证明固定 candidate 的完整 redirect/return-to 合同。

### Production-like walkthrough

使用项目 playwright-cli skill 和唯一 session 名 production-like-rehearsal-<run-id>，在 clone 上只读选择已有 sanitized rows，验证：

- 核心列表在真实计数/分页/状态分布下可加载；
- Product、Content、Publication、GEO 代表 Workspace 可打开；
- ADMIN 正常、ENGINEER 对 System/Settings 保持 403；
- 一条 legacy direct 与 refresh 最终进入 canonical URL；
- console、pageerror、requestfailed、CSP 与失败资源均有归因。

需要写入的 revision conflict、上传/下载和状态动作由现有 real-stack specs完成，不在 walkthrough 修改 production-derived 历史。

## 9. Gate 与停止

Gate=MET 需要：

1. 子 Task manifest/Gate 完整；
2. candidate/artifact、clone 和隔离身份可追溯；
3. side-effect 配置与网络双重验证通过；
4. restore、revision、migration、integrity 和数据 profile 通过；
5. required automated/browser gates 通过；
6. production payload copied=0，fixture objects 精确归属；
7. open P0/P1/P2=0/0/0；
8. cleanup 完成，或得到精确的隔离保留批准。

任一项未知或失败即 NOT_MET。只记录证据，不自动改代码、修 production 数据、访问 production、重部署 Staging 或启动下一 Phase 9 Task。

## 10. Cleanup 与回滚

- 本 Task 无 production 写入，因此不存在 production rollback。
- 演练失败时先停止 frontend/API/Worker，再冻结 evidence；不删除现场。
- 删除 clone DB、Redis keys、object namespace、artifact 和临时主机分别要求精确授权及 owner 检查。
- cleanup 仅删除带本轮 run ID 且身份已验证的资源；禁止通配符、共享目录或范围外 Compose cleanup。
- 未获删除授权时停止服务、撤销访问、记录位置/owner/保留期限；后续删除仍需单独批准。
