# I03-4-B2-C1 执行记录

## 计划

1. 核对候选/原检出区、父任务链、旧日志哈希、Production/Staging harness 与 Makefile 入口。
2. 在未修改脚本上以 macOS 默认 TMPDIR 运行一次 production harness，保存退出码、raw/canonical root 和前后目录集合；精确移走本轮遗留 fixture。
3. 实现 canonical owner、严格直属 allowlist、可诊断 cleanup 与 EXIT/INT/TERM 状态传播；增加文件系统回归脚本并接入 deploy-script 门禁。
4. 每次定向检查前后核对 raw/canonical 根无残留；只运行 `sh -n`、新回归脚本、production harness、必要的 Makefile deploy-script 定向入口和 `git diff --check`。
5. 检查 diff 后派发 fresh `critical_reviewer`；仅在 `NO BLOCKER` 后补齐证据、完成 C1 并创建一个本地提交。

## 修复前复现

- 证据文件：`/tmp/partsignal-i03-4-b2-c1-old-cleanup-repro.log`，SHA-256 `4e42cf760ec9208b7d0f295a8ae9a2f10847c6681e47a1cab426f1e61c3300dc`。
- harness 输出：`/tmp/partsignal-i03-4-b2-c1-old-harness.log`，SHA-256 `e5ca00cf2fdd647e3b998fc42d10a212c043012e02f54b884b6b2c9d166246c7`。
- raw root 为 `/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/`，canonical root 为 `/private/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T`；运行前 owned 目录为 0。
- 未修改的 `deploy/scripts/test-deploy-production.sh` 退出 `0`，运行后遗留 canonical 目录 `partsignal-production-test.V2uiH6`。
- 该 fixture 未被删除，已精确移动到 `/Users/sc/.Trash/partsignal-i03-4-b2-c1-old-repro.V2uiH6`；随后 raw/canonical 根重新为 0。

## 实施与验证

### 实际修改

- `deploy/scripts/test-deploy-production.sh` 在任何 owned 目录创建前安装可空安全的 EXIT/INT/TERM trap；`${TMPDIR:-/tmp}` 先 canonicalize，`mktemp`、owner 记录、parent/basename allowlist 与 cleanup 全部使用该 canonical root。
- cleanup target 必须同时精确等于本轮 `test_dir`、parent 精确等于 canonical root、basename 匹配专用前缀；只删除该精确路径，拒绝越界或 owner 漂移。
- EXIT 先保存主流程状态：主流程非零时保留原始状态；主流程成功而 cleanup 拒绝、删除失败或删除后仍存在时返回 cleanup 非零并输出中文诊断；INT/TERM 分别转换为 130/143 后统一经过 EXIT cleanup。
- 新增 `deploy/scripts/test-deploy-production-cleanup.sh`，使用 canonical fixture root 与尾斜杠 symlink TMPDIR 覆盖成功、普通失败 23、创建后立即失败 24、cleanup 拒绝、受控 `rm` 失败、ready 前 INT/TERM、sibling 保留和最终目录清零；回归 suite 自己也在 owner 创建前安装 trap。
- `Makefile` 的 `test-deploy-scripts` 在既有 production harness 前接入该回归脚本。默认未设置 test-only mode 时，既有 900 余行 Production 自检主体和真实部署合同不变。
- 相邻 `test-deploy-staging.sh` 与 `test-frontend-container.sh` 没有把 `test_dir` canonicalize 后再与 raw TMPDIR 比较，不共享本次 `/var`→`/private/var` owner mismatch；未修改。

### 定向验证

- `sh -n deploy/scripts/test-deploy-production.sh`：退出 0。
- `sh -n deploy/scripts/test-deploy-production-cleanup.sh`：退出 0。
- `deploy/scripts/test-deploy-production-cleanup.sh`：退出 0；success、failure=23、initialization-failure=24、cleanup refusal/failure、SIGINT=130、SIGTERM=143 的文件系统断言全部通过；同根 sibling 保留。
- `deploy/scripts/test-deploy-production.sh`：退出 0；既有 Nginx 与 Production 编排合同自检成功。
- 上述两次会创建 Production owner 的定向执行前后，macOS raw TMPDIR 与 canonical realpath 根下 `partsignal-production-test.*` 均为 0。
- `git diff --check`：退出 0。
- 未运行 `make verify`、完整 backend/frontend 测试、完整 Playwright、clean-checkout 完整复验、真实部署、远端 CI 或 I04。

### 独立高风险复核

- 第一次 fresh `critical_reviewer` 发现 P1：production harness 与回归 suite 在 owned 目录创建后才安装 trap，初始化失败或早期信号仍可能遗留目录。按其最小方向把空 owner trap 前移、移除创建后的二次 realpath，并新增创建后立即失败与 normal ready 前信号场景；相关代码变化后重新执行全部定向检查。
- 第二次 fresh `critical_reviewer` 对修正版结论为 `NO BLOCKER`：确认 canonical owner、strict allowlist、EXIT/失败/INT/TERM/cleanup 失败状态语义、symlink/尾斜杠/`/var`→`/private/var`、真实文件系统回归、默认 Production 自检隔离和 diff 范围均成立。
- 残余边界：未做 B2 clean-checkout 完整门禁；“主流程非零且 cleanup 同时失败”由静态分支确认，两个单独路径已动态覆盖；SIGKILL/进程崩溃/cleanup 中第二信号不属于 trap 可保证范围。

## 下一恢复点

基于 TMPDIR cleanup 修复提交重新执行 I03-4-B2 clean-checkout 完整门禁、资源清理、完整候选独立复核和 I03 收尾。
