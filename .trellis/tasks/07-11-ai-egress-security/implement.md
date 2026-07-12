# AI 出站安全实施计划

## 实施步骤

1. **解析和值对象**
   - [x] 将 URL 校验改为返回不可变 `ResolvedEndpoint`。
   - [x] 覆盖公网、回环、私网、链路本地、混合 A/AAAA、端口和环境规则。
2. **固定目的地址的传输**
   - [x] 实现只连接批准 IP 的同步 HTTP/HTTPS 传输。
   - [x] HTTPS 使用原始 hostname 完成 SNI 与证书校验。
   - [x] 在发送 Header 前校验实际 TCP peer。
   - [x] 设置响应大小、连接/读取超时和禁止重定向。
3. **统一调用路径**
   - [x] 模型发现、模型测试和内容生成全部切换到新传输。
   - [x] 删除旧的校验后 hostname 二次解析路径。
   - [x] 保持严格响应解析和现有错误码语义。
4. **安全测试**
   - [x] DNS 首次公网、后续私网时证明只解析一次且只连接首次批准 IP。
   - [x] peer 不在批准集合时，在发送敏感 Header 前关闭连接。
   - [x] 验证 SNI、Host、证书 hostname、302 拒绝和正常公网式 HTTPS。
   - [x] 检查日志、异常和审计不包含凭据或敏感 Header。
5. **规范与部署**
   - [x] 更新 AI 边界规范和运维禁用步骤。
   - [x] API/Worker 同批部署并用真实 HTTPS 替身回归三条调用路径。

## 验证命令

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make verify
```

## 回滚点

- 新传输与供应商兼容失败时禁用相关 AI 渠道，保留失败证据并修复。
- 不允许恢复旧 TOCTOU 请求路径作为临时回退。
- 若实现需要依赖私有网络库接口，停止实施并回到设计评审，不以版本锁定掩盖不稳定边界。

## Goal 1 完成门禁

- [ ] 模型发现、模型测试、内容生成全部共用新 Transport，旧请求路径已删除。
- [ ] DNS 首次公网、后续私网场景证明连接只使用首次批准集合，而不是仅再次调用校验函数。
- [ ] peer 越界测试证明敏感 Header 尚未发送，连接即被关闭并返回 `AI_URL_FORBIDDEN`。
- [ ] 使用真实本地 CA/HTTPS 替身验证 SNI、Host、证书 hostname、重定向拒绝和响应大小限制。
- [ ] 与 generation-reliability 的真实 PostgreSQL/Redis/Worker 集成链路共同通过后才能完成。
- [ ] 完成后停止；不自动提交、推送或进入 Goal 2。

## 未提交候选证据（2026-07-11，待 Goal 1 复核）

- 固定传输单元测试覆盖单次解析、混合地址拒绝、peer 零发送、连接前换址、发送后不换址和响应上限；真实本地 CA/HTTPS 集成测试验证 SNI、证书 hostname 与 Host。
- Playwright 真实 HTTP 链路覆盖 `/models`、模型测试和内容生成；`INTERNAL` 输入实际返回 `AI_DATA_CLASSIFICATION_FORBIDDEN`，`PUBLIC` 输入成功。
- 以上结果只证明某次工作区运行，不替代 Goal 1 对当前连接实现、调用链和完整验证的重新验收。
