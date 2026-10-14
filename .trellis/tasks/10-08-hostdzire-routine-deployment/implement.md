# 实施记录

## 范围与决策

基线 working tree clean，沿用 main。用户已授权实现推荐方案，本次只修改仓库；未执行 SSH、远程发布、Git 提交/push、数据清空或凭据操作。

代码验证与部署交付分离。Hostdzire Runbook §3 拥有验证选择与证据复用合同；修订 AGENTS、CI、E2E 与 Production spec，并为首次 GEO 交付的历史完整门禁增加适用范围说明，保留原验证结果与 Go 缺口。新增人工验证记录模板，不将其当可信签名或自动测试选择器。

新增日常入口由现有 manifest 认证的状态与部署 owner 裁决，包含 check/prepare/activate/smoke/restart。新候选须认证当前状态、实际 DB head、旧/新 manifest/archive 与迁移源码；同候选重启复用现有工件、锁/supervisor，保持 initialized 状态与 AI 待配置事实。维护检查固定 Production origin，Nginx 恢复仍独立进行。首次采用先交付包含新 owner 的正式候选，不能覆盖旧 release 的 tracked 文件或 manifest。

## 验证进度

- 文档 diff 与本地文件链接检查通过；两份修改的 GEO 文档摘要已更新并核对，证据模板保持 NOT_RUN/deployment_performed=false。
- 实现代理已交付，当前最终候选无遗留失败或运行中的检查，实际结果见下表。
- 独立 critical_reviewer 已完成最终只读复核：两项初版阻断修复后，无仍未解除的确认问题。
- 没有可用 Docker daemon；真实容器、Hostdzire、AI/OSS、现场业务与分阶段耗时均未验证。5–15 分钟为待测目标。

## 实际脚本验证

| 命令 | 结果 |
| --- | --- |
| `python3 deploy/scripts/test-production-routine.py` | 11 个测试通过，最终运行 18.061 秒；真实 CLI/state、本地 HTTP、隔离 fake Docker 合同 |
| `python3 deploy/scripts/test-production-ai-handoff.py` | 9 个测试通过 |
| `python3 deploy/scripts/test-upgrade-runtime-policy.py` | 7 个测试通过 |
| `python3 deploy/scripts/test-upgrade-registry-order.py` | 4 个测试通过 |
| `PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE=scripts deploy/scripts/test-deploy-production.sh` | exit 0，明确 scripts 模式，不含真实 Engine/network 演练 |
| `uv run --project backend ruff check deploy/scripts/production_deployment.py deploy/scripts/prepare-production-data.py deploy/scripts/test-production-routine.py` | 通过；首次两个未使用 import / 一处格式问题修正后重验 |
| `sh -n` 三个部署入口 | 通过：deploy.sh、activate-production.sh、redeploy-production.sh |
| `make -n` 五个 production 日常目标与 test-production-routine | 路由正确，无完整 verify 依赖 |
| `git diff --check` | 通过 |

Docker Compose 5.3.1 配置检查可执行；`docker info` 因本地 `/var/run/docker.sock` 不存在而失败。没有将环境阻断写作应用失败，也未盲目重试或扩展到全量门禁。

未运行完整 make verify、全量 E2E、容量测试：本次没有修改应用业务、前端渲染、OpenAPI、数据库 schema 或迁移源码，直接风险由上述发布合同验证及独立复核覆盖。当前 working tree 未提交/推送，不能生成正式冻结候选或声称本次优化已在服务器生效。

## 独立复核发现与定向修正

critical_reviewer 确认两项发布阻断，由主代理修正：

1. P1：旧 API 查询数据库 A，而待消费 runtime 可以指向 B；仅 deployment-boundary 和旧库 head 不能证明重建后的数据归属。复用 check_runtime 的完整标准库输入合同，并在已认证当前/ prepared API 内用 stdin 比对全部允许 runtime 键，固定 MATCH/MISMATCH 输出。数据库、OSS、秘密或其他配置差异转配置 Runbook；探针失败/未知与真实差异分别编码，不输出配置或捕获异常正文。
2. P2：维护 HTTP 证明期间收到取消，原代码缺少后续 publish checkpoint，可能继续启动写命令。实际写命令前及 mutation 后 smoke 前补 checkpoint，沿用 supervisor 的取消裁决。

新增真实 CLI/状态反例覆盖当前 API=A、pending DB=B（含 POSTGRES_DB 一致/不一致）、OSS 差异、prepare 后配置被改、维护 HTTP 阻塞期间 SIGTERM 后零写命令。13 个 routine 测试通过，21.473 秒；随后补充 prepared 配置反例时发现测试先清空日志再断言旧 migrate 的顺序错误，已保留 prepare calls 后修正，没有弱化断言。两项最终目标用例通过，5.128 秒；最终受影响 Python ruff 和 diff 检查通过。无遗留失败或运行中的检查。

其他已通过旧 AI handoff/runtime-policy/registry-order/harness scripts 与路由/语法证据按输入关联复用，未因收口重复全套。新增 check-production-inputs 模式仍由既有 manifest tracked-file allowlist 认证；未新增第二份状态或新依赖。

## 收口

独立复核已通过，主代理检查实际 diff/working tree，未改 backend/frontend/contracts、schema/迁移或真实配置；保留并记录并发的无关 GEO-906 提示文件追加，未执行其中引用的 SSH 请求。仅更新本任务两份 GEO 文档摘要，不声称整个文档包没有无关漂移。

已完成仓库实现与直接风险验证，任务进入 review，未提交/push/远程发布。首个正式候选仍须由 clean 已推送 main 生产；真实 Engine、Hostdzire、公网切换、AI/OSS与耗时缺口保留。子代理审计 ID：20261008T071000Z-hostdzire-routine-deployment-446170c3。
