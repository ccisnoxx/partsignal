# Production 镜像交付契约

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
