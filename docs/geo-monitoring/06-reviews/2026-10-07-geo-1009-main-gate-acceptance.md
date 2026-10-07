# GEO-1009：固定 main 完整门禁人工接受与候选义务移交

| 字段 | 内容 |
|---|---|
| 结论 | ACCEPTED：GEO-1009 按本轮调整后的范围 done |
| 接受人 | 当前会话用户；未提供姓名，不以仓库开发者编号代替人工身份 |
| 接受指令记录时间 | 2026-10-07T14:31:31Z（America/Los_Angeles：2026-10-07 07:31:31 PDT） |
| 权威仓库 / 分支 | ccisnoxx/partsignal / main |
| 被验证 commit | e5949ab66989c1277424cfe9ab8b93e10ce10046 |
| 完整门禁 | run-verify.py，exit 0；本轮授权一次，实际一次，未重跑 |
| 生产裁决 | NOT_STARTED / NO-GO；本接受不代表生产 Go |

## 人工授权与最终接受范围

用户在当前会话明确要求“按以下顺序推进”，并指定接受“固定 main 的完整门禁验证”作为 GEO-1009 交付，将尚未完成的 source archive、镜像身份、release manifest 和候选冻结移交 GEO-1010-DEPLOY；形成正式人工接受记录，将 GEO-1009 从 review 置为 done；核实治理文件后提交、推送 main；再建立 GEO-1010 的三个子任务。此记录依据该人工指令，不根据本地未提交状态或代理自报推定接受。

本次接受固定 SHA 的完整门禁验证及适用的既有实现/审查证据。候选冻结归属的追加决定见 [ADR-008](../05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)。不重新接受或改写 GEO-1002～1008、原整 PR 接受及原生产未知记录。

## 验证证据

- [原始门禁 Markdown](../../../.trellis/tasks/10-06-geo-1009-candidate-freeze/evidence/main-business-priority-gate-20261007.md)
- [原始门禁 JSON](../../../.trellis/tasks/10-06-geo-1009-candidate-freeze/evidence/main-business-priority-gate-20261007.json)
- [机器接受记录](../../../.trellis/tasks/10-06-geo-1009-candidate-freeze/acceptance.json)
- [此前整 PR 接受边界](./2026-10-07-v1-pr-acceptance.md)

原门禁在 clean main=origin/main 上执行，UTC 2026-10-07T10:40:13.661133+00:00～11:17:44.718013+00:00，退出码 0。治理证据是在门禁结束后写入，后续治理提交不是该次执行的 SHA。原日志 SHA-256 为 `602645e78b6d470aa8fd3471df9f2020b53c427899588876be8143d53f264294`，本会话已重新核对原日志字节哈希一致；未重新执行应用门禁。

合同/lint/typecheck、3866 后端单元、1308 前端单元、1253 PG 集成、6 隔离恢复、100k 性能、32 核心真实栈、构建及部署脚本等结果按原记录保留；45 warnings 和 77 个既有 E2E skip 仍如实记录，skip 不称通过。旧失败不删除、不改写。

## 移交与完成边界

GEO-1010-DEPLOY 接管 UI done 之后的固定 main 候选选择、该候选门禁、source archive、正式 backend/frontend 及适用 migrate/worker/scheduler 镜像身份、release manifest、唯一 schema head、tracked-file hashes、候选冻结和既有 runbook 所需恢复材料。当前这些交付均未完成；不能复用旧 SHA 的成功来宣称新 UI 候选已验证，也不能伪造 repository、digest、previous V2 或目标环境。

GEO-1010 子任务只能在本接受和 done 状态提交到权威 main、工作区 clean 且 HEAD=origin/main 后创建。后续实施顺序为 UI → DEPLOY → UAT。此次仅接受治理收口并授权规划、提交、推送；没有部署、生产操作、真实业务数据创建或公开流量开放。UAT Go/No-Go 和父任务最终接受仍须另有显式人工记录。
