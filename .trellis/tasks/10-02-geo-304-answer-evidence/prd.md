# GEO-304 Task Brief

## 1. 基本信息
GEO-304 / R2；本会话用户已人工审查并接受实现与测试证据，manifest=done、Trellis=completed，验收日期2026-10-02；负责人主代理；依赖GEO-301=done（manifest及人工接受记录核实）；分支geo/GEO-304。实施经历planned→in_progress→review，现按用户明确验收完成收尾；未提交/发布或操作生产数据库。

## 2. 目标
原始回答、UTF-8 SHA256、原始引用位置、截图/raw payload受控文件关联和不可变最终防线。

## 3. 关联需求
WBS GEO-304完整行；CAP-GEO-05、AC-RUN-01/02、AC-SEC-02；Accepted ADR-001 F06、ADR-002、ADR-003 F04。

## 4. 必读文档
用户指定README、roadmap、WBS、execution-guide、task-template、manifest、PRD、页面规格、领域/状态机、技术/数据/API/前端/Worker/质量、ADR-001/002/003；GEO-301 prd/design/implement、GEO-002 review；根/backend/frontend AGENTS、Trellis workflow/spec、根合同、0048/0049、Run/FileRecord/存储/清理及相关测试。当前行为以代码/根合同为权威，目标草案按Accepted ADR对齐。

## 5. 当前行为
任务开始时head0049，无回答快照/回答级Citation。旧GeoObservation独立；上传有真实字节SHA256及HEAD校验，清理只认三类旧外键。前序dirty成果起点留evidence/baseline，不覆盖。

## 6. 目标行为
一Run至多一非空快照，哈希覆盖原UTF-8字节。HTTP(S)引用规范URL去重、保留首次URL/标题及全部位置。VERIFIED内部文件才可关联；清理保护引用。快照/引用禁止UPDATE/DELETE和提交后新增引用。

## 7. 范围内
两表ORM、Schema/OpenAPI components、0050迁移、URL规范化、闭合summary、文件资格/稳定锁/HEAD与清理集成、数据库最终防线、定向测试及指定门禁、generated类型和任务文档。

## 8. 范围外
GEO-305草稿/submit/幂等/分析派发，GEO-501分析表/current pointer，GEO-504归属分类，GEO-805浏览器捕获/裁剪；无Collector/Worker/真实平台/指标/机会/运行API页面或旧观测迁移。

## 9. 业务不变量
PostgreSQL唯一权威；本次无Redis投递。原始字节/位置保留；secret不进summary。文件RESTRICT而非SET NULL；证据与分析分离，未知搜索null。Router无事务/ORM写入，本次无Router。

## 10. 契约变化
仅新增标准证据components，无operation。数据库geo_answer_snapshots/geo_answer_citations，命名CHECK/UNIQUE/RESTRICT FK/触发器。0050 down=0049，只expand，零历史回填。既有成功Run无可补证据时明确拒绝迁移；禁止破坏性降级，前向修复/一致备份恢复。

## 11. 后端实现
未来Application Service锁Run→UUID排序FileRecords，校验上传者/资格/HEAD并与快照、引用、Run采集事实同事务提交。内部文件函数不commit/推进状态。storage拥有对象metadata检查，file_records拥有清理，证据与URL独立模块。唯一键裁决重复快照；证据无编辑revision；未知完整性失败传播。

## 12. 前端实现
仅generated schema.d.ts，无路由/query key/URL/页面状态或可用提交入口变化。

## 13. 测试计划
Unit：原文hash、URL/IDNA/scheme/控制字符、去重位置、闭合summary与OpenAPI真实payload。真实PG：0049非空前滚/metadata/旧数据、文件资格/HEAD/GC/锁竞争、UPDATE/DELETE/迟到引用与提交原子性。全部指定命令。无新增完整用户旅程，E2E不适用。

## 14. 验收标准
直接SQL不能改正文/哈希/引用位置/文件引用或已引用文件完整性；提交后不能追加Citation。summary拒绝秘密键和字符串叶子。缺失/未验证/公开/错类别文件或HEAD不符明确失败；GC不删除被引用对象。

## 15. 验证命令
基线：相关unit662 passed；PG基线31 passed。git diff --check、make contract-check、make lint、make typecheck、make test-unit、make test-integration（专用Compose）、uv run --project backend alembic -c backend/alembic.ini upgrade head（专用DATABASE_URL）及定向pytest。结果见implement.md/evidence。

## 16. 数据和上线
仅加法迁移，不改变开关，无生产操作。专用PG16/Redis/fakeOSS。证据保留天数/raw删除墓碑由GEO-901定义，当前保护全部引用。恢复采用前向修复或备份，不删历史。

## 17. 风险与开放问题
按Accepted ADR删除草案原始表派生分类/SET NULL。无批准追踪参数清单，保留query顺序和值；只规范scheme/host/IDNA/default port/空path并移除fragment。业务blocked限用户五项，环境阻断记验证限制。持久化/文件并发边界要求独立只读critical_reviewer。

## 18. 完成证据
起点/基线/实际命令/migration/合同/增量diff/独立review见evidence与implement.md。实现阶段交付review；现依据用户明确人工验收更新manifest=done、Trellis=completed，completedAt=2026-10-02。原始证据保留，未提交或归档。

## 19. 后续任务
GEO-305、GEO-501、GEO-504、GEO-805、GEO-306读模型和GEO-901保留命令，本次均不实施。
