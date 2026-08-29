# run07 source profile artifact persistence root cause

## 结论

run07 的 producer 与 daemon-side handoff 使用了不同的可见性边界。`profile_wrapper.py run` 在 one-shot container 的 `/tmp` tmpfs 内完成 atomic rename 并返回 `output_written=true`；后续 host 命令却使用 daemon 侧 `docker cp` 读取该路径。前者只证明 container mount namespace 内的 final 存在，不证明 daemon 的 container layer 视图能读取 tmpfs 内容，因此 host handoff 报 path absent 并 fail-closed。

修正后的 owner 是同一 container 内的 `profile_wrapper.py handoff`：它校验 exact `/tmp/source-profile.json` 后通过 `docker exec -i` stdout 流送到 host exact partial，host 再核验 mode/size/SHA-256 并原子改名。不得再次使用 `docker cp` 读取该 tmpfs path，也不得重跑 producer作为 fallback。

本地 `profile_wrapper.py self-check` 覆盖 legacy daemon-copy path不可见、container-exec stream 可读、bounded input/identity 与 exact handoff 失败边界；该 self-check 不连接 production 或 database。冻结 wrapper SHA-256=`d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`。
