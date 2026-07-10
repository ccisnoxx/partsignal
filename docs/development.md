# PartSignal 本地开发

## 前置条件

- Python 3.12 与 `uv`
- Node.js 22 与 npm
- Docker 与 Docker Compose

## 启动

```bash
make bootstrap
make dev
```

`make dev` 会先启动 PostgreSQL 和 Redis，执行一次 Alembic 迁移，再启动 API、Worker、租约恢复调度器、开发对象存储和 Vite。API 默认位于 `http://127.0.0.1:18000`，前端位于 `http://127.0.0.1:5173`。

本地 `.env` 由 `.env.example` 创建且不得提交。默认内容生成器和对象存储均为开发实现，不会调用真实外部服务。开发对象存储会实际接收上传字节并校验 `size`、`sha256` 和 `content-type`，不会用伪造成功响应绕过文件状态机。

如需在独立的受控环境验证阿里云 OSS 适配器，将 `OBJECT_STORAGE_BACKEND` 设置为 `aliyun_oss`，并提供 `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`。缺少任一配置时文件请求会明确失败，不会回退到开发存储；不得使用生产 Bucket 或生产凭据进行本地测试。

## 契约流程

公共接口先修改 `contracts/openapi.yaml`，再实现 Pydantic 和前端生成类型。运行 `make contract-generate` 更新前端产物，运行 `make contract-check` 检查漂移。子 Agent 不得直接修改公共契约。
