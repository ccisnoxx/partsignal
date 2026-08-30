# Production 候选交付与维护隔离契约

## Scenario：registry 与 Host 本地候选交付

### 1. Scope / Trigger

修改 `deploy/scripts/deploy.sh`、`activate-production.sh`、候选 manifest producer/consumer 或 Production 镜像仓库约束时适用。运维步骤仍以 `docs/Hostdzire部署上线流程.md` 和 `docs/Hostdzire部署附录.md` 为权威；本规范只约束代码实现与回归测试。

### 2. Signatures

- `PARTSIGNAL_IMAGE_DELIVERY_MODE`：可选环境键；未设置为 `registry`，显式值只允许 `registry` 或 `local`，空值无效。
- `deploy/scripts/deploy.sh`：准备 PostgreSQL/Redis、migration、账号、API/frontend。
- `deploy/scripts/activate-production.sh`：外部 Gate 通过后激活 Worker/Scheduler。
- `create-release-manifest.py` 与 `prepare-production-data.py`：分别是候选身份 producer 与共享 consumer。

### 3. Contracts

- `registry` 保持 `pull -> verify-candidate-images -> run/up`。
- `local` 不 pull；候选镜像必须已存在，manifest image ID/RepoDigest 校验必须早于第一个 Compose `run/up`，相关 `run/up` 必须使用 `--pull never`。
- backend、frontend、rollback frontend 的 repository 末段以 `backend-v1` 或 `frontend-v1` 结尾时，producer 和 consumer 都必须拒绝；deploy/activate 还应在状态转换前拒绝对应环境变量。
- V1 不能进入 manifest、Production Compose 操作或 frontend rollback；V2-only 不依赖 UI 隐藏或人工约定。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| key 未设置 | 使用 `registry` |
| key 为空或未知 | 状态码 `2`，输出中文“无效的 Production 镜像交付模式” |
| local 镜像缺失或 identity 漂移 | 在任何 `run/up` 前失败 |
| manifest 含 V1 current/rollback reference | producer 或共享 consumer 明确失败 |
| registry candidate 合法 | 保持 pull 后校验与既有启动顺序 |

### 5. Good / Base / Bad Cases

- Good：Host 已顺序构建当前 backend 与 canonical `frontend/`，使用 `local`，identity 校验后以 `--pull never` 运行。
- Base：未设置 delivery mode，继续使用 registry 流程。
- Bad：local 模式缺镜像、传空 mode、使用 `partsignal-frontend-v1`，或篡改 rollback manifest；全部 fail closed。

### 6. Tests Required

`deploy/scripts/test-deploy-production.sh` 至少断言：

- registry 的 pull、identity verification、首个 up 顺序；
- local 无 pull，所有相关 `run/up` 均含 `--pull never`；
- missing image 在 `run/up` 前失败；
- 空/非法 mode 的具体错误；
- backend/frontend V1、producer V1 和 consumer 的 tampered rollback V1 都被拒绝；
- 负向用例检查具体错误原因，不能只检查非零退出码。

### 7. Wrong vs Correct

#### Wrong

```sh
docker compose up -d api frontend
```

手工 Compose 绕过 manifest/state owner，也允许 CLI 隐式 pull。

#### Correct

```sh
PARTSIGNAL_IMAGE_DELIVERY_MODE=local ./deploy/scripts/deploy.sh
```

由权威脚本完成候选校验、`--pull never` 和既有状态转换。

## Scenario：Production Nginx maintenance guard

### 1. Scope / Trigger

修改 Production manifest tracked-file allowlist、`deploy/nginx/partsignal-maintenance.conf.template`、Production/maintenance Nginx 切换顺序或对应部署自检时适用。该场景只约束仓库候选和维护隔离合同；远端 Nginx write/reload 仍必须按 Hostdzire Runbook 取得独立 exact authorization。

### 2. Signatures

