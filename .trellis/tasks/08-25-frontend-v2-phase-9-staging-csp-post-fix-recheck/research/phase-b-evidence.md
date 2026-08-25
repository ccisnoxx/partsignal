# Staging Phase B 证据

- 执行时间：2026-08-25（Asia/Shanghai）
- 固定 candidate：`2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`
- 固定 release：`mvp-20260825-172239-2a6fd940b848`

## Source、release 与备份

- `main`、`origin/main` 与 live `refs/heads/main` 均固定为 candidate；Source Gate 与 Nginx security source check 通过。
- `git archive` 大小=`12422116`，SHA-256=`75c18b9563b001041289a69ceb013a381a2df6a9f15a319f6133f56c96eafcd9`；禁止目录、环境文件、密钥和 AppleDouble 检查通过。
- immutable release=`/root/partsignal/releases/mvp-20260825-172239-2a6fd940b848`；共享 `.env.staging` 保持 `0600` 且只通过既有 symlink 使用。
- fresh backup=`/root/partsignal/backups/partsignal-20260825T094541Z.sql.gz`，大小=`31661`，SHA-256=`11361670c8c773da41d1893f0c810afd2fb64484a6cdec72ab0d81ce26412b17`。
- before snapshot SHA-256=`e60bc675ef94705cb0eeeff706c3b3fdee8a4de2e171b8bc56db257cd5583311`；after/protected snapshot SHA-256=`b1cc9bce632d88bfecf03828d751a255280226f12a6eaef7e882b13c6e26b5a5`。

## Full deployment

- 完整 `deploy-staging.sh` 已执行；preflight、构建、migration、seed、Compose replacement 和部署后检查完成。
- backend/fake-oss image ID=`sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f`。
- V1 image ID=`sha256:dfadfd534b11d80bdf993566c4b46cf9c6f87ef1283e303902d5b2130eca4fa4`。
- V2 image ID=`sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`。
- fake-oss、api、worker、scheduler 使用新 backend ID；frontend 使用新 V2 ID；均 running、restart=`0`。PostgreSQL、Redis、API、worker、scheduler healthy。
- DB revision=`0043_geo_platform_identity`；migrate container 集合为空；`nginx -t` 通过，Nginx 配置 checksum 未漂移。
- 未修改或 reload Nginx；未执行 fallback、restore；`current` 保持 `releases/mvp-20260806-195740-afb1b8c82f40`。

## HTTP Gate

- 公网与回环 `/api/health/live`、`/api/health/ready` 均为 200，ready 的 PostgreSQL/Redis 均为 `ok`；匿名 `/api/v1/auth/me=204`。
- `/`、`/index.html`、`/login` 与 8 条业务 deep link 均为 V2 index、`no-cache`，标题=`PartSignal Frontend V2`。
- HTML 实际引用 `/assets/index-D_Q0vei7.js`、`/assets/jsx-runtime-B-hcVAMW.js`、`/assets/index-CqrlkINc.css`；均为 200、immutable 且含 `Vary: Accept-Encoding`。
- missing asset 与主 JS `.map` 均为 404；V2 容器内 `.map=0`、包含 `sourceMappingURL` 的 JS=`0`。
- HTML/JS/CSS 的 CSP、Trusted Types、HSTS、COOP、frame、nosniff、Referrer-Policy 均精确且唯一；CSP 无 `unsafe-eval`，Trusted Types 保持 `dompurify` 与 `require-trusted-types-for 'script'`。
- 2026-08-25T09:53:30Z–09:54:01Z 完成 6 次间隔 6 秒的公网/回环 ready probe，6/6 通过；Nginx premature-close 计数 `0→0`。

结论：Phase B 与 HTTP Gate=`MET`。后续 Browser Gate 与 protected-state 证据见 `browser-gate-evidence.md`；`current` 尚未更新。
