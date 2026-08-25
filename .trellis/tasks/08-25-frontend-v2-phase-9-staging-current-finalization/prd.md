# Frontend V2 Phase 9 Staging current finalization

## 目标

确认 Staging 自固定 release 完成完整 Browser Gate 后没有漂移；仅在全部只读门禁精确通过时，将 `/root/partsignal/current` 原子更新到已验收 release，并据实判定外部 Staging Gate 为 `MET` 或 `NOT_MET`。

## 已确认事实

- 固定 candidate：`2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`。
- 固定 release：`mvp-20260825-172239-2a6fd940b848`。
- 上一任务已实际完成 full deployment、HTTP Gate、blocker-specific Browser Gate、完整 Browser Gate 和 protected-state 检查；open P0/P1/P2=`0/0/0`，未执行 fallback/restore。
- 上一任务 `candidate-protected.txt` 与 `after-browser.txt` 逐字节一致，冻结 SHA-256=`b1cc9bce632d88bfecf03828d751a255280226f12a6eaef7e882b13c6e26b5a5`。
- 冻结 image ID：backend/fake-oss=`sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f`；candidate-aligned V1=`sha256:dfadfd534b11d80bdf993566c4b46cf9c6f87ef1283e303902d5b2130eca4fa4`；V2 frontend=`sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`。
- 唯一未满足项是 `current` 仍记录 `releases/mvp-20260806-195740-afb1b8c82f40`；该 symlink 是验收记录，不是流量开关。

## 范围内要求

1. 通过 `hostdzire` SSH alias 只读确认 release 目录、容器/image/health/restart、DB revision、migrate 集合、Nginx target/checksum/`nginx -t`、执行前 `current` 和公网最小 HTTP 合同均未漂移。
2. 重新生成 pre-current protected snapshot，与上一任务冻结 SHA 和 `after-browser` 证据比较；任何差异都停止。
3. 只有全部只读门禁通过，才创建指向精确相对目标的临时 symlink，并以同文件系统原子 rename 替换 `current`。
4. 更新后立即精确验证 `readlink`，生成 post-current snapshot；相对 pre-current 只允许 `current` 一行从旧值变为固定 release。
5. 更新后容器 ID、image ID、health、restart、DB revision、migrate 集合和 Nginx 必须不变；再执行一次最小 HTTP smoke。
6. 不机械重跑完整 Browser Gate；仅当运行态未漂移且 HTTP 合同保持时，继承上一任务固定 release 的完整 Browser Gate 证据。
7. 任一精确检查失败时不更新或不继续写操作，不修复、不重启、不重新部署、不 fallback/restore，并判定 `Staging Gate=NOT_MET`。

## 验收标准

- [x] fixed release 目录存在，执行前 `current` 精确为旧值。
- [x] frontend 精确使用冻结 V2 image ID；api、worker、scheduler、fake-oss 精确使用冻结 backend image ID。
- [x] PostgreSQL、Redis、API、worker、scheduler healthy；fake-oss、frontend running；全部受保护容器 restart count 未漂移。
- [x] DB revision=`0043_geo_platform_identity`；migrate container 集合和 Nginx target/checksum/`nginx -t` 未漂移。
- [x] pre-current snapshot 与上一任务冻结 protected/after-browser 证据一致。
- [x] 最小公网 smoke 证明 live/ready、V2 标题与 deep link、主 JS/CSS、404/source-map、CSP/安全头/cache 合同不变。
- [x] 仅在上述全部通过时，`current` 从旧值原子更新到 `releases/mvp-20260825-172239-2a6fd940b848`。
- [x] post-current snapshot 相对 pre-current 只有 `current` 一行发生预期变化；更新后最小 HTTP smoke 仍通过。
- [x] 若全部满足：继承上一任务完整 Browser Gate，open P0/P1/P2=`0/0/0`、无 fallback/restore、V2 保持活动，判定 `Staging Gate=MET`。
- [x] 若任一项不满足：记录实际漂移或失败，判定 `Staging Gate=NOT_MET`，不改写历史任务结论。
- [x] 仅在 `MET` 时更新当前 Task evidence、`docs/frontend-v2/07-migration-plan.md` 和 `docs/frontend-v2/08-testing-quality-and-acceptance.md`。

## 不在范围

- 不修改产品代码、contract、migration、部署脚本、Compose、Nginx、shared env 或数据库。
- 不部署、build、pull/delete image、up/down/recreate/restart、migration/seed/restore、Nginx reload。
- 不使用 ADMIN/ENGINEER 凭据，不重跑完整 Browser Gate，不执行 V1 fallback/V2 restore。
- 不进入 production、legacy routing、production-like rehearsal、V1 删除或后续 Phase 9 Task。
- 不自动 commit、push、merge或归档；提交前展示 commit plan 并等待确认。

## 阻塞问题

无。全部验收标准已满足，最终 `Staging Gate=MET`。