```text
deploy/nginx/partsignal-maintenance.conf.template
deploy/nginx/partsignal.conf.template
deploy/nginx/partsignal-security-headers.conf
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-production.sh
```

维护 HTTPS 响应固定为：

```http
HTTP 503
Content-Type: text/plain
Cache-Control: no-store
Retry-After: 3600

PartSignal maintenance
```

### 3. Contracts

- manifest producer 与 consumer 的 `REQUIRED_TRACKED_FILES` 必须同时包含 maintenance template；Production 自检的全部 manifest 创建路径和 exact-set 断言必须使用相同 8 项集合。
- maintenance template 保留 `geo.962850.xyz`、`<HOSTDZIRE_WG_ADDRESS>`、HTTP 到 HTTPS、ACME、TLS、PartSignal security snippet 和 `add_header_inherit merge`。
- maintenance template 不得声明 upstream、`proxy_pass`、静态 `root`、`19000`、`19001`、`19080` 或 `/object-storage/`；API/frontend 即使已在同一 loopback 端口启动，也不能通过公网访问。
- 停止任何 PartSignal 容器前必须先完成 maintenance write、`nginx -t`、独立 maintenance reload 和公网 `503` 验证；首次验证时间是 60 分钟硬窗口的 T0。
- 真实 AI/OSS Gate、activation、runtime identity 和 health 全部通过后，才能执行 final Production write；final reload 与 maintenance reload 不能共用授权。
- manifest checksum 只证明候选模板身份，不证明远端 target 已安装；远端 backup、checksum、atomic replace、`nginx -t` 和 reload 证据仍由当次授权包负责。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| producer/consumer/test 任一 allowlist 缺少 maintenance template | 候选生成、消费或 Production 自检失败，不冻结 candidate |
| maintenance template 缺少 TLS/ACME/security owner | `check-nginx-security.mjs` 或 Production 自检失败 |
| maintenance template 包含 upstream、代理、静态 root 或应用端口 | Production 自检失败，不允许进入 N1 |
| maintenance reload 后公网不是固定 `503` | 不停止容器，不开始 Maintenance/Data |
| external Gate 前准备安装 final Production template | 停止，保持 maintenance 公开边界 |
| `nginx -t` 失败 | 不 reload，按 exact backup 恢复并再次测试 |

### 5. Good / Base / Bad Cases

- Good：同一 manifest 冻结 maintenance/Production template；先公开固定维护响应，再停止容器和 clean-init；真实 Gate 后才独立切回 Production。
- Base：仓库合同和 candidate 准备完成，但远端 N1/N2 未获授权；旧运行态和活动 Nginx 保持不变。
- Bad：先停止容器、只改 DNS/防火墙、停全局 Nginx，或让旧 Nginx 在真实 Gate 前代理复用 `19000/19080` 的新候选。

### 6. Tests Required

`deploy/scripts/test-deploy-production.sh` 至少断言：

- maintenance template 精确包含 host、HTTP/HTTPS listen、ACME、TLS、安全 snippet、`add_header_inherit merge`、固定状态/正文/cache/retry 响应；
- maintenance template 不包含 upstream、`proxy_pass`、静态 root、三个应用端口或 `/object-storage/`；
- producer、consumer、三组 manifest producer test input 与 manifest exact-set assertion 均包含相同 8 项 tracked files；
- `check-nginx-security.mjs` 把 maintenance template 与 Production/Staging template 一起检查，拒绝缺少安全 snippet、缺少 header inheritance 或重复安全头。

### 7. Wrong vs Correct

#### Wrong

```text
停止旧容器 → clean-init 启动新 API/frontend 到 19000/19080
→ 旧 Nginx 立即把未完成真实 Gate 的候选暴露到公网
```

#### Correct

```text
manifest 固定 maintenance template → atomic write → nginx -t
→ 独立 reload 授权 → 公网 503/T0 → exact stop + clean-init + real Gate
→ final template atomic write → nginx -t → 独立 final reload 授权
```
