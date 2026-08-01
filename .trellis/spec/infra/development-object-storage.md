# 开发对象存储运行契约

## 1. Scope / Trigger

适用于共享开发 Compose 中 `fake-oss` 的启动、端点配置、故障诊断和真实文件流验证。隔离 E2E 仍使用独立临时存储，遵循 [E2E 运行隔离契约](./e2e-isolation.md)，不得复用共享卷或据此清扫共享数据。

## 2. Signatures

```text
docker compose --env-file .env -f deploy/compose.dev.yaml up -d --build --wait fake-oss
fake-oss.command = [python, -m, app.files.fake_server]
python -m app.files.fake_server -> app.dev_storage:app -> 0.0.0.0:9000
```

镜像在 `backend/Dockerfile` 构建期通过 `uv sync --no-dev` 把运行依赖安装到 `/opt/venv`，并把 `/opt/venv/bin` 放入 `PATH`。`backend/` bind mount 只替换 `/app` 源码；运行期必须直接使用镜像 Python，不得通过 `uv run` 重新同步项目或访问 PyPI。

## 3. Contracts

- `OBJECT_STORAGE_BACKEND=development`：显式选择开发适配器；未知值直接失败。
- `OBJECT_STORAGE_ENDPOINT=http://fake-oss:9000`：API、Worker 等容器使用的内部端点。
- `OBJECT_STORAGE_PUBLIC_ENDPOINT=http://localhost:19001`：浏览器直传和下载使用的主机端点。
- `UPLOAD_SIGNING_SECRET`：签署 `operation + object_key + expires`；开发服务拒绝错误或过期签名。
- `OBJECT_STORAGE_PATH=/data`（默认）：对象和 `.metadata.json` 的单一共享卷根目录。
- PUT 必须携带 `content-type` 与 `x-meta-sha256`；HEAD 返回 `x-object-size`、`x-meta-sha256` 与 `content-type`；DELETE 幂等删除对象及 metadata。
- 开发与 staging 默认都绑定 `127.0.0.1:19001`，同一主机不能同时占用该端口。端口冲突是显式环境所有权问题，不得通过修改权威端口或停止范围外服务来掩盖。

## 4. Validation & Error Matrix

| 条件 | 预期处理 |
| --- | --- |
| 镜像缺少运行依赖，直接 Python 报 `ImportError` | 停止验收并核对 Dockerfile/镜像构建；不得恢复 `uv run` 或增加联网 fallback |
| `127.0.0.1:19001` 已被其他栈占用 | 识别端口所有者；仅在获得授权后释放，或用不落盘的临时端口覆盖完成诊断 |
| 签名错误、操作不匹配或已过期 | 对象服务返回 403，不匿名回退 |
| 对象不存在 | HEAD/GET 返回 404；业务层区分 `StorageObjectMissing`，不得伪造历史对象 |
| PUT 哈希与 `x-meta-sha256` 不一致 | 返回 422，不保存对象 |
| 网络、鉴权或服务端错误 | 业务适配器抛出 `StorageUnavailable`，由调用边界显式返回依赖不可用 |
| 共享数据库保留隔离测试对象 Key，但共享卷没有对应对象 | 按历史数据所有权另行调查；不得回填猜测内容或广泛清扫记录 |

## 5. Good / Base / Bad Cases

- Good：镜像重建后 `fake-oss` 直接 Python 持续运行；真实 upload intent → 浏览器 PUT → API HEAD/complete → 浏览器 GET → 精确 DELETE 全部成功。
- Base：服务正常启动，但请求的既有对象明确返回 404；保留该证据并按数据所有权调查，不把它误判为启动失败。
- Bad：bind mount 后使用 `uv run` 在线同步；端口冲突时自动停止另一环境；为消除 404/ORB 伪造对象或添加静默 fallback。

## 6. Tests Required

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
docker compose --env-file .env -f deploy/compose.dev.yaml up -d --build --wait fake-oss
docker compose --env-file .env -f deploy/compose.dev.yaml ps fake-oss
docker compose --env-file .env -f deploy/compose.dev.yaml logs --no-color fake-oss
UV_CACHE_DIR="$(pwd)/.cache/uv" uv run --project backend pytest backend/tests/unit/test_development_storage.py -q
```

还必须用唯一对象完成一次共享开发真实文件流，并断言 PUT 204、HEAD/complete 成功、浏览器 GET 200 且字节一致。只清理本次对象和关联记录；检查日志无 `uv run`、PyPI 或依赖同步，并确认 API、PostgreSQL、Redis、Worker、Scheduler 和前端未回归。

## 7. Wrong vs Correct

```text
Wrong: bind mount 源码 -> uv run 在容器启动时重新解析/下载依赖 -> 网络失败后 fake-oss 退出
Correct: 镜像构建期固化 /opt/venv -> bind mount 源码 -> python -m app.files.fake_server

Wrong: 既有图片 404/ORB -> 猜测并回填历史对象，或清扫共享数据库记录
Correct: 先证明服务与新对象真实文件流可用 -> 将缺失历史对象按所有权单独调查
```
