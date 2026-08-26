# Sanitizer 本地实施证据

## 本次边界

- 只完成 Phase 0–1：启动子 Task、锁定 0043 schema、实现字段矩阵、sanitizer、verifier
  与本地 self-check。
- 未连接或读取 production，未创建外部临时环境，未执行 raw/sanitized snapshot
  dump、restore、sanitize 写入或 cleanup。
- self-check 只借用现有本机 PostgreSQL owner 创建随机命名的一次性 database；未启动
  API、Worker、scheduler、frontend 或对象存储。

## Artifact

- `research/sanitize_snapshot.py`
  - SHA-256：`124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d`
- `research/sanitization-matrix.md`
  - SHA-256：`71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6`
- Alembic revision：`0043_geo_platform_identity`
- Schema signature：`90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a`
- Production object payload copied：`0`

## 本地 Required Validation

| 检查 | 结果 |
| --- | --- |
| Python `py_compile` | PASS |
| Ruff | PASS |
| targeted mypy | PASS |
| disposable PostgreSQL `self-check` | PASS |
| Trellis task manifest validation | PASS |
| touched untracked files whitespace check | PASS |

Self-check 已观察到以下硬断言通过：敏感 marker 清零、session 删除、关系与全部业务表
row count 保持（仅 `sessions -> 0`）、status/revision/timestamp/FK 保持、实际长度桶保持、
约束失败整体回滚、错误 revision/未知列/约束漂移/USER trigger 漂移 fail closed、独立
verifier 通过，以及 disposable database 精确删除后不存在。

## 当前 Gate

`NOT_MET`。本地 sanitizer/self-check 已完成，但 production 只读 export、raw quarantine、
真实 sanitize/fresh verify、manifest 与授权 cleanup 均未执行；父 Task 不得消费本地
self-check 作为 sanitized production artifact。
