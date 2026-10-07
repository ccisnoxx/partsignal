# verify 入口修复与复验记录

## 范围与基线

本次是 GEO-906 人工接受之后的本地测试入口修复。GEO-906 的 manifest=done、Trellis=completed、原始 `make verify` 退出 2 和生产 NOT_STARTED/NOT_VERIFIED 均保持原样。基线为原记录的普通集成 1116 passed / 54 failed / 6 setup errors，以及补齐环境后的 82 项文件相关测试和 6 项恢复测试通过。

确认根因：backend-test 的 depends_on 只有 PostgreSQL/Redis，fake OSS 初始停止且没有健康检查；恢复用例要求显式 RECOVERY_PG_BIN/GEO_RECOVERY_PG_CONTAINER，容器里没有这三种 PG 工具或 Docker CLI。私有配置文件存在不能代替进程就绪或执行工具配置。

## 候选修改

- Makefile 的完整集成入口保留所有测试：普通集合在容器运行，恢复文件在下一条必跑的宿主机命令运行；任何失败停止 Make。没有修改测试断言或加入 skip。
- fake OSS 增加进程 HTTP 健康检查，backend-test 等待 fake OSS、PG、Redis 都 healthy。
- 新维护脚本只读取开发 Compose test profile 的测试身份，确认唯一正在运行的 postgres 容器、127.0.0.1 发布端口并显式传给现有恢复 fixture。没有给测试容器挂载 Docker socket，也没有安装生产工具或操作业务主库。
- PG* 环境覆盖显式拒绝；现有 fixture 继续限制随机来源库/恢复库、密钥配对、SIGTERM 和精确清理。
- 更新开发对象存储运行规范，明确完整入口与单独恢复入口。

OpenAPI、数据库合同、Alembic revision、业务事务/锁顺序/revision/状态机、前端路由/query key/URL 状态均无变化。Browser 生产开关和生产服务未操作。

## 本次执行证据

- `make test-geo-recovery-integration` 第一次退出 2：Compose 未激活 test profile，读取配置时缺 backend-test（recovery.log）。修正查询的显式 profile 后重跑，6 passed in 18.80s，退出 0（recovery-corrected.log）。
- `PGHOST=unapproved.invalid ... python deploy/scripts/test-geo-recovery-integration.py` 退出 1，进入 Compose/测试前拒绝 PG* 覆盖（recovery-pg-override-rejected.log）。这是预期失败边界验证。
- 新脚本 ruff 与 `git diff --check` 已退出 0；最终候选还需记录后续门禁结果。
- 完整复验由 run-verify.py 调用原始 `make verify`，显式设置开发回环数据库连接和 E2E Redis DB 13，不写 env 文件、不缩小测试过滤。启动前 DB13=0 键，DB14=6 键，DB15=63 键；不删除 DB14/DB15 的未知键。E2E runner 继续检查 DB13 无外部客户端、端口独占和清理归属。
- verify.log 保存新完整门禁结果；原 GEO-906 validation-results.json 未覆盖。

## 状态

完整 `make verify` 已退出 0，独立只读复核未确认阻断问题；本次后续任务进入 review。生产 smoke、生产停止/恢复演练未运行，本次无生产授权或生产证据变化。

## 最终复验结果

| 命令/检查 | 实际结果 |
| --- | --- |
| make verify（run-verify.py 仅设置开发回环连接和专用 Redis DB13 后调用） | 退出 0；verify.log |
| make lint（另行独立执行） | 退出 0；lint.log |
| make typecheck（另行独立执行） | 退出 0；typecheck.log，mypy 249 source files 无问题 |
| make test-deploy-scripts（另行独立执行） | 退出 0；test-deploy-scripts.log |
| git diff --check | 退出 0；最终写入后复核 |

完整门禁：后端单元 3783 passed；前端单元 1285 passed / 135 files；普通集成 1170 passed / 43 warnings / 602.05s；恢复集成 6 passed / 17.43s；10 万样本性能 1 passed / 558.37s；前后端构建、Browser 本地合同和部署脚本通过；真实栈 E2E 32 passed / 4.0m；GEO API enabled、api-disabled、monitoring-disabled 每阶段 1 passed / 1 既有 mode skip，合计 3 passed / 3 skipped；前端 fixture E2E 498 passed / 74 既有条件 skipped / 6.6m。没有增加 skip、修改断言或降低阈值。两份 Compose config --quiet 均通过；这只验证本地配置语法。

各真实栈阶段完成随机 owner 数据库删除、临时对象存储移除、队列键和监听端口释放。最终 Redis DB13=0、DB14=6、DB15=67；没有清扫 DB14/DB15，DB15 保留测试运行后的状态。Docker context 为本机 colima。日志权限为 0600；本任务日志中未匹配到与 example 不同的已读取私有长密钥值（扫描范围见 log-privacy-check.json；不把有限扫描当穷尽保证）。

本次没有 OpenAPI/数据库合同、Alembic revision 或业务数据迁移。既有迁移在隔离测试库前滚到 0065_geo_observability；真实 dump/restore、错误密钥、缺失对象和 SIGTERM 清理场景通过。事务/锁顺序/revision/幂等/并发及错误映射沿用现有业务所有者；Make/pytest 失败直接传播，不假成功。前端路由、query key、URL 状态未修改。

独立复核执行摘要已生成并校验通过，Audit ID `20261006T015455Z-verify-entrypoint-4daba9dc`。实际 diff 已检查，只增加本轮测试编排及对应说明；其余既有工作树改动保留，未提交、推送或归档。

未运行：生产 smoke、生产恢复/停止演练以及远端 GitHub Actions。生产目标、固定 clean candidate 与各阶段人工批准仍缺失；本次不改变 GEO-906 原 NOT_STARTED/NOT_VERIFIED 限制。修复仅针对本地 Make 入口，CI 独立 pytest 编排未修改/未验证。原 GEO-906 的失败、后续分项通过、人工接受及 done/completed 状态均未覆盖。
