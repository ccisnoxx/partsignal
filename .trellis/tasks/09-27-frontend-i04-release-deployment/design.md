# I04 发布设计与恢复边界

## 发布状态机

`GIT_FROZEN → REPOSITORY_GATE_MET → INVENTORY_VERIFIED → RELEASE_FROZEN → PRE_CUTOVER_REVIEWED → MAINTENANCE_ACTIVE → DATA_QUARANTINED → PRODUCTION_PREPARED → EXTERNAL_SERVICES_GATE_MET → PRODUCTION_INITIALIZED → ACCEPTED → OBSERVED → COMPLETED`

任一阶段失败都停留在可审计状态。进入 `MAINTENANCE_ACTIVE` 之后的失败必须在同一 run ID 下执行恢复，禁止另建 run ID 绕过已有状态。

## Identity invariants

- Git：`local main == origin/main == manifest.commit`，候选分支是已推送 `main` 的已知 ancestor/equal。
- Source：release archive 不可覆盖，SHA-256 可复现；远端 release 内容来自同一 archive。
- Images：backend 不得是 V1 repository，frontend 必须是 V2 repository，tag 精确等于 release ID；manifest 固定 image ID、非空 RepoDigest 与 previous verified V2 rollback frontend identity。
- Data：旧 postgres/redis/objects 只原子移动到同文件系统 quarantine；新 Production 只挂载 `/root/partsignal-data`，不挂载 quarantine。
- Runtime：Compose project 只允许 `partsignal-staging`；Production 不允许 fake-oss、V1 container/repository/static root 或 19001/object-storage proxy。
- Nginx：maintenance 和 final 配置都由 manifest 固定模板渲染；目标、备份、checksum、owner、mode、原子替换和 reload 全部可证明。

## Secret boundary

所有 inventory、日志、manifest 与回复只记录键名存在性、安全布尔状态、权限、标识符和脱敏结果；不得输出 env 值、认证材料、Cookie、CSRF 或业务正文秘密。浏览器凭据只允许瞬时、安全注入，不写文件、不进 shell history 或普通日志。

## Cutover and rollback

- T0 是首次稳定维护 503 的时间；60 分钟时限从 T0 起计算。
- 失败时停止新写与新 services，保留失败日志/manifest/container evidence，把新数据移至 failed-production，再用同一 run ID 执行 `prepare-production-data.py restore`；恢复旧 env/Compose/Nginx，`nginx -t` 后 reload，并验旧运行态。不得 Alembic downgrade。
- 成功时保留 quarantine 与 rollback frontend image；只按精确 container/image/release ID 做获准清理。

## Review gates

- pre-cutover reviewer 只读复核冻结身份、远端 inventory、env 状态、Nginx、clean-init/恢复命令与删除边界。
- post-observation reviewer 只读复核最终 Git/release/manifest/image/data/env/runtime/migration/Nginx/public/browser/AI/OSS/secret/cleanup/rollback 证据。
- reviewer 不修改本地或远端，不执行 Git 或远端写操作；任一 `BLOCKER` 都必须进入任务记录并停止。
