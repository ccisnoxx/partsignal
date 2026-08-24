# 实施计划

## Phase A — 批准后启动

1. 等待用户批准本计划及 final recheck evidence commit；回到 clean `main` 后运行 `task.py start`，不创建分支，除非用户另行授权。
2. 运行 `trellis-before-dev`，读取 frontend quality、E2E isolation 与本 Task research。
3. 冻结启动时 HEAD，确认 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce` 为祖先；确认 A30 仍为 planning 且 Phase 8=`NOT_MET`。

## Phase B — 最小实现

1. 复核 `headerMore` 点击后的当前 overlay DOM/role ownership。
2. 只修改 `frontend/tests/e2e/mvp-flow.spec.ts:452` 附近 locator：从当前可见 menu owner 选择 exact `menuitem`“删除”。
3. 保留 Dialog、取消、focus return 和后续业务断言；不添加 helper、sleep、retry、force 或顺序选择。
4. 若同一个可见 menu 中仍有两个删除项，停止并更新 evidence，不修改产品。

## Required Validation

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

随后使用 A27 两键 allowlist、动态空闲非 0 独占 Redis DB 和现有 preflight，运行一次：

```bash
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts --project=e2e
```

记录 V2 real-stack 前置结果、目标 V1 spec 结果、exit、耗时与 database/Redis/storage/process/ports cleanup；不输出敏感值。

失败且环境/代码未相关变化时不重跑。

## 收尾

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-8-v1-mvp-flow-delete-selector-blocker
git status --short --branch
```

使用 `trellis-check` 核对 diff 只含目标测试与 evidence。A29 通过后更新父 metadata 为 A29 closed、A30 planning/active；Phase 8 仍为 `NOT_MET`，07/08 不变。

## Explicitly Skipped

- 不运行根 `make e2e`、`make verify`、V2 fixture 全集或 A30 验证。
- 不修改产品代码、runner、合同、spec 或长期 Phase 8 文档。
- 不自动 commit、push、PR、archive 或开始 Phase 9。

## Commit 停止点

建议 commit：`test(frontend): scope MVP delete menu locator`。范围仅目标 V1 spec、A29 artifacts 与父 metadata；展示 diff 后等待批准。

## 执行结果

- [x] 在 `38402dd4377378f85293209de10365087be37713` 上启动，确认原 Phase 8 候选为祖先，A30 仍为 planning。
- [x] 只收紧目标 locator，保留 Dialog、取消、焦点恢复和后续流程断言。
- [x] lint exit `0` (`4.55s`)；typecheck exit `0` (`3.46s`)。
- [x] 两键 allowlist 与动态 Redis DB `7` 通过现有 preflight；未沿用历史 DB 编号。
- [x] 定向 E2E 唯一运行一次：V2 real-stack `16 passed`，V1 目标 spec `3 passed`，exit `0`，耗时 `162.208s`。
- [x] database、Redis、storage、services 与固定端口 cleanup 完整；未将连接值或其他敏感正文写入 evidence。
- [x] 跳过根 `make e2e`、`make verify`、V2 fixture 全集、07/08、A30 实施与 Phase 9。
- [x] A29 关闭；Phase 8 保持 `NOT_MET`，A30 为唯一开放 blocker。
