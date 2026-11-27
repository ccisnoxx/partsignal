# I04-2A 设计

## 权威 owner 与最小结构

`deploy/compose.prod.yaml` 是所有 deploy/activate/rollback 共用 network 合同 owner。仅更名三组 logical key 与 service 引用，physical name、project、internal 属性和 service 拓扑保持不变。manifest producer/consumer 的八项 tracked-file allowlist 无变化，但 Compose 摘要变化令旧 Gate 和冻结 release 失效。

回归归属 `deploy/scripts/test-deploy-production.sh`，不另建测试框架。静态解析实际 Production Compose 的 default/async config；真实 Engine 回归直接执行同一权威 Compose，不使用 overlay。测试仅允许本地 Unix socket Engine，且固定 Production project/network 名称预先无容器/网络，否则 fail closed。网络由测试排他创建、携带固定 Compose project/logical labels 与唯一 owner marker；所有 one-off 使用唯一 name、owner label、`run --rm --pull never --no-deps` 和短命 shell probe，不启动应用、依赖或发布端口。数据 service 仅绑定 owned temp data root。

先在正确的既有 labels 上跑全部七个 service；再逐一创建 internal/egress/edge 的旧错误 label，要求具体 mismatch 错误与无残留 one-off。finally 按 owner marker 枚举完整 ID，核对 ownership 后精确删除自己的 container/network；不 down/prune/remove-orphans，不触碰 dev infra 或 Hostdzire。

## 门禁与收口

定向验证后冻结候选，fresh critical review；BLOCKER 建立准确 child blocker 并停止。NO BLOCKER 后本地 commit、main fast-forward、non-force push。在 clean pushed main 上唯一一次 `make verify`，输入包括显式本地 DB/Redis 隔离配置，不 source Production 或 development 完整 env。完整门禁失败不在本会话修改后反复重跑。

完整门禁通过、资源归零、代码冻结后进行第二次 fresh high-risk review。结果和完成状态可以由 Trellis-only 收尾 commit 记录；这类 `.trellis` 输入受 `export-ignore` 排除，必须证明所有 exported 产品/deploy/依赖与实际 Gate commit byte-identical，不能把旧 Gate 外推到变化的部署输入。

## 不变量与远端边界

不修改 manifest、bootstrap/clean-init owner、Production env、数据库或业务合同。Hostdzire 只读复核保存 name/label、历史 archive/manifest/image identity、七容器 restart/OOM、Nginx/env hash、公网状态与 quarantine/state absent；没有远端写操作。旧冻结身份完整见父任务历史 evidence，本轮不得复用。

## 验证结果与结束边界

实际实现 commit `b28d72f7`，新完整 Gate source `6c88563cce6edbce4b18fb010a840329600e69ee` / tree `ab34588732c3a77cc788f21e64d7d4479e5b632c`，clean pushed main 上一次 make verify exit=0；日志 253005 bytes，SHA-256=`1ba1e84ab20a5fd972c5b546f6a454fefa58bfc40ded2fce391433ac0416dc86`。真实 Engine 七 service positive、三个旧 label negative，清理与两次 fresh review 均满足验收。结果收尾仅修改 export-ignore 的 .trellis 记录；最终 Git identity/input-continuity evidence 在持久 evidence root 保存。禁止将此 Gate 当作真实 AI/OSS、远端修复后 preflight 或 cutover 通过证明。

下一会话先解决真实 AI provider 非 secret metadata 和 credential owner true-TTY handoff；随后使用全新 commit/release ID/run ID/archive/image tags/manifest 冻结 release，并重新执行 pre-cutover review/cutover。
