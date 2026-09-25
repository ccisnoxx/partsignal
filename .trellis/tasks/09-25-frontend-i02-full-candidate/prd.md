# I02 全站候选验收与质量收敛

## Goal

对 R00 至 I01 形成的当前本地候选执行一次完整、可重现的仓库级验收，证明合同、依赖方向、跨域主链路、关键 Pattern、响应式、可访问性、错误合同、production artifact 与测试基础设施共同收敛。

## Requirements

- 前置 W01、I01 已按本轮直接证据完成；历史 V2 Gate 不作本项结果。
- 使用仓库现行 `make verify` 作为完整门禁入口，覆盖 contract check、前后端 lint/typecheck、单元、PostgreSQL integration、Docker build、隔离 real-stack、完整 fixture Playwright、部署脚本测试与 Compose 配置。
- real-stack 必须使用进程唯一数据库、独占非零 Redis DB、真实 FastAPI/Celery/local provider/production preview，并在结束后通过 secret artifact 扫描与资源清理检查。
- 任何失败先保存原始证据并定位 owner；只在相关代码、配置、环境或诊断证据改变后重跑受影响门禁。
- 完成前检查完整 diff、原工作树、临时进程/端口、隔离数据库、Redis 与对象存储，不把未执行项表述为通过。

## Acceptance Criteria

- [x] `make verify` 的全部当前子门禁退出码为 0，并记录各测试层实际数量、production/real-stack 边界和非阻断警告。
- [x] 完整候选未出现合同漂移、依赖方向倒置、敏感产物、资源泄漏或未解释的失败；必要修复具备定向回归和重新验证。
- [x] 独立只读复核完整 diff 与门禁证据，记录阻断、残余风险及 I03 后继；原检出区保持不变。

## Notes

- 设计与实施顺序见同目录 `design.md`、`implement.md`。
- 2026-09-25 的仓库级验收使用当前候选直接执行；未把历史 V2 Gate 计入结果。
- 早期完整候选复核确认的两个 P1 阻断已分别由 I02-1、I02-2 关闭；I02-3 单次完整复验与 fresh 独立高风险复核结论为 `NO BLOCKER`，I02 已完成。
