# GEO-209 Task Brief

## 1. 基本信息
GEO-209 / R1，主代理负责，分支 geo/GEO-209，状态 done（2026-10-02 本会话用户人工接受，Trellis completed）；依赖 GEO-208=done（manifest 和人工接受 Trellis completed 已确认）。不提交、推送、发布或自行 done。

## 2. 目标
让 ADMIN/ENGINEER 从 URL 列表进入计划详情和分步向导，使用服务端运行预览与可定位 blocker 完成配置和状态操作，所有未保存输入在冲突、刷新和导航中受保护。

## 3. 关联需求
CAP-GEO-04；AC-PLAN-01/02；WBS GEO-209 完整行：分步向导、服务端预览、URL 列表、状态动作、dirty 保护；Vitest、路由、409、E2E 创建/启停计划；前端不计算最终 run_count，所有 blocker 可定位修正。

## 4. 必读文档
用户指定的18份 GEO 文档及根 OpenAPI/数据库合同；frontend AGENTS、相关frontend spec及infra E2E isolation；0047、GEO-206/207/208现有记录和Plan Schema/Router/策略、邻域工作区和测试。目标与当前差异见 design.md。

## 5. 当前行为
0047四表配置和守卫；GEO-208有12操作、完整详情/preview和typed actions/revision。无Plan页面；run-now为501，无Batch/Run/调度/外部采集，默认无生产估价。前序大量dirty变化留起点快照。

## 6. 目标行为
八步配置向导一次保存；服务端preview为唯一最终数量/费用/blocker权威；预览与当前草稿精确绑定；URL筛选和身份可恢复；状态动作经确认、revision提交与服务端重新裁决；409及后台刷新不覆盖输入。

## 7. 范围内
- [x] 计划列表/URL/详情和导航
- [x] 基本信息、对象、变体、profile、重复预算、调度、预览、保存八步向导
- [x] typed状态动作/复制/删除与确认
- [x] dirty、409、字段错误、异步响应和主体守卫
- [x] Vitest、真实UI创建启停E2E、文档和证据

## 8. 范围外
Batch/Run/执行快照/Worker/调度执行/外部采集/指标/机会/AI provider/生产部署/依赖升级/无关重构及其他GEO任务。

## 9. 业务不变量
状态、资格、最终run_count和费用只来自服务端；至少一个显式PRIMARY、prompt和profile；预算unknown保持null，不补零。草稿只在表单内，409无自动replay；available_actions不是授权；ARCHIVED只读复制。

## 10. 契约变化
OpenAPI/数据库无需变更，generated schema沿用；不新增Alembic，head0047，无存量数据迁移。

## 11. 后端实现
不改Router/service/事务/锁/状态机；复用GEO-208 User→资源→Plan锁序、CAS、原子审计与RR读取。run-now不调用、不实现。

## 12. 前端实现
/geo/plans canonical；URL q/status/schedule_kind/sort/page/page_size/selected/new/edit；plans.api.ts唯一query key owner，选项分页服务端搜索；RHF草稿和baseline独立于Query cache；DirtyGuard按编辑身份保护；取消旧读、principal continuation/卸载守卫；完整loading/empty/error/conflict/403/404/readonly反馈。

## 13. 测试计划
已有Plan单元基线与前端邻域基线；新增URL/动作/预览/可定位blocker、dirty/409及迟到响应Vitest；真实API+production artifact UI创建/启用/暂停/恢复与URL刷新，桌面/窄屏/键盘。完整门禁按用户要求，日志留evidence。

## 14. 验收标准
1. final run_count与服务端fixture/真实响应一致，无客户端乘法。
2. 所有typed blocker提供原因、资源及修正步骤/配置入口。
3. 409保留全部输入，只显式读取基线再由用户提交。
4. dirty离开/关闭/切换对象提示，筛选不重建草稿。
5. 创建/启用/暂停/恢复真实UI通过且刷新持久化。

## 15. 验证命令
基线：npm --prefix frontend run test -- src/domains/geo-questions src/domains/geo-catalog src/app/navigation.test.ts；env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py backend/tests/unit/test_geo_plan_management.py backend/tests/unit/test_geo_run_matrix.py backend/tests/unit/test_geo_plan_preview_contract.py。
最低：git diff --check、make lint、make typecheck、npm --prefix frontend run test、npm --prefix frontend run typecheck、make e2e、make verify；加定向Vitest/E2E和contract-check。

## 16. 数据和上线
无新DDL/迁移/历史回填/生产操作。当前default Docker context与Colima停止；仅本任务隔离PG/Redis/fake-OSS用于本地验证，收尾恢复。前端回退本任务源码即可，不修改数据库业务。

## 17. 风险与开放问题
preview草稿对应、CAS基线与后台缓存、迟到响应/主体切换、选项分页完整性。仅业务文档/ADR不可消解冲突、未批准破坏迁移、改变指标状态安全、必要输入授权缺失、依赖实际未完可blocked。

## 18. 完成证据
起点 evidence/baseline 与 starting-status.txt。基线前端15文件132passed；Plan单元133passed；最终前端111文件1067项通过，Plan真实栈通过；make e2e/verify的三项范围外失败及串行部署脚本通过结果见implement.md/evidence。独占验证栈已移除，Docker default context/Colima stopped已恢复。交付只到review，等待人工验收。

## 19. 后续任务
GEO-301/303、运行/调度/采集/分析/指标/机会等按manifest依赖后续实施，本次不做。
