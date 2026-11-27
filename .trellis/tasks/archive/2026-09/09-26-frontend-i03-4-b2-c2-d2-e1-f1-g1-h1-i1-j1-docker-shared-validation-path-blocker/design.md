# J1 设计：Docker 可共享 validation 路径与门禁前 sentinel

## 已确认根因

仓库的 Compose 配置会把当前 checkout 的 `backend/` 绝对路径 bind 到 `backend-test:/app`。`/private/tmp` checkout 在宿主机完整且包含 26 个 integration 文件，但 Docker Desktop 只呈现近空 `/app`，所以 pytest 的“路径不存在”来自宿主共享边界，而非 Git 候选或测试发现配置。

## 恢复边界

下一次仅改变 validation checkout 的宿主位置：使用 `/Users/sc/...` 下的唯一目录创建 detached worktree。不得修改权威 Compose、Makefile、pytest 命令或镜像来规避路径不可见。

在 `make verify` 前执行一次 disposable `backend-test` 只读 sentinel，至少证明：

- 容器内 `/app/tests/integration` 是目录；
- `/app/tests/integration/test_migrations.py` 存在；
- 容器看到的 integration `test_*.py` 数量与宿主 tracked 数量一致；
- sentinel 容器退出后没有残留测试容器或受控资源。

sentinel 不运行 pytest，因此不消耗固定候选唯一一次完整门禁。若 sentinel 不成立，直接停止并清理，不启动 `make verify`。
