# DEF-AI-001 实现计划

## 实现顺序

1. 同步修改 production/staging Nginx API upstream 空闲寿命为 30 秒。
2. 同步修改 production/staging Uvicorn API 命令为空闲寿命 35 秒。
3. 扩展既有部署脚本自检，锁定两侧精确值和环境一致性。
4. 更新 Hostdzire 部署附录的故障诊断与配置不变量。
5. 运行 Nginx 项目检查、部署脚本测试和两份 Compose 配置校验。

## Required Validation

```sh
node deploy/scripts/check-nginx-security.mjs
make test-deploy-scripts
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_VERSION=test \
docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
PARTSIGNAL_VERSION=test \
docker compose --env-file .env.staging -f deploy/compose.staging.yaml config --quiet
```

如本机没有 `.env.staging`，staging Compose 结构由
`deploy/scripts/test-deploy-staging.sh` 的隔离环境覆盖，并明确记录跳过直接命令的原因。

## Optional Validation

```sh
make verify
```

## 部署后回归

部署另行授权并使用完整部署：

1. `nginx -t` 通过，生效 upstream 为 30 秒，API 进程参数为 35 秒。
2. API 容器健康、无重启和 OOM。
3. 每隔 6 秒执行一次公网只读 health 请求，连续至少 6 次均为 200。
4. 验证时间窗内 Nginx 不再出现 `upstream prematurely closed connection`。
5. 管理员真实浏览器只读打开平台管理页，Prompt 列表请求、控制台和失败请求正常；不修改配置、不调用模型。
