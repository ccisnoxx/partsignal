# Frontend V2 Phase 9 Staging Phase B 激活证据

- Candidate：`0e472399bc09a82ffba7e16ca4f245b01267d475`
- Release：`mvp-20260825-160838-0e472399bc09`
- Phase B 执行时边界：用户单独授权 Phase B；当时未授权 Browser Gate、`current` 更新、fallback/restore、Nginx 写入或 production 操作。

## 1. 来源与 release

- 执行前：clean `main`，`HEAD=origin/main=candidate`，live origin 无漂移。
- Archive：12,421,398 bytes，SHA-256=`0a83d69ee6b822f35518ce5f332e5ed233f267047dd211a860098e6c05994628`。
- 归档通过 `.env`、密钥、AppleDouble 与代理目录排除检查。
- 远端 release：`/root/partsignal/releases/mvp-20260825-160838-0e472399bc09`。
- Release Compose SHA-256=`6b321800887c15605a218df303e536e1781e0c5d8825d2a9b465328a5a7f5aa6`，与 candidate 一致。
- `.env.staging` 仅链接既有 `/root/partsignal/shared/.env.staging`。

## 2. 迁移前证据

- 审计目录：`/root/partsignal/activation-recheck-mvp-20260825-160838-0e472399bc09`，mode=`0700`。
- Before snapshot：21 行，SHA-256=`a1fc764ecc837ae11b32f5d2ffeb7b162e5868a06458cea497fd13f69f353413`。
- Candidate-aligned V1 image：
  - `partsignal-frontend-v1:mvp-20260825-160838-0e472399bc09`
  - ID=`sha256:5221f2224623d2197a0e78c3518c729a1c71b7c4d82b39182225055cefbd514c`
- Fresh backup：
  - `/root/partsignal/backups/partsignal-20260825T081123Z.sql.gz`
  - 31,527 bytes
  - SHA-256=`646587b75e50688e9ea9497d3324e3563abe03533044c91357d29a74003e11ea`

## 3. Full activation

执行入口：

```sh
PARTSIGNAL_VERSION=mvp-20260825-160838-0e472399bc09 \
  ./scripts/deploy-staging.sh
```

Observed：

- Candidate backend 与 V2 production images 构建完成。
- Candidate `preflight-integrity=[]`。
- Alembic 顺序完成 `0040→0041→0042→0043_geo_platform_identity`。
- PostgreSQL、Redis 保持原容器；fake-oss、API、Worker、Scheduler、frontend 切到 candidate。
- Worker、Scheduler、API、frontend health 通过；seed 命令成功完成。
- Loopback ready 与 frontend 检查通过，full deploy 正常退出。

固定 image IDs：

- Backend/fake-oss：`sha256:cc259f87a5ffc953f8a84f2e00a6751fc4d5449677f161bf4fdc71a758449ac7`
- V1 UI：`sha256:5221f2224623d2197a0e78c3518c729a1c71b7c4d82b39182225055cefbd514c`
- V2 UI：`sha256:049456113dec0bf1020c80027a101a135f9ea37e1aeb792347ca495aa310743c`

## 4. Protected state

- DB revision=`0043_geo_platform_identity`。
- PostgreSQL/Redis container IDs 未变化。
- migrate container 集合切换前后均为空；`run --rm migrate` 未留下 one-off container。
- Nginx target、site checksum 与 security snippet checksum 未变化；`nginx -t` 通过。
- `current` 保持 `releases/mvp-20260806-195740-afb1b8c82f40`，符合 Phase B 授权边界。
- Stable candidate protected snapshot SHA-256=`45318e3cd21b9b85ff275aaec2e00738a1fc070f69c41aeec42f17f237b2fe67`。
- Snapshot 不含 environment、凭据或数据库业务正文，可供后续 frontend-only fallback/restore 做字节级 `cmp`。

## 5. HTTP Gate

- 标题=`PartSignal Frontend V2`。
- Main JS=`/assets/index-yCpPSAMt.js`；CSS=`/assets/index-CqrlkINc.css`。
- `/`、`/index.html`、`/login`、Products、Content、Publishing、GEO、Settings、System 代表 deep links 均为 `200`，body 与根 index 一致。
- Public live/ready=`200`，匿名 `/api/v1/auth/me=204`。
- JS/CSS=`200`、immutable、`Vary: Accept-Encoding`。
- Missing asset=`404`；main JS `.map=404`；公开 main JS 无 `sourceMappingURL`。
- V2 容器内 `.map` 文件数=`0`，全部 JS 的 `sourceMappingURL` 命中数=`0`。
- `/`、`/index.html`、`/login` 为 `no-cache`。
- CSP、Trusted Types、HSTS、COOP、frame、nosniff、Referrer-Policy 均唯一且符合 Runbook。
- 6/6 公网与回环 ready 稳定性探针通过；时间窗内未发现新的 Nginx `upstream prematurely closed connection`。
- HTTP Gate=`MET`。

## 6. 执行偏差与处置

- 第一个归档组合命令因本地安全策略拒绝 `rm -f`，在执行前终止，没有产生文件或远端动作；随后改为固定临时文件的分步流程。
- 上传后远端准备脚本末尾输出语句存在 shell 解析错误；正文已完成 release 创建、解包、incoming 删除和 env symlink。未重试创建，而是只读核对 release、symlink、权限、关键文件与 Compose checksum，结果全部正确。
- 第一轮 HTTP body checksum 因 shell 变量移除末尾换行而在本地断言停止；统一改为流式 SHA 后完整矩阵通过，远端状态未变化。
- 稳定性收尾中 BusyBox `grep` 不支持 GNU `--include`，且一个 service 无 Health 字段；6/6 probes 已先完成。随后只修正证据采集为 `find -exec grep` 与 JSON 可选 health，不重复通过的探针，最终 stable snapshot 完成。

## 7. Browser Gate

- 用户单独授权唯一 session `frontend-v2-p9-staging-activation-recheck` 执行浏览器只读验收。
- 本机 Chrome 通过真实公网域名首次加载匿名 `/login`，标题为 `PartSignal Frontend V2`。
- 匿名 `/api/v1/auth/me=204` 正常，但 console 记录 1 个 Required error：
  `This document requires 'TrustedScript' assignment. The action has been blocked.`
- 错误来源为 `/assets/schemas-C9kTthWC.js`，属于 Trusted Types/CSP Required Gate 失败。
- 按 fail-fast 合同立即停止；未输入或使用 ADMIN/ENGINEER 凭据，未执行登录、剩余业务路由、响应式或 history 矩阵。
- session 已关闭，`playwright-cli list --all --json` 确认没有 open browser/server；自动生成的匿名 snapshot 与 console 临时文件已删除。
- 未创建 screenshot、trace、video 或 storage state。Browser Gate=`NOT_MET`。

## 8. 当前状态

- V2 frontend 与 candidate backend 保持活动，DB=`0043_geo_platform_identity`。
- HTTP Gate=`MET`；Browser Gate=`NOT_MET`。
- 当前 open P0/P1/P2=`0/1/0`，Staging Gate=`NOT_MET`。
- `current` 保持 `releases/mvp-20260806-195740-afb1b8c82f40`。
- 未执行 fallback、restore、Nginx 写入/reload、production 操作或业务数据修改。
