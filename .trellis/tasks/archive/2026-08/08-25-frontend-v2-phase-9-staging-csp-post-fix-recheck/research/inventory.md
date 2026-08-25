# Frontend V2 Phase 9 Staging CSP post-fix recheck 只读盘点

- 观察时间：2026-08-25（Asia/Shanghai）
- 固定 candidate：`2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`
- 计划 release：`mvp-20260825-172239-2a6fd940b848`（Hostdzire 已确认不存在）
- 范围：本地 Git、Hostdzire SSH 只读状态、公网匿名 HTTP；未执行 push、release/upload、image build/delete、backup、migration、seed、Compose up/recreate、Nginx reload、浏览器登录、`current` 更新或 fallback/restore。

## 1. Git 来源与产品差异

- Task 创建前主工作区位于 clean `main`；Task 分支与 `main` 均指向 fixed candidate。
- live `origin/main`=`0e472399bc09a82ffba7e16ca4f245b01267d475`，本地 `main` 单向超前 7 个提交；`origin/main` 是 fixed candidate 祖先，分叉计数 `0/7`。
- 7 个提交包括上一 activation recheck 文档/归档、Zod jitless 产品修复/归档和 Trellis journal。
- 相对活动 Staging candidate 的产品差异精确为：
  - `frontend-v2/src/main.tsx`：先同步 `z.config({ jitless: true })`，再动态导入 `AppProviders`；
  - `frontend-v2/tests/e2e/auth-session.spec.ts`：增加权威 production CSP 下匿名登录无违规/运行时错误回归。
- `backend/`、`contracts/`、`deploy/`、`.env.example` 与 V1 `frontend/` 无差异。

## 2. full/fast 判定

- 当前 `/root/partsignal/current` 指向历史 `afb1b8c82f40` release；fixed candidate 相对该基线新增 `0041`–`0043` migration 并修改 `deploy/compose.staging.yaml`，会触发 fast 脚本的关键路径拒绝。
- 本修复位于匿名认证前的全局应用启动链，关闭严格 CSP/Trusted Types P1；Runbook 要求完整发布与登录后浏览器验收。
- fast outer script 会在基础 HTTP title 通过后自动更新 `current`，违反本 Task 的 Browser Gate/protected-state 全绿后再单独授权更新边界。
- 结论：推荐 full 手工发布；不使用 fast outer script，也不直接设置 `PARTSIGNAL_DEPLOY_MODE=fast`。

## 3. 当前 Hostdzire runtime

- SSH alias=`hostdzire`，hostname=`scrapy`、uid=`0`、pwd=`/root`；无 host-key 冲突。
- Nginx=`1.29.8`，`nginx -t` 通过；site target=`/etc/nginx/sites-available/partsignal-staging.conf`。
- site checksum=`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`。
- security snippet checksum=`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`。
- `current`=`releases/mvp-20260806-195740-afb1b8c82f40`。
- PostgreSQL、Redis、API、worker、scheduler 均 healthy；fake-oss/frontend running；七个 service `RestartCount=0`。
- DB revision=`0043_geo_platform_identity`；migrate container 集合为空。
- loopback ready=200，loopback frontend marker=`PartSignal Frontend V2`。

## 4. 当前活动 candidate artifact

Release=`mvp-20260825-160838-0e472399bc09`：

- backend/fake-oss image ID=`sha256:cc259f87a5ffc953f8a84f2e00a6751fc4d5449677f161bf4fdc71a758449ac7`；
- candidate-aligned V1 image ID=`sha256:5221f2224623d2197a0e78c3518c729a1c71b7c4d82b39182225055cefbd514c`；
- active V2 image ID=`sha256:049456113dec0bf1020c80027a101a135f9ea37e1aeb792347ca495aa310743c`；
- release Compose checksum=`6b321800887c15605a218df303e536e1781e0c5d8825d2a9b465328a5a7f5aa6`；
- fresh backup=`/root/partsignal/backups/partsignal-20260825T081123Z.sql.gz`，31,527 bytes，mode 0600，SHA-256=`646587b75e50688e9ea9497d3324e3563abe03533044c91357d29a74003e11ea`；
- activation audit dir=`/root/partsignal/activation-recheck-mvp-20260825-160838-0e472399bc09`，mode 0700；before/after/artifact/candidate-protected evidence 文件均存在。

这些 artifact 是当前现场与回退证据，不替代新 candidate 必须重新冻结的三个 image ID 和 fresh backup。

## 5. 公网 HTTP baseline

- 标题=`PartSignal Frontend V2`；main JS=`/assets/index-yCpPSAMt.js`，CSS=`/assets/index-CqrlkINc.css`。
- `/`、`/index.html`、`/login`、Products、Content、Publishing、GEO、Settings、System 代表 deep link、live、ready 均为 200；匿名 `/api/v1/auth/me=204`。
- HTML/client fallback=`no-cache`；main JS=`immutable` 且 `Vary: Accept-Encoding`。
- missing asset=404；main JS `.map=404`；main JS 无 `sourceMappingURL`。
- CSP、Trusted Types、HSTS、COOP、DENY、nosniff、Referrer-Policy 均存在，CSP `script-src` 仅 `'self'` 且没有 `unsafe-eval`。
- 该 baseline 只证明旧 candidate 的 HTTP Gate 仍健康；没有运行浏览器，不能证明 TrustedScript P1 已在 Staging 关闭。

## 6. 当前授权边界

实际执行了 SSH 只读命令、容器内只读 `alembic_version` 查询和公网匿名 HTTP GET/HEAD 类检查。两次探针因只读命令模板/本地 zsh 特殊变量失误提前停止，修正后补全证据；均未留下本地以外状态变化。

未执行 push、remote source/release/image/backup/container/database/Nginx/current 写操作，也未创建浏览器 session、读取凭据或执行 fallback/restore。

## 7. 当前 Gate

- Repository fix evidence=`MET`（继承已归档 Zod blocker 的真实 production artifact 结果）。
- Source Gate=`NOT_MET`：`main` 尚未 push 到 live origin。
- HTTP baseline=`MET`（旧 candidate 仍活动）。
- 新 candidate deployment/HTTP/Browser/protected-state Gate=`PENDING`。
- Staging Gate 维持上一任务结论 `NOT_MET`，直到新 candidate 的完整 Required Gate 产生新证据。
