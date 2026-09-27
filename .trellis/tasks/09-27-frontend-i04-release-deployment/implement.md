# I04 执行与证据记录

## Phase 0 — 当前恢复点

- 候选工作树：`codex/frontend-redevelopment-candidate@a4c15a535f21621188a61f076cf7856c14509d42`，tree `9738ba36cb0f4fbe1f4352cfb89e043df7fa580c`，创建 I04 前 clean。
- `a4c15a53` 相对已验证产品候选 `387b802d` 仅包含 Trellis/会话收尾记录，没有产品代码、部署配置或依赖变化。
- 原检出区：`main@9100774b0e124d1d834f8c726cf85f2c0e171e5e`，创建 I04 前 clean。
- I04 已建立并链接为总体任务 child；总体任务保持 `in_progress`。

## Planned phases

1. Git 收口：fetch、严格 ancestry/远端分叉检查、候选 I04 规划记录 commit、原检出区 fast-forward only、非 force push、再次固定 local/origin/candidate identity。
2. Repository Release Gate：在最终 clean main 运行 Nginx security、三组 deploy 测试、CLI unit、Compose config、shell/Python syntax、diff check 与 secret scan，逐项保存日志和 SHA-256。
3. Hostdzire 只读预检：主机/资源、Docker、固定路径、repo/release/current/manifest、Compose service/container/image/health/profile、listener、migration、Nginx/TLS、数据 device/permissions/size、env 安全状态、rollback image、delivery 条件与 fake-oss inventory。
4. 冻结 release：生成唯一 release ID/run ID、可复现 source archive、候选镜像与 RepoDigest、排他 0600 manifest；完成 pre-cutover fresh critical review。
5. 维护与 quarantine：原子 maintenance Nginx、稳定 503/T0、精确停止旧服务、确认无写入与 mount、同一 run ID quarantine。
6. clean-init prepare：只通过 `deploy.sh` 完成 config/identity/health/preflight/migration/integrity/initialize-accounts/API/Frontend，达到 `PRODUCTION_PREPARED`。
7. 真实 AI/OSS Gate：实际权限、连通、timeout、失败语义、namespace、受控预签名上传/HEAD/read/CORS/cleanup；只在全部通过后标记 `MET`。
8. 激活与 final Nginx：只通过 `activate-production.sh` 启动 worker/scheduler，进入 `PRODUCTION_INITIALIZED`；原子切换最终 Nginx。
9. 验收与观察：回环/公网/浏览器/权限/受控写/AI/OSS/artifact/security/runtime/migration/state，记录多采样观察与 T0+60 分钟结论。
10. 精确清理与收尾：保留规定证据和 rollback/quarantine，fresh post-observation critical review，完成 I04 与总体任务，提交并非 force push 仅含 Trellis 收尾记录的 main commit。

## Evidence ledger

后续在本文件与 `task.json.meta` 中追加实际 commit/tree、release ID、run ID、manifest 路径与 SHA-256、archive SHA-256、image ID/RepoDigest、Nginx old/new checksum 与备份、T0/时间线、Gate/验收日志、观察采样、review audit ID、警告和覆盖缺口。不得记录 secret 值。

## Current status

`PLANNING_READY`。尚未 fetch、整合或 push；尚未运行 I04 release gate；尚未连接或写入 Hostdzire；尚未生成 release/manifest；尚未进入维护窗口。
