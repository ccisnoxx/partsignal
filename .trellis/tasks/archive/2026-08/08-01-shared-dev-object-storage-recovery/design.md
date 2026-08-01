# 共享开发对象存储启动恢复：技术设计

## 1. 设计结论

只修改开发 Compose 的 `fake-oss` 启动命令：从 `uv run python -m app.files.fake_server` 改为 `python -m app.files.fake_server`。镜像已在构建期完成依赖安装，直接 Python 与 staging 的现有模式一致，可以删除运行时项目同步这一唯一已确认故障源。

## 2. 权威启动链

```text
backend/Dockerfile
  -> uv sync --no-dev 到 /opt/venv
  -> PATH=/opt/venv/bin:$PATH
  -> compose.dev bind mount backend 源码到 /app
  -> python -m app.files.fake_server
  -> app.dev_storage:app 监听 0.0.0.0:9000
```

bind mount 只替换源码目录，不替换 `/opt/venv`。因此直接 `python` 使用镜像既有依赖，不需要 `uv` 再解析 `/app/pyproject.toml`。

## 3. 文件与行为边界

| 文件 | 设计改动 |
| --- | --- |
| `deploy/compose.dev.yaml` | `fake-oss.command` 改为直接 Python 入口 |
| `.trellis/spec/infra/development-object-storage.md` | 固化构建期依赖、运行期入口、端点和真实文件流验证合同 |
| `backend/Dockerfile` | 只读权威证据，不修改 |
| `backend/tests/unit/test_development_storage.py` | 运行既有协议测试；只有发现实际覆盖缺口时才补最小测试 |

不新增启动脚本、wrapper、healthcheck、依赖或配置项。

## 4. 验证数据流

```text
浏览器/验证客户端
  -> API 创建 upload intent
  -> fake-oss PUT 保存真实字节和 metadata
  -> API HEAD 校验 size + sha256
  -> API 标记文件 VERIFIED
  -> 签名 GET 下载并核对内容
  -> 精确删除本任务对象和关联记录
```

单元测试证明协议语义；共享开发 smoke 证明 Compose 网络、端点、签名 URL 和浏览器访问边界共同可用。隔离 E2E 仍按 `.trellis/spec/infra/e2e-isolation.md` 使用独立临时存储，不复用共享卷。

## 5. 取舍、风险与回滚

- 取舍：复用镜像和 staging 的原生 Python 入口，不增加自定义启动脚本。
- 风险：若镜像未按当前 Dockerfile 重建，旧容器可能无法证明修复；验证必须包含 `--build`。
- 风险：浏览器 smoke 会创建对象；必须记录唯一对象并精确清理，禁止清扫共享卷。
- 回滚：仅有一行可逆 Compose 配置；若直接 Python 暴露新的镜像缺陷，停止实施并回到规划，不用在线同步掩盖缺失依赖。
