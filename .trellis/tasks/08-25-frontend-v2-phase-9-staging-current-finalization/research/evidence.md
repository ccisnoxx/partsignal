# Staging current finalization 证据

- 执行时间：2026-08-25 21:39–21:45（Asia/Shanghai）
- 固定 candidate：`2a6fd940b84890d269bf1196a8c6e16b4cd9a9f9`
- 固定 release：`mvp-20260825-172239-2a6fd940b848`

## 1. Pre-current 只读门禁

- fixed release 目录存在；backend、candidate-aligned V1、V2 三个 tag 的 image ID 精确等于冻结值。
- frontend 使用 V2 image ID `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`；api、worker、scheduler、fake-oss 使用 backend image ID `sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f`。
- `postgres redis fake-oss api worker scheduler frontend` 的 container ID 与上一 Browser Gate 后证据一致，均为 `running`、restart=`0`；PostgreSQL、Redis、API、worker、scheduler 均为 `healthy`。
- DB revision=`0043_geo_platform_identity`；migrate container 集合为空。
- Nginx target=`/etc/nginx/sites-available/partsignal-staging.conf`；site SHA-256=`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`；security snippet SHA-256=`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`；`nginx -t` 通过。
- `current` 执行前精确为 `releases/mvp-20260806-195740-afb1b8c82f40`。
- 新生成的 `pre-current-protected.txt`、上一任务 `candidate-protected.txt` 和 `after-browser.txt` 逐字节一致，三者 SHA-256 均为 `b1cc9bce632d88bfecf03828d751a255280226f12a6eaef7e882b13c6e26b5a5`。

## 2. Pre-current HTTP smoke

- public live/ready=`200`，ready 的 PostgreSQL/Redis=`ok`。
- `/`、`/login`、`/content/tasks` 均为同一 V2 index，标题=`PartSignal Frontend V2`、cache=`no-cache`。
- 实际 assets 为 `/assets/index-D_Q0vei7.js`、`/assets/jsx-runtime-B-hcVAMW.js`、`/assets/index-CqrlkINc.css`；全部 `200`、immutable、`Vary: Accept-Encoding`。
- missing asset=`404`；两个 JS 的 `.map=404`；`sourceMappingURL=0`。
- HTML/JS/CSS 的 CSP、Trusted Types、HSTS、COOP、DENY、nosniff、Referrer-Policy 均唯一且符合既有合同。

结论：pre-current 只读门禁=`MET`。

## 3. 原子更新

- 目标 release 存在，固定临时 symlink 路径执行前不存在。
- 创建相对 symlink `releases/mvp-20260825-172239-2a6fd940b848` 后，使用同目录 `mv -Tf` 原子替换 `/root/partsignal/current`。
- 更新后 `readlink` 精确为 `releases/mvp-20260825-172239-2a6fd940b848`。
- 未删除、重命名或覆盖任何 release 目录；未执行部署、Compose、migration、seed、数据库/Nginx/shared env 写入、fallback 或 restore。

## 4. Post-current 验证

- `post-current-protected.txt` 相对 pre-current snapshot 仅有一行变化：

```diff
-current|releases/mvp-20260806-195740-afb1b8c82f40
+current|releases/mvp-20260825-172239-2a6fd940b848
```

- 删除唯一 `current|` 行后，两份 snapshot 逐字节一致；所有 container ID、image ID、state、health、restart、DB revision、migrate 集合、Nginx target/checksum 均未变化，`nginx -t` 再次通过。
- post-current HTTP smoke 使用相同矩阵再次通过：live/ready、V2 index/deep link、2 个 JS、1 个 CSS、cache、安全头、missing/map 404 与 `sourceMappingURL=0` 均保持。

## 5. Browser Gate 继承与结论

- 上一任务的完整 Browser Gate 绑定同一 fixed release、同一 V2 image ID，并在结束时与冻结 protected snapshot 逐字节一致。
- 本 Task 的 pre-current snapshot 仍精确等于该证据；`current` 仅为验收记录，不是流量开关；post-current 除该记录行外运行态与 HTTP artifact 零漂移。
- 因此继承上一任务完整 Browser Gate=`MET`，不机械重跑浏览器矩阵，也未使用 ADMIN/ENGINEER 凭据。
- open P0/P1/P2=`0/0/0`；fallback/restore=`未执行`；V2=`保持活动`。

最终结论：`Staging Gate=MET`。
