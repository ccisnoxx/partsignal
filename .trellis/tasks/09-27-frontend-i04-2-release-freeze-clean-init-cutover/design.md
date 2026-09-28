# I04-2 设计

## 边界与状态归属

- Git/main 是 release source identity 的唯一来源；source archive 必须从 clean、已推送的最终 main 生成。
- `create-release-manifest.py` 是 release manifest 合同 owner；manifest 在 Hostdzire 固定 release 目录排他创建并保持 `0600`，记录 archive 和镜像不可变身份。
- `/root/partsignal/shared/.env.production` 是固定 Production 配置 owner；release 不复制、包含或备份该文件。
- `prepare-production-data.py` 和 `activate-production.sh` 的 deploy-state/lock 是 clean-init 与 activation 状态机 owner；不绕过脚本直接写数据库或伪造阶段。
- Nginx 切换使用同目录临时文件、校验、原子 rename/reload；maintenance 和 final 配置的旧/新 checksum 与备份必须冻结。
- quarantine 只做同一 device 原子 rename，并绑定唯一 run ID；观察完成前不删除。

## 阶段门禁

1. **Local closure**：Trellis-only commit/push 后重验 identity、range diff、clean tree、secret scan；确认完整 Gate 复用边界未被破坏。
2. **Remote read-only precheck**：验证 host、资源、Docker/Compose/Nginx、current release、containers/images/health、migration、listeners、TLS、Production env metadata/脱敏配置合同、数据设备和 rollback identity。
3. **Release freeze**：生成唯一 release/run ID、deterministic archive、linux/amd64 backend/frontend images 和非空 RepoDigest；排他生成 manifest，并重新读取验证。
4. **Pre-cutover review**：独立 reviewer 只读核对所有身份、命令、状态转换、rollback、credential owner TTY 和停止条件。只有 `NO BLOCKER` 才继续。
5. **Maintenance/T0**：原子安装维护配置、`nginx -t`、reload，稳定确认公网 503；记录 T0 后才停止旧应用服务。
6. **Quarantine and prepare**：确认无写入/mount 后同设备 quarantine；只通过 `deploy.sh`/`prepare-production-data.py` 到 `PRODUCTION_PREPARED`。
7. **External Services Gate**：credential owner true TTY bootstrap；真实 provider 生成和受控 OSS upload/HEAD/read/CORS/cleanup。任一失败不 activation。
8. **Activation/final Nginx**：只通过 `activate-production.sh` 启动 worker/scheduler并达到 `PRODUCTION_INITIALIZED`，随后原子切换 final Nginx。
9. **Acceptance/observation**：完成规定的回环、公网、浏览器、安全、权限、runtime、migration、state 和多采样观察；保持 rollback/quarantine。
10. **Closeout**：fresh post-observation review 后更新 Trellis、提交并 non-force push；只做明确允许的精确清理。

## Secret 与失败语义

- 所有日志只允许固定枚举、键名存在性、configured 布尔、大小、hash、ID/RepoDigest/platform；禁止 secret 值。
- AI API key 不进入 argv、env、文件或 shell history，只经 Hostdzire true TTY/no-echo 到 backend stdin；任何 EOF、non-TTY、信号、timeout、provider 明确失败或结果未知均 fail-closed。
- rollback image 在 I04 完成前不得删除、改 tag 或覆盖。当前冻结身份为 `partsignal-frontend:mvp-20260830-133651-a663bcce` / `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e` / `linux/amd64`。
