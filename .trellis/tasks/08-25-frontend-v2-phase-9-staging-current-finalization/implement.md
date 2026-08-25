# Frontend V2 Phase 9 Staging current finalization 实施计划

## 当前状态

- [x] 从 clean `main` 创建 Trellis Task 与唯一临时分支。
- [x] 读取 workflow、infra spec、Hostdzire Runbook、Frontend V2 07/08 与三项归档任务。
- [x] 形成可 review 的 PRD、design、implement。
- [x] 用户审核最新规划并明确批准进入实施。
- [x] `task.py start` 后执行只读门禁、条件式原子更新与复核。
- [x] 据实记录 evidence、更新适用文档。
- [x] 完成质量检查与 diff 自审。

## 阶段 0：实施启动门禁

用户批准后运行 `task.py start`。任何 SSH 前确认：

```sh
test "$(git branch --show-current)" = \
  codex/frontend-v2-phase-9-staging-current-finalization
git status --short
```

dirty allowlist 仅允许当前 Task 文件；产品、contract、migration、部署脚本或目标文档在执行前不得已有未识别修改。

## 阶段 1：pre-current 只读门禁

使用 `ssh -F /Users/sc/.ssh/config hostdzire`，复用上一任务 snapshot 格式并把输出直接保存到本地 `research/pre-current-protected.txt`。同时只读获取并核对上一任务：

```text
/root/partsignal/csp-post-fix-mvp-20260825-172239-2a6fd940b848/candidate-protected.txt
/root/partsignal/csp-post-fix-mvp-20260825-172239-2a6fd940b848/after-browser.txt
```

Required：

1. release 目录存在；V1/backend/V2 三个 tag 的 image ID 与冻结值精确一致。
2. frontend 使用冻结 V2 ID；api、worker、scheduler、fake-oss 使用冻结 backend ID。
3. PostgreSQL、Redis、API、worker、scheduler healthy；fake-oss/frontend running；restart count 与历史 snapshot 一致。
4. DB=`0043_geo_platform_identity`；migrate 集合、Nginx target/checksum 与 `nginx -t` 无漂移。
5. `current` 精确为旧值。
6. pre snapshot、远端 candidate-protected、远端 after-browser 三者字节一致，SHA-256 精确为冻结值。
7. 公网最小 HTTP smoke 全绿。

任一失败立即记录 `NOT_MET`，不进入阶段 2。

## 阶段 2：原子更新 `current`

仅在阶段 1 全绿时执行唯一远端写命令：

```sh
set -eu
ps_release=mvp-20260825-172239-2a6fd940b848
ps_target="releases/$ps_release"
ps_next="/root/partsignal/.current-$ps_release"
test -d "/root/partsignal/releases/$ps_release"
test "$(readlink /root/partsignal/current)" = \
  releases/mvp-20260806-195740-afb1b8c82f40
test ! -e "$ps_next" && test ! -L "$ps_next"
ln -s "$ps_target" "$ps_next"
mv -Tf "$ps_next" /root/partsignal/current
test "$(readlink /root/partsignal/current)" = "$ps_target"
```

不得执行其他远端写操作。

## 阶段 3：post-current 验证

1. 精确验证 `readlink` 为目标。
2. 用同一 snapshot 命令流式生成本地 `research/post-current-protected.txt`。
3. 单独断言 pre/post 的 `current|` 行分别为旧值/新值；删除该行后字节级一致。
4. 再次精确验证容器 ID/image ID/state/health/restart、DB revision、migrate 集合、Nginx target/checksum 与 `nginx -t`。
5. 再执行同一最小 HTTP smoke，证明公网仍为同一 V2 artifact。
6. 记录未执行 fallback/restore、完整 Browser Gate 未重跑及证据继承理由。

## 阶段 4：结论与文档

只有阶段 1–3 全绿才判：

```text
HTTP Gate=MET
Browser Gate=MET（继承上一任务同一 fixed release 的完整证据）
open P0/P1/P2=0/0/0
Staging Gate=MET
```

此时新增当前 Task `research/evidence.md`，并只在现有 Phase 9/Deployment Smoke 结论后追加当前 finalization 结果：

- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`

保留所有历史 `NOT_MET` 原文。若任一 Gate 失败，只更新当前 Task evidence，文档不改，结论为 `NOT_MET`。

## Required Validation

```sh
git diff --check
python3 -m json.tool \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-current-finalization/task.json \
  >/dev/null
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-current-finalization
```

外部 Required 是阶段 1–3 的实测结果。产品与部署 owner 不变，因此不运行 `make verify`、部署脚本测试或完整 Browser Gate。

## Optional Validation

无。

## 提交边界

提交范围预计仅为 Task artifacts/evidence 与最终 `MET` 时两份 Frontend V2 文档。提交前展示精确 commit plan 并等待确认；不自动 commit、push、merge、archive 或开始后续 Task。
