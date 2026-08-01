# 基础设施规范

## 规范索引

| 规范 | 适用范围 | 状态 |
| --- | --- | --- |
| [域名安全运维](./domain-security-operations.md) | DNS、Nginx、证书、HSTS 与 preload | Active |
| [E2E 运行隔离](./e2e-isolation.md) | Playwright 独立数据库、临时存储与清理结果 | Active |
| [开发对象存储运行契约](./development-object-storage.md) | 共享开发 Compose 的对象存储启动、端点与真实文件流 | Active |

## Pre-Development Checklist

- 读取当前 Trellis 任务的 PRD、design、implement 和域名台账。
- 只读确认权威 Zone、实际 TLS 终止点、活动 Nginx/sing-box 与内部 resolver。
- 把产品决定、可逆配置写、DNS 写、HSTS 阶段和 preload 提交拆成独立授权边界。
- 明确保存位置、备份范围、验证阈值和精确回滚，禁止模糊名称删除。

## Quality Check

- DNS 写操作使用唯一 Zone/record ID，并经双权威和双公共 resolver 验证。
- 原始 Zone/BIND/API 快照只在 root 受控存储中保留；仓库仅存脱敏派生信息。
- Nginx 修改先备份、原子替换、`nginx -t`，再 reload；不把启动成功当作业务通过。
- HSTS 每阶段等待完整观察期；preload 指令和正式提交另取不可逆确认。
- 退役服务删除活动引用但保留历史证据；回滚不自动恢复已退役监听或扩大公开面。
