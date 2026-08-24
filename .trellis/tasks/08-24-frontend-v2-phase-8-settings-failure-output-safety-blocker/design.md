# A28 技术设计

## 1. 权威 owner

`backend/app/config.py::Settings` 是连接/credential 环境值进入进程的统一模型，因此 representation 与 Pydantic error input 应在模型 owner 收口。测试只证明合同，不承担运行时脱敏逻辑。

## 2. 最小改动

```text
SettingsConfigDict(..., hide_input_in_errors=True)
              +
sensitive Field(..., repr=False)
              |
              +--> Settings repr 不含敏感字段值
              +--> ValidationError 不含 input_value
              +--> 字段仍是 str；现有消费者不变
```

敏感字段集合由实际用途确定：

- `database_url`
- `redis_url`
- `session_secret`
- `development_storage_signing_key`
- `oss_access_key_id`
- `oss_access_key_secret`
- `ai_credential_encryption_key`

不将普通 endpoint、cookie name、TTL 或公开配置机械标为敏感。

## 3. 错误合同

- validator 仍抛相同 ValueError/ValidationError，中文原因保持不变。
- 不 catch、重写或吞掉异常。
- 不使用 `SecretStr`，避免改变 DB/Redis/security/storage/AI 调用签名。
- 不声明全局日志安全；第三方 traceback frame 通过独立 marker capture 验证。

## 4. Regression 设计

1. 合法 Settings 使用每字段不同 marker，repr 不得包含任一 marker；公开字段仍存在。
2. 非法 Settings 使用受控 marker，ValidationError 必须保留预期原因，但不含 marker、连接 scheme或 `input_value=`。
3. 受控子进程产生预期失败并捕获输出，只回报 marker 命中数量；命中必须为 0。
4. 现有 production boundary tests 继续验证每个独立 validator。

如果第 3 步仍命中，说明剩余 owner 位于 pytest/第三方 frame；本 Task 保持 open并停止，不把全局 runner 改动作为隐藏 fallback。

## 5. Compatibility / Rollback

- API、数据库、环境变量名称和值语义均不变。
- 运行时变化仅限 `repr()` 与 ValidationError 的输入展示；错误原因仍在。
- 回滚只撤销 Settings config/field metadata 与对应测试；不需要 migration 或数据处理。
