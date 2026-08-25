# Frontend V2 Phase 9 Staging Activation Recheck 只读盘点

- 观察时间：2026-08-25
- 固定 candidate：`0e472399bc09a82ffba7e16ca4f245b01267d475`
- 范围：本地 Git、Hostdzire SSH 只读状态、公网匿名 HTTP；未执行 push、release/upload、image build/delete、backup、migration、seed、Compose up/down/recreate、Nginx reload、`current` 修改、浏览器登录或 rollback。

## 1. Git 来源

- 本地 `main` 与 branch 起点均为固定 candidate。
- tracking 与 live `origin/main` 均为 `68001d759983cf0b8f111aa1e46c71ae9713aa36`。
- `candidate` 不是 `origin/main` 祖先，且 `git ls-remote origin` 没有任何 ref 直接指向 candidate。
- 结论：candidate 尚未成为 Runbook 允许的发布来源，activation 必须停止。

## 2. Staging 身份与资源

- SSH alias `hostdzire` 连接到 hostname=`scrapy`、uid=`0`、pwd=`/root`，无 host-key 冲突。
- `/root/partsignal/shared/.env.staging`：mode=`600`、owner=`root:root`；`APP_ENV=staging`、`APP_BASE_URL=https://geo.962850.xyz`、`OBJECT_STORAGE_BACKEND=development`、CORS origin 与公网 URL 一致。
- Runbook 必需敏感键均存在，但未输出值；账号/密码是否实际可登录尚未验证。
- `/root/partsignal/backups`：mode=`700`、owner=`root:root`；最新列出的 SQL backup 为 2026-08-06，不是本次 fresh backup。
- 根磁盘可用 `49,162,473,472` bytes，使用率 `51%`。
- Docker=`29.4.1`，Compose=`5.1.3`。

## 3. 当前 release、容器与 DB

- `current`=`releases/mvp-20260806-195740-afb1b8c82f40`，当前 release Compose frontend context=`../frontend`。
- 当前 Compose project=`partsignal-staging`；PostgreSQL、Redis、API、worker、scheduler 为 healthy，fake-oss/frontend 为 running，所有 RestartCount=`0`。
- 当前 backend image ref=`partsignal-backend:mvp-20260806-195740-afb1b8c82f40`，image ID=`sha256:9f10fe5a056a9fd26d17746c5509c7662f1f38311419762b188f4504b53c488c`。
- 当前 frontend image ref=`partsignal-frontend:mvp-20260806-195740-afb1b8c82f40`，image ID=`sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec`。
- DB revision=`0040_content_draft_management`；candidate head=`0043_geo_platform_identity`。当前没有 migrate container。
- 历史 V1 release/image/source 只作为历史证据；其 backend 不允许连接迁移后的 `0043` DB。

## 4. Nginx 与公网对应

- Hostdzire Nginx=`1.29.8`，`nginx -t` 通过。
- 生效 site=`/etc/nginx/sites-available/partsignal-staging.conf`，`server_name geo.962850.xyz`，监听 `10.0.0.2:80/443 proxy_protocol`。
- upstream 精确指向 `127.0.0.1:19000/19001/19080`；三端口仅监听 loopback。
- Hostdzire 解析公网域名为 `179.255.101.113`，从 Hostdzire 请求公网 URL 返回 `200` 且 remote IP 同为该地址。
- 生效 site checksum=`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`；security snippet checksum=`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`，后者与 candidate 仓库 owner 一致。
- 本轮未 SSH 登录 `dmit`，因此 DMIT 生效配置未直接读取；Hostdzire runtime、域名、loopback upstream 与公网响应已形成一致映射。

## 5. 公网 HTTP baseline

- `/` 标题=`PartSignal · GEO 内容运营`；JS=`/assets/index-B12Mu6hl.js`，CSS=`/assets/index-DR1898Ft.css`。
- `/`、`/index.html`、`/login`、V2 代表 deep links、live、ready 均为 `200`；匿名 `/api/v1/auth/me` 为 `204`。
- JS/CSS 为 `200` 且 immutable；missing asset 为 `404`。
- `/assets/index-B12Mu6hl.js.map` 为 `200 application/json`，主 JS 含 `sourceMappingURL`。
- HTML/client fallback 为 `no-cache`；CSP、HSTS、COOP、DENY、nosniff、Referrer-Policy 均存在且符合 Runbook。
- 结论：公网当前明确是 V1 artifact；这不是本次 V2 Gate 的新失败，只是 activation 前 baseline。固定 candidate 未激活。

## 6. 实际远程动作边界

执行了 SSH 只读命令、现有容器内只读 SQL 和匿名 HTTP GET/HEAD 类检查。首次 HTTP 探针在远端 `/tmp/ps-readonly-probe-body` 创建响应临时文件并立即删除，未留下持久状态；这是本轮唯一临时写入。未执行任何业务、数据库、容器、镜像、Nginx、release、backup 或 `current` 写操作。

## 7. 实施阶段来源更新

- 用户单独授权执行 `git push origin main:main`。
- Push 前再次确认 live `origin/main` 仍为原盘点 SHA，且它是 candidate 的祖先。
- 非强制 push 成功：`68001d75..0e472399`。
- Push 后 live 与 tracking `origin/main` 均精确为固定 candidate；未 force、pull、merge 或 rebase。

## 8. 当前 Gate 结论

- Repository Gate=`MET`（继承既有已验证 candidate 证据）。
- Source Gate=`MET`：`main=origin/main=candidate`。
- Activation precondition=`PENDING`：Task 文件尚未提交，staging 写操作尚未授权，fresh backup 和 candidate images 尚未创建。
- Staging Gate=`PENDING`：本轮未获真实 staging 写授权，也未执行 activation 或 Browser Gate；不得提前判 `MET` 或复用第一次 `NOT_MET` 代替本次 recheck 结果。
