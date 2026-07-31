# 开发环境前端 API 代理恢复：技术设计

## 设计结论

修复只收紧现有开发启动入口：让 `frontend/package.json` 的 `dev` 脚本显式传入 `--config vite.config.ts`。这与现有生产构建和隔离 E2E 的显式配置方式一致，并从启动入口消除 Vite 自动发现同名旧 `.js` 文件的歧义。

## 当前链路与故障点

```text
浏览器 /api/*
  -> 127.0.0.1:5173（Compose 前端容器）
  -> Vite 代理
  -> VITE_API_PROXY_TARGET=http://api:8000
  -> API 容器
```

当前前两步之间没有问题；故障发生在 Vite 选择配置时：

```text
npm run dev
  -> vite 自动发现配置
  -> 选择绑定挂载的旧 /app/vite.config.js
  -> target=http://localhost:8000
  -> 在前端容器内连接自身 8000
  -> ECONNREFUSED / HTTP 500
```

修复后的唯一变化是：

```text
npm run dev
  -> vite --config vite.config.ts
  -> target=process.env.VITE_API_PROXY_TARGET
  -> http://api:8000
```

## 修改边界

### 必需修改

- `frontend/package.json`
  - 为现有 `dev` 脚本增加 `--config vite.config.ts`。

### 不修改

- `frontend/vite.config.ts`：当前环境变量和宿主机回退合同正确。
- `deploy/compose.dev.yaml`：当前服务名、网络和 `VITE_API_PROXY_TARGET` 正确。
- `deploy/scripts/e2e-local.sh`：已经显式选择 `vite.config.ts`，并需要保留宿主机 API 边界。
- 后端、OpenAPI、数据库、认证逻辑、生产配置和依赖锁文件。

旧 `frontend/vite.config.js` 与 `.d.ts` 是被忽略的本地生成文件，不纳入提交，也不依赖删除它们获得正确性；显式配置选择必须在这些旧文件仍存在时通过验证，才能证明修复可抵抗同类残留文件。

## 兼容性与回滚

- Docker Compose 继续运行 `npm run dev`，无需变更服务命令、镜像或网络。
- 隔离 E2E 仍可追加 `--host 127.0.0.1 --config vite.config.ts`；重复指定相同配置不会改变目标或数据隔离。
- 生产构建已显式使用 `vite build --config vite.config.ts`，不受此次开发脚本调整影响。
- 回滚只需撤销 `frontend/package.json` 的单行脚本变更；无需迁移数据或恢复服务端状态。

## 验证策略

1. 在旧影子配置仍存在的前提下启动/重启 Compose 前端，证明受支持启动入口选择当前 TypeScript 配置。
2. 通过代理健康检查、认证失败响应和一次有效页面登录验证真实请求链，不以“Vite 已启动”代替业务通过。
3. 重启前端容器后重复验证并检查新日志，证明修复不是一次性进程状态。
4. 暂停占用 5173 的开发前端，使用标准隔离脚本运行一个含真实登录准备流程的现有 Playwright 用例，再恢复开发前端；确认 E2E 清理结果。
