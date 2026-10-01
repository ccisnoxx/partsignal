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

文件传输采用“浏览器 → PartSignal API → 对象存储”：上传意图返回 `/api/v1/files/{file_id}/content` 相对路径，浏览器携带会话和 CSRF 以 `application/octet-stream` PUT 原始字节。API 检查意图创建者、PENDING 状态、有效期、实际大小和 SHA-256 后保存对象，原文件类型取意图中的已校验值；传输成功仍需 complete 的 HEAD 校验才能成为 VERIFIED。此路径无需浏览器直连 OSS 的上传 CORS，也不要求应用凭据具备 GetBucketCors/ListObjects 管理权限。限时下载 URL 和对象访问权限沿用现有行为；public-read Bucket 的签名有效期不能限制匿名公开读取。

## 契约流程

公共接口先修改 `contracts/openapi.yaml`，再实现 Pydantic 和前端生成类型。运行 `make contract-generate` 更新前端产物，运行 `make contract-check` 检查漂移。子 Agent 不得直接修改公共契约。

## 模块修改规则

新增或调整写路径时，先定位拥有业务不变量的应用服务。Router 不直接提交事务、获取行锁、追加审计或修改 ORM 实体；它只处理 HTTP 输入输出、认证依赖和错误映射。不要为简单查询或单行调用增加只转发参数的 Service、Repository、Helper，也不要在模块间直接写入对方实体。

Schema 从 `app.schemas.<domain>` 直接导入，ORM 类从 `app.models.<domain>` 直接导入。新增模型仍使用 `app.db.Base` 和字符串外键，并在 `app.models.__init__` 注册所属模块；修改映射后必须检查 mapper 配置、metadata 表集合和 Alembic head，不能为了拆文件生成迁移。canonical `frontend/` 只从 `src/shared/api/generated/schema.d.ts` 使用 OpenAPI 生成类型；query key 由对应 domain/API owner 统一持有，不得复制接口类型、页面内 query key 或客户端业务状态机。
