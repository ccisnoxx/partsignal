# PSR-007 证据索引

正式人工审查交付物，由PSR-007拥有；随本任务保留/归档。本目录不含生产配置、真实凭据或运行服务。

- `commands.json`和同名log：首轮五个实际Make命令，包含真实失败；`geo-recheck.json`及两份log：环境修正后的43项直接回归和最终GEO全目标。
- `scans.json`、四组开始/结束原输出和`references-*.tsv`：用户五条扫描，所有非空行分类；workflows输出为空且目录不存在，exit1如实记录。
- `compose-config.json`：Dev/Prod quiet及三种profile解析，只保存服务名/派生计数，无环境值；生产空模板不是可运行输入证明。
- `contracts-migrations.json`：根合同、前端生成类型、66份历史迁移指纹与Alembic head；三方实际一致性另见contract-check.log。
- `make-release-plan.txt`：发布目标dry-run；verify别名同输出，无默认Browser执行，不表示suite执行通过。
- `changed-files.txt`、`changes.patch`、`workspace-audit.json`：相对本轮初始脏工作区的17项增量与保护核对，不是所有前序工作区修改。
- `document-checks.json`：改写文档/任务链接、模板键值不变、138项GEO校验和、文档尾随空白检查。
- `cleanup.json`：本轮临时库/PG/存储/端口与系统临时目录精确清理；没有创建Docker资源。
- `final-acceptance.json`：最终review状态、实际成功/失败/未运行范围；完整发布被Docker阻断，不能解读为通过。

Collector log中的`GEO_CONTRACT_RESULT tests=0`是pytest退出码字段，实际执行数量由`208 passed`行给出；secret_scan=0表示日志/产物秘密扫描无命中。详细命令、环境、限制和人工验收项目见上级implement.md。
