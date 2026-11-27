# GEO-506 权威单元与当前调用入口

本文件是本任务的读取索引，不替代根合同。长文超过 Trellis context injection 限额时必须主动定位并读取完整相关段，不能只依赖自动注入。

- `contracts/database.md`：完整读取 GEO-501（0054 输入/结果/复核/指针）与 GEO-506（0055 Worker）段；受影响的事实引用与历史删除约束仍适用。`contracts/openapi.yaml` 是公共 HTTP 权威，本任务未修改字节，不提前接入507 operation。
- `.trellis/spec/backend/database-guidelines.md`：使用实际 PostgreSQL、加法迁移、不可变历史、显式安全停止与事务/行锁相关段；本任务不修改旧 revision。
- `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`：分析 Worker/revision、采集提交后接线、lease/恢复与末尾506当前实现段；采集外部 at-most-once 与预算仍由既有405/406/407拥有。
- `docs/geo-monitoring/04-delivery/task-manifest.yaml` 与 WBS：506依赖502/503/504/505/405均done；507 planned。首轮 planned→in_progress，交付只review。
- `backend/alembic/sql/0054_geo_analysis_*`、`0054_geo_current_analysis.sql`：PG hash、分析冻结输入/绑定、PENDING子结果与终态装配、仅pointer UPDATE；0055两个SQL是新增Job/分类表及三侧deferred lease守卫。
- `geo_analysis_inputs.py` 与 `geo_batch_snapshots.py`：首轮用Run冻结字典；重分析冻结当前同身份/角色Catalog；事实选择/装配复用505；PG是hash唯一owner。
- `geo_analysis_execution.py`：协议/不可变快照→内部只读输入，四段已有纯规则→归一化结果；本地计算，无外发。没有把生命周期反向塞入纯规则`geo_analysis.py`。
- `geo_analysis_runs.py`：Batch→Run→Analysis→Job锁序；claim/提交/失败短事务，事务外计算；首次Run镜像lease，后续Run不回退，最新成功指针只前进。
- `geo_analysis_dispatch.py` 与 `worker.py`：Redis/Celery稳定ID；数据库派发记录、节流、补投递、真实expired再仲裁；关闭开关仍允许安全过期终结。
- `geo_reanalysis.py`、`geo_surface_locks.command`：最新User→Batch/Run，active/password/ADMIN/expected_revision校验，创建与最小成功审计原子，commit后投递。
- `test_geo_analysis_worker*.py`：真实PG/Redis/Celery、失败/重复/迟到、current pointer、Run-only负例、原始证据保留；0055迁移使用非空0054历史，未部署生产。

已按用户要求读取全部目标文档与Accepted ADR-002/003；差异、范围和停止条件见`prd.md`/`design.md`。实际命令、初次失败与最终证据见`implement.md`及`evidence`。
