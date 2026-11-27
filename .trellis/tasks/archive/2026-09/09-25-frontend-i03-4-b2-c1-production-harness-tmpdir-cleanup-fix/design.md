# I03-4-B2-C1 设计

- `temporary_root` 是唯一 owner：先对 `${TMPDIR:-/tmp}` 做 `realpath`，去除尾斜杠与 `/var` 别名差异，再把该 canonical path 传给 `mktemp`。
- `test_dir` 先初始化为空；可空安全的 EXIT/INT/TERM trap 在任何 owned 目录创建前安装。`mktemp` 已使用 canonical root 模板，因此创建后不再增加第二次 `realpath` 失败窗口。
- `mktemp` 直接在 canonical root 下创建 `test_dir`；cleanup 同时检查 target 精确等于该 owner、parent 精确等于 `temporary_root`、basename 只匹配 `partsignal-production-test.*`，并仅删除该精确路径。`*` 不承担跨目录 allowlist 语义。
- EXIT trap 先保存主流程状态，再禁用 trap，执行 cleanup；主流程失败时保留原始状态，主流程成功而 cleanup 失败时返回 cleanup 非零。INT/TERM 分别转换为稳定非零退出并统一经过 EXIT cleanup。
- 为避免重复运行 900 多行 Production 合同测试，harness 提供只影响测试脚本自身的显式 lifecycle test mode：在目录创建和 trap 安装后立即成功、失败或等待信号；默认未设置时完全进入既有 Production 自检主体。
- 新增独立回归脚本，在隔离 canonical 目录与带尾斜杠 symlink TMPDIR 下运行 lifecycle 模式，观察目录集合与退出码；用受控 fake `rm` 制造 cleanup 删除失败，并用受控 cleanup target 制造 owner 拒绝。回归 suite 自身同样先安装空 owner 安全 trap、再创建 fixture。失败场景断言后只清理测试自己精确创建的 fixture。
- lifecycle 回归额外覆盖 owned 目录创建后立即失败，以及通过观察 owned 目录出现后、任何 normal ready 前发送 INT/TERM，避免只证明 trap 安装后的晚期退出。
- sibling sentinel 与 harness-owned 前缀分离；所有场景结束都断言 owned 目录为零、sentinel 仍存在。回归脚本本身也有精确 owner cleanup。
- staging harness 没有把 `test_dir` canonicalize 后再与 raw TMPDIR 比较，因此不共享已确认的 `/var`→`/private/var` 根因；本任务不修改它。frontend harness同样不做这一步 canonicalize，本任务不扩围。

## 退出码语义

| 主流程 | cleanup | 最终结果 |
|---|---|---|
| 0 | 0 | 0 |
| 非 0 | 0 | 保留主流程状态 |
| 0 | 非 0/拒绝 | cleanup 非零 |
| 非 0 | 非 0/拒绝 | 保留主流程状态，同时输出 cleanup 诊断 |
| INT | cleanup 任意 | 非零，正常 cleanup 时 130 |
| TERM | cleanup 任意 | 非零，正常 cleanup 时 143 |

## 排除

- 不修改真实部署脚本、Compose、manifest、镜像校验、数据迁移、回退或远端操作。
- 不把 allowlist 放宽到 canonical 根下任意目录，不吞掉 `rm` 错误，不通过事后扫描代替 trap 生命周期。
