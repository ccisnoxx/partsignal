# GEO-1009：业务发布优先、一次性门禁

本轮完整门禁 **exit 0**；业务阻断项为空，GEO-1009 按用户限定范围进入 **review**。本轮只运行一次，不循环重跑；未启动生产发布，未冻结 RC，未新增源码、安全设计或独立安全审计，已接受业务合同保持原样。

## 固定身份与执行

- 权威分支：main；未使用 geo/GEO-906 作为部署来源。
- 固定 commit：`e5949ab66989c1277424cfe9ab8b93e10ce10046`。
- 开始前 git fetch origin 成功、git switch main 成功，工作区 clean，HEAD == origin/main。
- UTC：2026-10-07T10:40:13.661133+00:00 ～ 2026-10-07T11:17:44.718013+00:00。
- America/Los_Angeles：2026-10-07T03:40:13.661288-07:00 ～ 2026-10-07T04:17:44.718067-07:00。
- 耗时：2251.057 秒；退出码：0；本轮运行次数：1，重跑次数：0。
- 运行结束时 HEAD 未变且工作区 clean；下列治理证据在门禁完成后写入，不伪称已包含在固定 commit 中。

```sh
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend python .trellis/tasks/10-05-verify-entrypoint/run-verify.py
```

原始日志：[run-verify.log](/Users/sc/.codex/reviews/partsignal/geo1009-business-gate-20261007T104013Z/run-verify.log)（0600，仓库外保存）。SHA-256：`602645e78b6d470aa8fd3471df9f2020b53c427899588876be8143d53f264294`。完整机器记录：[JSON](./main-business-priority-gate-20261007.json)。旧失败及旧预算记录仍作为历史保留。

## 完整结果

| 检查 | 实际结果 |
| --- | --- |
| 合同、lint、typecheck | 全部通过；mypy 253 source files |
| Browser collector / 后端单元 | 14 / 3866 passed |
| 前端单元 | 1308 passed / 138 files |
| 普通 PostgreSQL 集成 | 1253 passed / 45 warnings / 633.30s |
| 隔离恢复集成 | 6 passed / 14.95s |
| 10 万样本性能 | 1 passed / 560.69s；所有既有阈值断言通过 |
| 前端、后端镜像构建 | 全部通过 |
| canonical 真实栈 E2E | 32 passed / 3.9m |
| GEO enabled / api-disabled / monitoring-disabled | 合计 3 passed / 3 既有模式 skip |
| 前端 fixture E2E | 498 passed / 74 既有条件 skip / 6.5m |
| 部署脚本 | 全部通过；17 恢复边界、195 collector contract、17 配置组及 staging/production/升级恢复自检 |
| 两份 Compose config --quiet | dev / prod 均通过 |
| 现有 E2E 秘密扫描 | 五次均 clean；不扩大为独立或穷尽安全审计 |

本地隔离真实栈迁移至 `0066_geo_manual_evaluation`；登录→强制改密→权限拒绝→退出、MANUAL 批次草稿/提交与不可变证据、分析/复核、指标明细及现有报告主链路均有本次真实栈通过证据。指标/报告性能 P95：产品 Overview 0.151s、Insights 0.265s、Report 0.261s；全对象 Insights 2.860s、Overview 1.499s。未声称目标环境迁移、真实 AI/OSS 验收或生产部署通过。

门禁启动的原开发 fake-oss/postgres/redis 容器均恢复为初始 exited，未删除容器或卷。结束时 Redis DB13=0、DB14=6、DB15=75；清理阶段未删除任何 Redis 键，保留非本轮数据。

## 业务阻断与 V1.1

业务阻断项：无。本次未观察到 build/启动、migration、登录、MANUAL、分析/复核/指标/报告或 deploy 脚本失败，也未由现有门禁报告数据损坏、权限绕过或敏感信息泄漏。无最小修复方案需提出。

以下按用户本轮范围记为 V1.1，不在本轮实现或修复：

- Browser 真实采集与 API 自动化扩展；现有完整门禁中的相关检查仍原样执行。
- CRON/自动调度、自动 Opportunity、Opportunity CSV、非核心导出与公共重分析。
- 附加安全强化与新的多轮独立安全审计。
- 不影响业务的测试夹具问题；本次未观察到此类失败。

45 warnings 与既有 77 条 E2E skip 如实保留；无新增 skip，不能将 skipped 用例写成通过。

## review 与后续部署输入

GEO-1009 的 Trellis 和 manifest 均为 review，completedAt 保持 null。review 只覆盖本轮已授权范围；尚未生成同 SHA 的 source archive、正式镜像身份、release manifest 或 RC tag，生产阶段仍 NOT_STARTED，GEO-1010 现场证据仍 NOT_VERIFIED。历史已接受任务与业务合同不改。

内部试运行部署所需的剩余输入：

- 内部试运行的精确目标环境、访问/部署入口、部署目录和数据归属；限定人群的访问控制方式。
- 真实镜像发布 repository/交付方式，以及可执行、可拉取且已验证的 previous V2 回退镜像引用；同 SHA 的 source archive/images/manifest/RC 尚未冻结。
- 全应用真实 AI/OSS 等保护配置及既有外部服务 Gate 的目标证据；密钥经受保护通道提供。
- expand/deploy/enable 的目标、候选、操作范围、时间窗口与阶段授权，业务/运维/停止恢复负责人。
- 试运行 ADMIN/ENGINEER 人群、批准产品事实与 MANUAL 样本/计划、试用时长、反馈渠道与业务验收人。
- 目标备份及恢复材料、容量/监控观察期与停止阈值的既有要求和现场验证安排；GEO-1010 尚未执行。
